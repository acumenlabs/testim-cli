'use strict';

const utils = require('../utils');
const logger = require('../commons/logger').getLogger('parallel-worker-manager');
const { CLI_MODE } = require('../commons/constants');
const analyticsService = require('../services/analyticsService');
const config = require('../commons/config');
const ExecutionQueue = require('../executionQueue');

const testimCustomToken = require('../commons/testimCustomToken');
const labFeaturesService = require('../services/labFeaturesService');
const perf = require('../commons/performance-logger');
const { StopRunOnError } = require('../errors');

require('../player/webdriver'); // preload

class ParallelWorkerManager {
    constructor(customExtensionLocalLocation) {
        this.customExtensionLocalLocation = customExtensionLocalLocation;
    }

    getWorkerType(mode) {
        switch (mode) {
            case CLI_MODE.SELENIUM:
                return require('../workers/WorkerSelenium');
            default:
                if (labFeaturesService.isFeatureAvailableForProject('useSameBrowserForMultiTests')) {
                    return require('../workers/WorkerExtensionSingleBrowser');
                }
                return require('../workers/WorkerExtension');
        }
    }

    createWorkers(count, queue, mode, ...args) {
        const Worker = this.getWorkerType(mode);
        const createWorker = () => {
            try {
                perf.log('before new Worker', mode);
                return new Worker(queue, ...args);
            } finally {
                perf.log('after new Worker', mode);
            }
        };

        return Array.from(new Array(count), createWorker);
    }

    async runTests(testList, testStatus, executionId, executionName, options, branchToUse, authData, workerCount, stopOnError) {
        if (testList && testList.length === 0) {
            return undefined;
        }

        let stoppedOnError = false;
        let runningTests = 0;
        const runAndWaitToComplete = token => new Promise((resolve, reject) => {
            const projectId = options.project;
            const executionQueue = new ExecutionQueue(executionId, executionName, testList, options, branchToUse, testStatus);

            const combinedTestResults = {};
            const testCount = testList.length;

            const companyId = options.company && options.company.companyId;
            const companyName = options.company && options.company.name;
            const source = options.source || 'cli';
            const user = options.user;
            const companyPlan = options.company && options.company.planType;
            const isStartUp = options.company && options.company.isStartUp;
            const projectName = options.projectData && options.projectData.name;
            const lightweightMode = options.lightweightMode;
            const sessionType = utils.getSessionType(options);

            const onTestStarted = (wid, testId, resultId, isRerun, testRetryKey) => {
                runningTests++;
                analyticsService.analyticsTestStart({
                    authData,
                    executionId,
                    projectId,
                    testId,
                    resultId,
                    companyId,
                    companyName,
                    projectName,
                    companyPlan,
                    sessionType,
                    source,
                    user,
                    lightweightMode,
                    isStartUp,
                });
                return testStatus.testStartAndReport(wid, executionId, resultId, isRerun, testRetryKey);
            };

            const onTestCompleted = async (wid, testId, testResult, sessionId, isRerun) => {
                runningTests--;
                const update = {};
                if (lightweightMode && lightweightMode.onlyTestIdsNoSuite) {
                    update.show = true;
                }
                if (testResult.seleniumStats) {
                    update.seleniumStats = testResult.seleniumStats;
                }
                if (testResult.seleniumPerfMarks) {
                    testStatus.concatSeleniumPerfMarks(testResult.seleniumPerfMarks);
                    delete testResult.seleniumPerfMarks;
                }
                if (testResult.gridIssues) {
                    update.gridIssues = testResult.gridIssues;
                }
                if (testResult.keepAliveIssue) {
                    update.keepAliveIssue = testResult.keepAliveIssue;
                }
                if (options.host) {
                    update.gridHost = options.host;
                }
                if (options.grid || options.gridId) {
                    update.gridName = options.grid || (options.gridData && options.gridData.name);
                    update.gridType = options.gridData && options.gridData.type;
                    update.gridProvider = options.gridData && options.gridData.provider;
                } else if (options.useLocalChromeDriver) {
                    update.gridName = 'local-chrome-driver-from-options';
                    update.gridType = 'local-chrome';
                } else if (options.useChromeLauncher) {
                    update.gridName = 'chrome-launcher-from-options';
                    update.gridType = 'local-chrome';
                } else if (options.browserstack) {
                    update.gridName = 'browserstack-from-options';
                } else if (options.saucelabs) {
                    update.gridName = 'saucelabs-from-options';
                }

                await testStatus.testEndAndReport(wid, testResult, executionId, sessionId, isRerun, update)
                    .catch(err => logger.error('testEndAndReport threw an error', { err }));

                if (isRerun) {
                    return undefined;
                }
                combinedTestResults[testResult.resultId] = testResult;
                analyticsService.analyticsTestEnd({
                    authData,
                    executionId,
                    projectId,
                    testId,
                    resultId: testResult.resultId,
                    result: testResult,
                    companyId,
                    companyName,
                    projectName,
                    companyPlan,
                    sessionType,
                    source,
                    user,
                    lightweightMode,
                    logger,
                    isStartUp,
                });
                if (stopOnError && !testResult.success) {
                    executionQueue.stop();
                    stoppedOnError = true;
                }
                const completedTests = Object.keys(combinedTestResults).length;
                if (completedTests === testCount || (stoppedOnError && runningTests === 0)) {
                    resolve(combinedTestResults);
                    return undefined;
                }
                return undefined;
            };

            const onTestIgnored = (wid, testResult) => {
                combinedTestResults[testResult.resultId] = testResult;
                testStatus.onTestIgnored(wid, testResult.resultId);
                runningTests--;
                const completedTests = Object.keys(combinedTestResults).length;
                if (completedTests === testCount || (stoppedOnError && runningTests === 0)) {
                    resolve(combinedTestResults);
                }
            };

            const onGridSlot = (executionId, resultId, gridInfo) => testStatus.onGridSlot(executionId, resultId, gridInfo);

            options.userData = {
                loginData: Object.assign({}, testimCustomToken.getTokenV3UserData(), {
                    refreshToken: testimCustomToken.getRefreshToken(),
                    authData: testimCustomToken.getTokenV3UserData(),
                    token,
                }),
                projectId: options.project,
                company: options.company,
                servicesUrl: config.SERVICES_HOST,
            };
            perf.log('in localStrategy before createWorker');
            this.createWorkers(workerCount, executionQueue, options.mode, options, this.customExtensionLocalLocation, executionId, onTestStarted, onTestCompleted, onGridSlot, onTestIgnored)
                .forEach((worker, index) => {
                    perf.log('before schedule worker.run after createWorkers');
                    schedule(() => {
                        perf.log('right before worker.run');
                        worker.run();
                    }, index);
                });
        });

        try {
            const token = await testimCustomToken.getCustomTokenV3();
            const result = await runAndWaitToComplete(token);
            if (stoppedOnError) {
                throw new StopRunOnError();
            }
            return result;
        } catch (err) {
            logger.error('failed running parallel workers', { executionId, err });
            throw err;
        }
    }
}


function schedule(fn, index) {
    if (index === 0) {
        fn();
    } else {
        setTimeout(fn, index * config.START_WORKER_DELAY_MS);
    }
}

module.exports = ParallelWorkerManager;

'use strict';

const Bluebird = require('bluebird');
const _ = require('lodash');
const constants = require('../commons/constants');

const TESTIM_RUN_STATUS = constants.testRunStatus;
const reporter = require('../reports/reporter');
const RealDataService = require('../commons/socket/realDataService');
const testimServicesApi = require('../commons/testimServicesApi');
const testimCustomToken = require('../commons/testimCustomToken');
const TestRunStatus = require('../testRunStatus');
const analyticsService = require('../services/analyticsService');
const gridService = require('../services/gridService');
const branchService = require('../services/branchService');
const config = require('../commons/config');
const ParallelWorkerManager = require('./ParallelWorkerManager');
const utils = require('../utils');
const { getSuite, calcTestResultStatus, validateConfig } = require('./runnerUtils');
const { StopRunOnError, ArgError } = require('../errors');
const Logger = require('../commons/logger');
const perf = require('../commons/performance-logger');

const guid = utils.guid;
const logger = Logger.getLogger('test-plan-runner');
const TDK_CHILD_RESULTS_TIMEOUT = 1000 * 60 * 5;

class TestPlanRunner {
    constructor(customExtensionLocalLocation) {
        this.workerManager = new ParallelWorkerManager(customExtensionLocalLocation);
        this.startTime = Date.now();
    }
    runTestAllPhases(beforeTests, tests, afterTests, branchToUse, tpOptions, executionId, executionName, testStatus) {
        const executionResults = {};
        const authData = testimCustomToken.getTokenV3UserData();

        const runBeforeTests = () => {
            const workerCount = tpOptions.beforeParallel || 1;
            const stopOnError = true;
            return this.workerManager.runTests(beforeTests, testStatus, executionId, executionName, tpOptions, branchToUse, authData, workerCount, stopOnError)
                .then(beforeTestsResults => Object.assign(executionResults, beforeTestsResults));
        };

        const runTestPlanTests = () => {
            const workerCount = config.TESTIM_CONCURRENT_WORKER_COUNT || tpOptions.parallel;
            const stopOnError = false;
            perf.log('right before this.workerManager.runTests');
            return this.workerManager.runTests(tests, testStatus, executionId, executionName, tpOptions, branchToUse, authData, workerCount, stopOnError)
                .log('right after this.workerManager.runTests')
                .then(testsResults => Object.assign(executionResults, testsResults));
        };

        const runAfterTests = () => {
            const workerCount = tpOptions.afterParallel || 1;
            const stopOnError = false;
            return this.workerManager.runTests(afterTests, testStatus, executionId, executionName, tpOptions, branchToUse, authData, workerCount, stopOnError)
                .then(afterTestsResults => Object.assign(executionResults, afterTestsResults));
        };

        function catchBeforeTestsFailed() {
            return testStatus.markAllQueuedTests(executionId, constants.runnerTestStatus.ABORTED, 'aborted', false);
        }

        const sessionType = utils.getSessionType(tpOptions);
        analyticsService.analyticsExecsStart({ authData, executionId, projectId: tpOptions.project, sessionType });
        perf.log('right before runBeforeTests');
        return runBeforeTests()
            .log('right before runTestPlanTests')
            .then(() => runTestPlanTests())
            .log('right after runTestPlanTests')
            .then(() => runAfterTests())
            .then(() => executionResults)
            .catch(err => {
                logger.error('error running test plan', { err });
                if (err instanceof StopRunOnError) {
                    return catchBeforeTestsFailed();
                }
                throw err;
            })
            .finally(async () => {
                if ((tpOptions.lightweightMode && tpOptions.lightweightMode.disablePixelValidation)) {
                    return;
                }
                // When sessionPlayer is available, use it - as it only attempts to close batches that exist.
                if (tpOptions.mode === constants.CLI_MODE.SELENIUM) {
                    const { EyeSdkBuilder } = require('../commons/getSessionPlayerRequire');
                    await EyeSdkBuilder.closeBatch(executionId);
                    return;
                }
                /** @type {Awaited<ReturnType<typeof testimServicesApi['getApplitoolsIntegrationData']>>} */
                let applitoolsIntegrationData;
                try {
                    if (!tpOptions.company || !tpOptions.company.activePlan || !tpOptions.company.activePlan.premiumFeatures || !tpOptions.company.activePlan.premiumFeatures.applitools) {
                        return;
                    }
                    applitoolsIntegrationData = await testimServicesApi.getApplitoolsIntegrationData(tpOptions.project);
                    if (_.isEmpty(applitoolsIntegrationData) || !executionId) {
                        return;
                    }
                    const { runKey: apiKey, url: serverUrl } = applitoolsIntegrationData;
                    const tmpSDK = require('@applitools/eyes-sdk-core').makeSDK({ name: 'Testim.io', version: '4.0.0', spec: {} });
                    await tmpSDK.closeBatches({ batchIds: [executionId], serverUrl, apiKey });
                } catch (err) {
                    // If a batch with this name did not exist, do not log an error.
                    if (err.message && (err.message.startsWith('Request failed with status code 404') || err.message.startsWith('no batchIds were set'))) {
                        return;
                    }
                    logger.error('Failed closing batch in extension mode', { err, projectId: tpOptions.project, applitoolsIntegrationData, batchIds: [executionId] });
                }
            });
    }

    async initRealDataService(projectId) {
        const realDataService = new RealDataService();
        await realDataService.init(projectId);
        return realDataService;
    }

    async listenToTestCreatedInFile(realDataService, projectId, runId, testStatus) {
        const childTestResults = {};
        realDataService.joinToTestResultsByRunId(runId, projectId);
        const promise = new Promise(resolve => {
            realDataService.listenToTestResultsByRunId(runId, testResult => {
                const resultId = testResult.id;
                if (!testStatus.getTestResult(resultId)) {
                    const prevTestResult = childTestResults[resultId];
                    const mergedTestResult = _.merge({}, prevTestResult, testResult, { resultId });
                    childTestResults[resultId] = mergedTestResult;
                    if (!prevTestResult || prevTestResult.status !== testResult.status) {
                        const parentTestResult = testStatus.getTestResult(mergedTestResult.parentResultId) || { workerId: 1 };
                        const workerId = parentTestResult.workerId;
                        if ([TESTIM_RUN_STATUS.RUNNING].includes(testResult.status)) {
                            reporter.onTestStarted(mergedTestResult, workerId);
                        }
                        if ([TESTIM_RUN_STATUS.COMPLETED].includes(testResult.status)) {
                            mergedTestResult.duration = (mergedTestResult.endTime - mergedTestResult.startTime) || 0;
                            reporter.onTestFinished(mergedTestResult, workerId);
                        }
                    }
                }

                const allChildTestResultCompleted = !(Object.values(childTestResults)
                    .some(result => ['QUEUED', 'RUNNING'].includes(result.runnerStatus)));

                const allParentTestResultCompleted = !(Object.values(testStatus.getAllTestResults())
                    .some(result => ['QUEUED', 'RUNNING'].includes(result.status)));

                if (allChildTestResultCompleted && allParentTestResultCompleted) {
                    return resolve(Object.values(childTestResults));
                }

                if (allParentTestResultCompleted && !allChildTestResultCompleted) {
                    // wait 10 sec to handle race condition when parent test result (file) finished before child test result
                    return Bluebird.delay(10000)
                        .then(() => {
                            if (promise.isPending()) {
                                // TODO(Benji) we are missing the child test results here.
                                // we are resolving here with partial data - we should consider fetching it
                                // from the server
                                resolve(childTestResults);
                            }
                        });
                }
                return undefined;
            });
        });

        return await promise;
    }

    async runTestPlan(beforeTests, tests, afterTests, tpOptions, testPlanName, testPlanId, branch, isAnonymous) {
        const executionId = guid();
        const projectId = tpOptions.project;
        Logger.setExecutionId(executionId);
        beforeTests.forEach(test => { test.isBeforeTestPlan = true; });
        afterTests.forEach(test => { test.isAfterTestPlan = true; });
        const testStatus = new TestRunStatus(_.concat(beforeTests, tests, afterTests), tpOptions, testPlanId, branch);

        const configs = _(_.concat(beforeTests, tests, afterTests)).map(test => (test.overrideTestConfig && test.overrideTestConfig.name) || '').uniq().filter(Boolean)
            .value();
        const configName = configs && configs.length === 1 ? configs[0] : null;

        const isCodeMode = tpOptions.files.length > 0;
        const testNames = tpOptions.lightweightMode && tpOptions.lightweightMode.onlyTestIdsNoSuite ? [] : _.concat(beforeTests, tests, afterTests).map(test => test.name);

        const testListInfoPromise = tpOptions.lightweightMode && tpOptions.lightweightMode.onlyTestIdsNoSuite ?
            { beforeTests, tests, afterTests } :
            testStatus.executionStart(executionId, projectId, this.startTime, testPlanName, testNames);
        let childTestResults;
        if (isCodeMode) {
            childTestResults = Bluebird.try(async () => {
                const realDataService = await this.initRealDataService(projectId);
                return this.listenToTestCreatedInFile(realDataService, projectId, executionId, testStatus);
            });
        }
        perf.log('before testListInfoPromise');
        const testListInfo = await testListInfoPromise;
        if (!(tpOptions.lightweightMode && tpOptions.lightweightMode.onlyTestIdsNoSuite)) {
            reporter.onTestPlanStarted(testListInfo.beforeTests, testListInfo.tests, testListInfo.afterTests, testPlanName, executionId, isAnonymous, configName, isCodeMode);
        }

        perf.log('before runTestAllPhases');
        const results = await this.runTestAllPhases(testListInfo.beforeTests, testListInfo.tests, testListInfo.afterTests, branch, tpOptions, executionId, testPlanName || 'All Tests', testStatus);
        const childResults = await Bluebird.resolve(childTestResults)
            .timeout(TDK_CHILD_RESULTS_TIMEOUT)
            .catch(async () => {
                logger.warn('timed out waiting for child resutls on websocket. using REST fallback', { projectId, executionId });
                const testResults = await testimServicesApi.getRealData(projectId, 'testResult', `runId=${executionId}&sort=runOrder`);
                return _.chain((testResults && testResults.data && testResults.data.docs) || [])
                    .groupBy('parentResultId')
                    .omit('undefined')
                    .values()
                    .flatten()
                    .value();
            });
        perf.log('before executionEnd');
        await testStatus.executionEnd(executionId);
        perf.log('after executionEnd');
        return { results, executionId, testPlanName, configName, childTestResults: childResults };
    }

    async runTestPlans(options, branchToUse) {
        logger.info('start to run test plan', {
            options: Object.assign({}, options, { token: undefined, userParamsData: undefined }),
            branchToUse,
        });

        function flattenTestListData(testPlansData) {
            return _.flattenDeep(Object.keys(testPlansData).map(tpId => testPlansData[tpId])).reduce((all, testRun) => _.concat(all, testRun.beforeTests, testRun.tests, testRun.afterTests), []);
        }

        const testPlansResults = {};
        const testPlansTests = {};
        const projectId = options.project;

        const data = await testimServicesApi.getTestPlanTestList(projectId, options.testPlan, options.testPlanIds, branchToUse, options.intersections);
        const testPlans = data.testPlans;
        const testPlansData = data.testPlansData;
        if (!testPlans || testPlans.length === 0) {
            throw new ArgError(`no test plan to run ${options.testPlan}`);
        }
        if (!testPlansData || Object.keys(testPlansData).length === 0) {
            if (options.passZeroTests) {
                return [];
            }
            throw new ArgError(`no test to run in test plan ${options.testPlan}`);
        }
        await validateConfig(options, flattenTestListData(testPlansData));
        return await Promise.all(testPlans.map(async testPlan => {
            const id = testPlan.testPlanId;
            testPlansResults[id] = {};

            const tpOptions = Object.assign({}, options);
            tpOptions.baseUrl = options.baseUrl || testPlan.startUrl;
            tpOptions.host = options.host;
            tpOptions.port = options.port;
            tpOptions.gridId = options.gridId || testPlan.gridId;

            //if user pass --grid with test plan we want to use grid option instead of host and port
            if (options.grid) {
                delete tpOptions.gridId;
            }


            tpOptions.gridData = await gridService.getTestPlanGridData(options, testPlan);

            const testPlanName = tpOptions.overrideExecutionName || testPlan.name;
            return await Promise.all(testPlansData[id].map(async testPlanTests => {
                const res = await this.runTestPlan(testPlanTests.beforeTests, testPlanTests.tests, testPlanTests.afterTests, tpOptions, testPlanName, id, branchToUse);
                const isCodeMode = options.files.length > 0;
                reporter.onTestPlanFinished(res.results, testPlan.name, this.startTime, res.executionId, false, isCodeMode, res.childTestResults);
                testPlansResults[id][res.executionId] = res.results;

                const executions = Object.keys(testPlansResults[id]).map(exeId => ({
                    executionId: exeId,
                    status: calcTestResultStatus(testPlansResults[id][exeId]),
                }));
                const tests = Object.keys(testPlansResults[id]).map(exeId => testPlansResults[id][exeId]).reduce((testResult, test) => Object.assign(testResult, test), {});
                const success = calcTestResultStatus(tests);
                Object.assign(testPlansTests, tests);
                const executionId = success ? executions[0].executionId : executions.find(exec => !exec.success).executionId;
                await testimServicesApi.saveTestPlanResult(projectId, id, { success, executions, executionId });
                return res;
            }));
        }));
    }

    async runAnonymousTestPlan(options, branchToUse) {
        logger.info('start to run anonymous', {
            options: Object.assign({}, options, { token: undefined }),
            branchToUse,
        });

        perf.log('before getSuite');
        const suiteResult = await getSuite(options, branchToUse);
        perf.log('after getSuite');

        if (!suiteResult.tests[0] || suiteResult.tests[0].length === 0) {
            if (options.rerunFailedByRunId) {
                throw new ArgError('No failed tests found in the provided run');
            }
            if (options.passZeroTests) {
                return [];
            }
            throw new ArgError('No tests to run');
        }
        branchToUse = suiteResult.branch || branchToUse;
        if (options.rerunFailedByRunId && !suiteResult.runName) {
            if (!suiteResult.runExists) {
                throw new ArgError('Invalid run ID - no such run.');
            }
            const isAnonymouslyNamedRun = suiteResult.runName === '';
            if (isAnonymouslyNamedRun) {
                suiteResult.runName = `rerun-${options.rerunFailedByRunId}`;
            }
        }
        const testPlanName = options.overrideExecutionName || suiteResult.runName || _.concat(options.label, options.name, options.suites).join(' ');
        const isAnonymous = true;
        perf.log('Right before validateConfig + runAnonymousTestPlan tests map');
        return await Promise.all(suiteResult.tests.map(async suiteTests => { // array of results per execution
            //override result id for remote run mode and run only the first test data
            if (options.resultId) {
                const firstTest = _.first(suiteTests);
                firstTest.resultId = options.resultId;
                suiteTests = [firstTest];
            }
            await validateConfig(options, suiteTests);
            perf.log('right before runTestPlan');
            const res = await this.runTestPlan([], suiteTests, [], options, testPlanName, null, branchToUse, isAnonymous);
            perf.log('right after runTestPlan');
            const isCodeMode = options.files.length > 0;
            await reporter.onTestPlanFinished(res.results, testPlanName, this.startTime, res.executionId, isAnonymous, isCodeMode, res.childTestResults);
            return res;
        }));
    }

    async run(options) {
        const branchToUse = branchService.getCurrentBranch();
        let results = [];
        if (utils.hasTestPlanFlag(options)) {
            results = await this.runTestPlans(options, branchToUse);
        } else {
            results = await this.runAnonymousTestPlan(options, branchToUse);
        }
        const flattenResults = _.flattenDeep(results);
        perf.log('right before onAllTestPlansFinished');
        await reporter.onAllTestPlansFinished(flattenResults);
        perf.log('right after onAllTestPlansFinished');
        return flattenResults.map(res => res.results).reduce((total, cur) => Object.assign(total, cur), {});
    }
}

module.exports = TestPlanRunner;

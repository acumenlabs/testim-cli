'use strict';

const constants = require('./commons/constants');
const { TESTIM_CONCURRENT_WORKER_COUNT } = require('./commons/config');
const utils = require('./utils.js');
const reporter = require('./reports/reporter.js');
const servicesApi = require('./commons/testimServicesApi.js');
const gridService = require('./services/gridService');
const logger = require('./commons/logger').getLogger('test-run-status');
const { ArgError } = require('./errors');
const OverrideTestDataBuilder = require('./OverrideTestDataBuilder');
const { SeleniumPerfStats } = require('./commons/SeleniumPerfStats');
const Promise = require('bluebird');
const _ = require('lodash');
const { registerExitHook } = require('./processHandler');
const { calculateCoverage } = require('./coverage/jsCoverage');
const featureAvailabilityService = require('./commons/featureAvailabilityService');
const featureFlags = require('./commons/featureFlags');
const { mapFilesToLocalDrive } = require('./services/localRCASaver');

const gitBranch = utils.getEnvironmentGitBranch();
const gitCommit = process.env.GIT_COMMIT || process.env.CIRCLE_SHA1 || process.env.TRAVIS_COMMIT;
const gitRepoUrl = process.env.GIT_URL || process.env.CIRCLE_REPOSITORY_URL;
const runnerVersion = utils.getRunnerVersion();


function runHook(fn, ...args) {
    if (!fn || typeof fn !== 'function') {
        return Promise.resolve();
    }
    return Promise.try(() => fn(...args) || {}).catch(err => {
        logger.warn('failed to run hook', { err });
        throw new ArgError(`failed to run hook promise ${err.message}`);
    });
}

const RunStatus = function (testInfoList, options, testPlanId, branchToUse) {
    this.options = options;
    this.options.runParams = this.options.runParams || {};
    this.startTime = null;
    this.fileUserParamsData = this.options.userParamsData;
    this.beforeSuiteParams = {};
    this.branchToUse = branchToUse;
    this.exportsGlobal = {};
    this.testInfoList = testInfoList;

    this.executionStartedPromise = Promise.resolve();

    const browserNames = utils.getUniqBrowsers(options, testInfoList);
    const runnerMode = options.lightweightMode ? options.lightweightMode.type : options.mode;
    this.execConfig = {
        parallel: TESTIM_CONCURRENT_WORKER_COUNT || options.parallel || 1,
        browser: browserNames,
        gitBranch,
        gitCommit,
        gitRepoUrl,
        runnerVersion,
        gridHost: options.host || options.gridData.host,
        testimBranch: branchToUse,
        canaryMode: options.canary,
        source: options.source,
        schedulerId: options.schedulerId,
        testPlanId,
        testPlans: options.testPlan,
        testLabels: options.label,
        testSuites: _.uniq(testInfoList.flatMap(test => test.testSuites)),
        testNames: options.name,
        testIds: options.testId,
        testConfigs: options.testConfigNames,
        testConfigIds: options.testConfigIds,
        port: options.port,
        browserTimeout: options.browserTimeout,
        timeout: options.timeout,
        newBrowserWaitTimeout: options.newBrowserWaitTimeout,
        tunnel: options.tunnel,
        tunnelPort: options.tunnelPort,
        tunnelHostHeader: options.tunnelHostHeader,
        runnerMode,
        gridId: options.gridId || options.gridData.gridId,
        gridName: options.grid || options.gridData.name,
        gridType: options.gridData.type,
        retentionDays: options.retentionDays,
        codeCoverageReportPath: options.codeCoverageReportPath,
        collectCodeCoverage: options.codeCoverageUrlFilter || options.collectCodeCoverage,
        sessionType: utils.getSessionType(options),
    };

    this.seleniumPerfStats = new SeleniumPerfStats();
    this.calcTestRunStatus();
};

RunStatus.prototype.waitForExecutionStartedFinished = function () {
    return this.executionStartedPromise;
};
RunStatus.prototype.getTestResult = function (resultId) {
    return this.testRunStatus[resultId];
};

RunStatus.prototype.addRetryTestResult = async function ({
    newResultId,
    originalTestResultId,
    previousTestResultId,
    projectId,
    executionId,
    retryCount = 1,
}) {
    const orgTestResult = this.testRunStatus[originalTestResultId] || {};
    const {
        config, isTestsContainer, testId, name, testStatus,
    } = orgTestResult;

    const newTestResult = {
        originalTestResultId,
        previousTestResultId,
        config: _.cloneDeep(config),
        testId,
        status: 'QUEUED',
        name,
        resultId: newResultId,
        isTestsContainer,
        retryCount,
        testStatus,
    };

    this.testRunStatus[newResultId] = newTestResult;

    return servicesApi.addTestRetry({
        projectId,
        runId: executionId,
        testId,
        newResultId,
        originalTestResultId,
        previousTestResultId,
        testResult: newTestResult,
    });
};

RunStatus.prototype.getAllTestResults = function () {
    return this.testRunStatus;
};

RunStatus.prototype.testStart = function (wid, executionId, resultId, isRerun) {
    const test = this.getTestResult(resultId);
    test.workerId = wid;
    const isCodeMode = this.options.files.length > 0;
    reporter.onTestStarted(test, wid, isRerun, isCodeMode, resultId);

    return test;
};

RunStatus.prototype.updateTestStatusRunning = function (test, executionId, testRetryKey) {
    const { project: projectId, remoteRunId, projectData } = this.options;
    if (this.options.lightweightMode && this.options.lightweightMode.onlyTestIdsNoSuite) {
        return this.executionStartedPromise;
    }

    return servicesApi.updateTestDataArtifact(projectId, test.testId, test.resultId, test.config.testData, projectData.defaults)
        .catch(err => {
            logger.error('failed to upload test data artifact (runner)', { err });
            return '';
        })
        .then(async (testDataUrl) => {
            const testConfig = _.cloneDeep(test.config);
            delete testConfig.testData;
            testConfig.testDataUrl = testDataUrl;
            await this.executionStartedPromise;
            return servicesApi.updateTestStatus(projectId, executionId, test.testId, test.resultId, 'RUNNING', { startTime: test.startTime, config: testConfig, remoteRunId, testRetryKey });
        });
};

RunStatus.prototype.testStartReport = function (test, executionId, testRetryKey) {
    if (utils.isQuarantineAndNotRemoteRun(test, this.options)) {
        return Promise.resolve();
    }
    return runHook(this.options.beforeTest, Object.assign({}, test, { exportsGlobal: this.exportsGlobal }), this.options.userData.loginData.token)
        .then(async params => {
            // Temporary Sapiens log (SUP-3192)
            if (this.options.projectData && this.options.projectData.projectId === 'fZ63D61PRQQVvvtGY6Ue' && this.options.suites && this.options.suites.includes('Sanity')) {
                logger.info('testRunStatus - testStartReport', {
                    'test.config.testData': test.config.testData,
                    'this.exportsGlobal': this.exportsGlobal,
                    'this.fileUserParamsData': this.fileUserParamsData,
                    'this.beforeSuiteParams': this.beforeSuiteParams,
                    params,
                    executionId,
                    'test.testId': test.testId,
                    'test.resultId': test.resultId,
                });
            }
            test.config.testData = Object.assign({}, test.config.testData, this.exportsGlobal, this.fileUserParamsData, this.beforeSuiteParams, params);
            this.options.runParams[test.resultId] = test.config.testData;
            test.startTime = Date.now();
            await this.updateTestStatusRunning(test, executionId, testRetryKey);

            return test;
        }).catch(err => {
            logger.error('Failed to start test', { err });
            throw err;
        });
};

RunStatus.prototype.testStartAndReport = function (wid, executionId, resultId, isRerun, testRetryKey) {
    const test = this.testStart(wid, executionId, resultId, isRerun);
    return this.testStartReport(test, executionId, testRetryKey);
};

RunStatus.prototype.onGridSlot = function (executionId, resultId, gridInfo) {
    const test = this.getTestResult(resultId);
    test.config.gridInfo = Object.assign({}, gridInfo, { key: undefined, user: undefined });
    logger.info('on get grid info', { gridInfo: test.config.gridInfo });
};

RunStatus.prototype.reportTestStatus = function (workerId, result, test, isRerun) {
    const { name, testId, testStatus } = test;
    const { resultId, success } = result;
    if (testStatus === constants.testStatus.EVALUATING && featureAvailabilityService.isTestStatusEnabled) {
        reporter.onTestIgnored(workerId, test, `test in ${constants.testStatus.EVALUATING} status`);
        return;
    }
    if (success) {
        reporter.onTestPassed(name);
        return;
    }
    reporter.onTestFailed(test,
        test.failureReason,
        utils.getTestUrl(this.options.editorUrl,
            this.options.project,
            testId,
            resultId,
            this.branchToUse),
        testId,
        isRerun,
        resultId);
};

RunStatus.prototype.calcResultText = function (result) {
    return result.success ? constants.runnerTestStatus.PASSED : constants.runnerTestStatus.FAILED;
};

RunStatus.prototype.onTestIgnored = function (wid, resultId) {
    const test = this.getTestResult(resultId);
    reporter.onTestIgnored(wid, test, `test in ${constants.testStatus.QUARANTINE}`);
};

RunStatus.prototype.testEnd = function (wid, result, executionId, sessionId, isRerun) {
    const test = this.testRunStatus[result.resultId];

    const duration = (result.endTime - result.startTime) || 0;
    test.sessionId = sessionId;
    test.startTime = result.startTime || test.startTime || Date.now();
    test.duration = duration;
    result.duration = duration;
    test.failureReason = result.failureReason || result.reason;
    result.failureReason = test.failureReason;
    test.failurePath = result.failurePath;
    test.resultId = result.resultId;
    test.success = result.success;

    if (this.options.saveRCALocally) {
        mapFilesToLocalDrive(test, logger);
    }

    test.resultUrl = utils.getTestUrl(this.options.editorUrl, this.options.project, test.testId, test.resultId, this.branchToUse);
    test.status = this.calcResultText(result);

    result.status = test.status;
    result.name = test.name;
    result.testStatus = test.testStatus;
    result.testId = result.testId || test.testId;
    result.testCreatorName = test.testCreatorName;
    result.testCreatorEmail = test.testCreatorEmail;
    result.testOwnerName = test.testOwnerName;
    result.testOwnerEmail = test.testOwnerEmail;
    result.testData = test.config && typeof test.config.testDataTotal === 'number' ? {
        total: test.config.testDataTotal,
        index: test.config.testDataIndex,
    } : {};

    this.reportTestStatus(wid, result, test, isRerun);
    const isCodeMode = this.options.files.length > 0;
    reporter.onTestFinished(test, wid, isRerun, isCodeMode);

    const afterMerge = Object.assign({}, this.exportsGlobal, result.exportsGlobal);
    // Temporary Sapiens log (SUP-3192)
    if (this.options.projectData && this.options.projectData.projectId === 'fZ63D61PRQQVvvtGY6Ue' && this.options.suites && this.options.suites.includes('Sanity')) {
        logger.info('testRunStatus - testEnd', {
            'this.exportsGlobal': this.exportsGlobal,
            'result.exportsGlobal': result.exportsGlobal,
            afterMerge,
            executionId,
            'test.testId': test.testId,
            'test.resultId': test.resultId,
        });
    }
    this.exportsGlobal = afterMerge;
    return test;
};

RunStatus.prototype.testEndReport = async function (test, executionId, result, testResultUpdates) {
    const globalParameters = result.exportsGlobal;
    try {
        try {
            await runHook(this.options.afterTest, Object.assign({}, test, { globalParameters }), this.options.userData.loginData.token);
        } catch (err) {
            logger.error('HOOK threw an error', { test: test.testId, err });
            // eslint-disable-next-line no-console
            console.error('HOOK threw an error', err); // show the customer that his hook failed.
        }
        if (this.options.lightweightMode && this.options.lightweightMode.onlyTestIdsNoSuite) {
            return undefined;
        }

        return await servicesApi.updateTestStatus(this.options.project, executionId, test.testId, test.resultId, 'FINISHED', {
            startTime: test.startTime,
            endTime: result.endTime,
            success: test.success,
            failureReason: test.failureReason,
            remoteRunId: this.options.remoteRunId,
            ...testResultUpdates,
        }, 5);
    } catch (err) {
        logger.error('Failed to update test finished', { err });
        throw err;
    }
};

RunStatus.prototype.testEndAndReport = function (wid, result, executionId, sessionId, isRerun, testResultUpdates) {
    const test = this.testEnd(wid, result, executionId, sessionId, isRerun);
    return this.testEndReport(test, executionId, result, testResultUpdates);
};

RunStatus.prototype.calcTestRunStatus = function () {
    const { options, testInfoList } = this;
    const companyId = options.company.companyId;
    this.testRunStatus = testInfoList.reduce((resultStatus, testInfo) => {
        resultStatus[testInfo.resultId] = {
            testId: testInfo.testId,
            status: utils.isQuarantineAndNotRemoteRun(testInfo, options) ? constants.runnerTestStatus.SKIPPED : constants.runnerTestStatus.QUEUED,
            name: testInfo.name,
            resultId: testInfo.resultId,
            isTestsContainer: testInfo.isTestsContainer,
            testStatus: testInfo.testStatus || constants.testStatus.DRAFT,
            testCreatorName: testInfo.creatorName,
            testCreatorEmail: testInfo.creatorEmail,
            testOwnerName: testInfo.testOwnerName,
            testOwnerEmail: testInfo.testOwnerEmail,
            testLabels: testInfo.testLabels,
            testSuites: testInfo.testSuites,
            allLabels: testInfo.allLabels,
        };

        const runConfig = options.browser ? utils.getRunConfigByBrowserName(options.browser, options.saucelabs, options.browserstack) : testInfo.runConfig;

        resultStatus[testInfo.resultId].config = Object.assign({}, this.execConfig, {
            companyId,
            testData: testInfo.testData && testInfo.testData.value ? testInfo.testData.value : null,
        });
        resultStatus[testInfo.resultId].config.isBeforeTestPlan = testInfo.isBeforeTestPlan;
        resultStatus[testInfo.resultId].config.isAfterTestPlan = testInfo.isAfterTestPlan;
        resultStatus[testInfo.resultId].config.testDataTotal = testInfo.testData && testInfo.testData.total ? testInfo.testData.total : null;
        resultStatus[testInfo.resultId].config.testDataIndex = testInfo.testData && testInfo.testData.index ? testInfo.testData.index : null;
        resultStatus[testInfo.resultId].config.baseUrl = options.baseUrl || testInfo.baseUrl || testInfo.testConfig.baseUrl;
        resultStatus[testInfo.resultId].config.testConfig = testInfo.overrideTestConfig || testInfo.testConfig;
        resultStatus[testInfo.resultId].config.browser = runConfig.browserValue.toLowerCase();
        return resultStatus;
    }, {});
};

RunStatus.prototype.executionStart = function (executionId, projectId, startTime, testPlanName, testNames) {
    logger.info('execution started', { executionId });
    const { options } = this;
    const { remoteRunId, projectData } = options;

    registerExitHook(() => Promise.all([
        gridService.keepAlive.end(projectId),
        servicesApi.reportExecutionFinished(
            'ABORTED',
            executionId,
            projectId,
            false,
            undefined,
            remoteRunId,
            undefined,
        ),
    ]));

    this.startTime = startTime || Date.now();
    const runHooksProps = { projectId, executionId };
    if (featureFlags.flags.testNamesToBeforeSuiteHook.isEnabled()) {
        runHooksProps.testNames = testNames;
    }
    return runHook(options.beforeSuite, runHooksProps)
        .then(params => {
            const overrideTestDataBuilder = new OverrideTestDataBuilder(params, _.cloneDeep(this.testInfoList), projectId);
            this.testInfoList = overrideTestDataBuilder.overrideTestData();
            this.calcTestRunStatus();
            this.beforeSuiteParams = params;

            const { testInfoList } = this;
            const beforeTests = testInfoList.filter(test => test.isBeforeTestPlan);
            const tests = testInfoList.filter(test => !test.isBeforeTestPlan && !test.isAfterTestPlan);
            const afterTests = testInfoList.filter(test => test.isAfterTestPlan);

            const reportExecutionStarted = () => {
                const testResults = _.cloneDeep(this.testRunStatus);
                return Promise.map(Object.keys(testResults), testResultId => {
                    const test = testResults[testResultId];
                    const testData = test.config && test.config.testData;
                    const testId = test.testId;
                    return servicesApi.updateTestDataArtifact(projectId, testId, testResultId, testData, projectData.defaults)
                        .then((testDataUrl) => {
                            if (!testDataUrl) {
                                return;
                            }
                            delete test.config.testData;
                            test.config.testDataUrl = testDataUrl;
                        });
                }).then(() => {
                    const isLocalRun = Boolean(options.useLocalChromeDriver || options.useChromeLauncher);
                    const data = {
                        executionId,
                        projectId,
                        labels: testPlanName || [],
                        startTime,
                        executions: testResults,
                        config: this.execConfig,
                        resultLabels: options.resultLabels,
                        remoteRunId: options.remoteRunId,
                        localRunUserId: options.user,
                        isLocalRun,
                        intersections: options.intersections,
                    };
                    const ret = servicesApi.reportExecutionStarted(data);
                    this.executionStartedPromise = ret;
                    ret.catch(e => logger.error(e));
                    return ret;
                });
            };

            return reportExecutionStarted()
                .catch(err => {
                    logger.error('Failed to start suite', { err });
                    // eslint-disable-next-line no-console
                    console.error('Failed to start test run. Please contact support@testim.io');
                })
                .then(() => ({ beforeTests, tests, afterTests }));
        });
};

RunStatus.prototype.concatSeleniumPerfMarks = function (marks) {
    _.chain(marks)
        .keys()
        .each((key) => {
            if (this.seleniumPerfStats.marks[key]) {
                this.seleniumPerfStats.marks[key] = [...this.seleniumPerfStats.marks[key], ...marks[key]];
            }
        })
        .value();
};

RunStatus.prototype.executionEnd = function (executionId) {
    const tests = utils.groupTestsByRetries(this.testRunStatus);
    const total = tests.length;
    const passed = tests.filter(({ status }) => status === constants.runnerTestStatus.PASSED).length;
    const skipped = tests.filter(({ status }) => status === constants.runnerTestStatus.SKIPPED).length;
    const failedInEvaluatingStatus = tests.filter(({ status, testStatus }) => status === constants.runnerTestStatus.FAILED && testStatus === constants.testStatus.EVALUATING).length;

    const resultExtraData = { ...this.seleniumPerfStats.getStats() };
    delete resultExtraData.seleniumPerfMarks;

    return runHook(this.options.afterSuite, {
        exportsGlobal: this.exportsGlobal,
        tests,
        total,
        passed,
        skipped,
    })
        .then(() => calculateCoverage(this.options, this.branchToUse, total, executionId))
        .then((coverageSummary) => {
            resultExtraData.coverageSummary = coverageSummary;

            if (this.options.lightweightMode && this.options.lightweightMode.onlyTestIdsNoSuite) {
                return undefined;
            }
            return servicesApi.reportExecutionFinished(
                'FINISHED',
                executionId,
                this.options.project,
                total === (passed + skipped + failedInEvaluatingStatus),
                {
                    tmsSuppressReporting: this.options.tmsSuppressReporting,
                    tmsRunId: this.options.tmsRunId,
                    tmsCustomFields: this.options.tmsCustomFields,
                },
                this.options.remoteRunId,
                resultExtraData,
            ).catch(err => {
                logger.error('Failed to update suite finished', { err });
                throw err;
            });
        });
};

RunStatus.prototype.markAllQueuedTests = function (executionId, status, failureReason, success) {
    const queuedResultIds = Object.keys(this.testRunStatus).filter(resultId => this.getTestResult(resultId).status === 'QUEUED');

    return servicesApi.updateExecutionTests(
        executionId,
        ['QUEUED'],
        status,
        failureReason,
        success,
        this.startTime,
        null,
        this.options.project
    ).then(() => Promise.each(queuedResultIds, resultId => {
        const test = this.getTestResult(resultId);
        test.status = status;
        test.failureReason = failureReason;
        test.success = success;
    })).then(() => this.testRunStatus);
};

module.exports = RunStatus;

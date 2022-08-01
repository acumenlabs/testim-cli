'use strict';

const pRetry = require('p-retry');
const _ = require('lodash');
const testimCustomToken = require('./commons/testimCustomToken');
const remoteStepService = require('./commons/socket/remoteStepService');
const testResultService = require('./commons/socket/testResultService');
const testimServicesApi = require('./commons/testimServicesApi');
const { timeoutMessages, CLI_MODE } = require('./commons/constants');
const logger = require('./commons/logger').getLogger('test-run-handler');
const perf = require('./commons/performance-logger');
const { URL } = require('url');
const Promise = require('bluebird');
const remoteStepPlayback = require('./stepPlayers/remoteStepPlayback');
const utils = require('./utils');
const config = require('./commons/config');
const analytics = require('./commons/testimAnalytics');
const { SeleniumPerfStats } = require('./commons/SeleniumPerfStats');
const { preloadTests } = require('./commons/preloadTests');

const RETRIES_ON_TIMEOUT = 3;
const MAX_LIGHTWEIGHT_MODE_RUN_DATA_SIZE = 20 * 1000; // max size, in characters, of stringified run data sent over URL params. Chosen arbitrarily, this value should be changed according to data.
const canSendRunDataOverUrl = (runData) => JSON.stringify(runData).length < MAX_LIGHTWEIGHT_MODE_RUN_DATA_SIZE;

class TestRun {
    constructor(executionId, executionName, test, options, branchToUse, testRunStatus) {
        this._executionId = executionId;
        this._executionName = executionName;
        this._testStatus = test.testStatus;
        this._testId = test.testId;
        this._testName = test.name;
        this._testResultId = test.resultId;
        this._code = test.code;
        this._baseUrl = options.baseUrl || test.baseUrl || test.testConfig.baseUrl;
        this._nativeApp = test.nativeApp;
        this._overrideTestConfigId = test.overrideTestConfig && test.overrideTestConfig.id;
        this._options = options;
        this._branch = branchToUse;
        this._maxRetryCount = options.retries;
        this._remoteRunId = options.remoteRunId;
        this._retryCount = 1;
        this._timeoutRetryCount = 1;
        this._totalRetryCount = 1;

        this._testRunStatus = testRunStatus;
        const shouldUpdateConfig = !(test.runConfig && test.runConfig.isMobileWeb) && options.browser;
        this._runConfig = shouldUpdateConfig ? utils.getRunConfigByBrowserName(options.browser, options.saucelabs, options.browserstack) : test.runConfig;
        this.clearTestResultFinished = Promise.resolve();

        this.seleniumPerfStats = new SeleniumPerfStats();
    }

    waitForExecutionStartedFinished() {
        return this._testRunStatus.waitForExecutionStartedFinished() && this.clearTestResultFinished;
    }

    getTestStatus() {
        return this._testStatus;
    }

    getRunMode() {
        return this._options.mode;
    }

    getAutomationMode() {
        return this._code ? 'codeful' : 'codeless';
    }

    getCode() {
        return this._code;
    }

    getRunConfig() {
        return this._runConfig;
    }

    getTestResultId() {
        return this._testResultId;
    }

    getBaseUrl() {
        return this._baseUrl;
    }

    getExecutionId() {
        return this._executionId;
    }

    getExecutionName() {
        return this._executionName;
    }

    getNativeAppData() {
        if (this._nativeApp && !this._options.baseUrl) {
            return this._nativeApp;
        }

        const url = this._options.baseUrl || this.getBaseUrl();
        if (!url) {
            return null;
        }

        const [packageName, activity] = url.split(':');
        return {
            packageName,
            activity,
        };
    }

    getBranch() {
        return this._branch;
    }

    getRemoteRunId() {
        return this._remoteRunId;
    }

    getOverrideTestConfigId() {
        return this._overrideTestConfigId;
    }

    markClearBrowser() {
        this.clearBrowser = true;
    }

    async getRunRequestParams() {
        const customTokenV3 = await testimCustomToken.getCustomTokenV3();
        const runRequestParams = {
            tokenV3: customTokenV3,
            refreshToken: testimCustomToken.getRefreshToken(),
            projectId: this._options.project,
            executionId: this._executionId,
            executionName: this._executionName,
            testId: this._testId,
            resultId: this._testResultId,
            baseUrl: this._baseUrl,
            branch: this._branch,
            servicesUrl: config.EXTENSION_SERVICES_HOST,
            remoteRunId: this.getRemoteRunId(),
            previousTestResultId: this.getPreviousTestResultId(),
            testRetryCount: this.getRetryCount(),
        };

        if (this._code) {
            runRequestParams.isCodeMode = true;
            runRequestParams.testName = this._testName;
        }

        if (this._options.shouldMonitorPerformance) {
            runRequestParams.shouldMonitorPerformance = true;
        }

        if (this._options.company) {
            runRequestParams.companyId = this._options.company.companyId;
            runRequestParams.onprem = this._options.company.onprem;
            runRequestParams.storageBaseUrl = this._options.company.storageBaseUrl;
            runRequestParams.storageType = this._options.company.storageType;
            runRequestParams.planType = this._options.company.planType;
            runRequestParams.isPOC = this._options.company.isPOC;
            runRequestParams.isStartUp = this._options.company.isStartUp;
        }

        if (this._options.collectCodeCoverage) {
            if (this._options.codeCoverageUrlFilter) {
                runRequestParams.codeCoverageUrlFilter = this._options.codeCoverageUrlFilter;
            } else {
                runRequestParams.codeCoverageUrlFilter = `${this._baseUrl}*`;
            }
        }

        if (this._options.disableMockNetwork) {
            runRequestParams.disableMockNetwork = this._options.disableMockNetwork;
            analytics.trackWithCIUser('user-disable-mock');
        }

        if (this._options.lightweightMode) {
            runRequestParams.lightweightMode = this._options.lightweightMode;
        }

        if (this._options.lightweightMode && this._options.lightweightMode.general) {
            runRequestParams.company = this._options.company;
            const runData = this.getRunData();
            runRequestParams.lightweightMode.isRunDataSentInUrl = canSendRunDataOverUrl(runData);
            if (runRequestParams.lightweightMode.isRunDataSentInUrl) {
                runRequestParams.runData = runData;
                logger.info(`Run data sent as URL param, test id: ${this.getTestId()} run data length: ${JSON.stringify(runData).length}`);
            } else {
                logger.warn(`Run data is too big to be sent as a URL param. Test id: ${this.getTestId()}, run data size: ${JSON.stringify(runData).length} (limit: ${MAX_LIGHTWEIGHT_MODE_RUN_DATA_SIZE} characters)`);
            }
            runRequestParams.isLocalRun = Boolean(this._options.useLocalChromeDriver || this._options.useChromeLauncher);
        }

        if (this._options.lightweightMode && this._options.lightweightMode.preloadTests && this._options.useChromeLauncher) {
            const preloadedTests = await preloadTests(this._options);
            runRequestParams.preloadedTest = preloadedTests[runRequestParams.testId];
        }

        if (this.clearBrowser) {
            runRequestParams.clearBrowser = true;
        }

        if (this._options.localRCASaver) {
            runRequestParams.localRCASaver = this._options.localRCASaver;
        }

        return runRequestParams;
    }

    async getRunTestUrl() {
        const runRequestParams = await this.getRunRequestParams();
        const url = `https://run.testim.io/?params=${encodeURIComponent(JSON.stringify(runRequestParams))}`;
        logger.info(`Test (${this.getTestId()}) run URL length: ${url.length}`);
        return url;
    }

    setSessionId(sessionId) {
        this._sessionId = sessionId;
    }

    getSessionId() {
        return this._sessionId;
    }

    getTestId() {
        return this._testId;
    }

    getTestName() {
        return this._testName;
    }

    getRunParams() {
        return this._options.runParams[this._testResultId] || {};
    }

    getRunData() {
        return {
            userParamsData: this.getRunParams(),
            overrideTestConfigId: this._overrideTestConfigId || null,
        };
    }

    clearTestResult() {
        const runData = this.getRunData();
        if (this.getRunMode() === CLI_MODE.EXTENSION) {
            runData.code = this.getCode();
        }

        if (this._options.mockNetworkRules) {
            runData.mockNetworkRules = this._options.mockNetworkRules;
        }
        const mustClearPreviousStepResults = (this._timeoutRetryCount > 1 || this._retryCount > 1);

        if (this._options.lightweightMode && this._options.lightweightMode.disableResults &&
            !mustClearPreviousStepResults && canSendRunDataOverUrl(runData)) {
            return Promise.resolve();
        }

        this.clearTestResultFinished = testimServicesApi.uploadRunDataArtifact(this._options.project, this._testId, this._testResultId, runData)
            .catch(err => {
                logger.error('failed to upload run data artifact (runner)', { err });
                return '';
            })
            .then(async (runDataUrl) => {
                // make sure the execution is created by now
                await this._testRunStatus.waitForExecutionStartedFinished();
                // we probably can save this backend call by initializing the execution
                return testimServicesApi.clearTestResult(this._options.project, this._testResultId, this._testId, {
                    name: this._testName,
                    resultId: this._testResultId,
                    status: 'pending',
                    retryCount: this._retryCount,
                    runDataUrl, // links the run data url to the test.
                    runData: runDataUrl ? undefined : runData, // put runData in mongo if we fail to upload to S3.
                    testRetryKey: this.getRetryKey(),
                });
            });
        return this.clearTestResultFinished;
    }

    hasMoreRetries() {
        return this._retryCount < this._maxRetryCount;
    }

    getRetryKey() {
        return `${this._retryCount}:${this._timeoutRetryCount}`;
    }

    startNewRetry() {
        this._retryCount++;
        this._timeoutRetryCount = 1;
        return this.onRetry();
    }

    async runTestUsingCDP(cdpTestRunner) {
        perf.log('runTestUsingCDP');
        const { targetInfos } = await cdpTestRunner.cdpCommand('Target.getTargets') || { targetInfos: [] };
        const { targetId: extensionTargetId } = targetInfos.find(target => target.type === 'background_page' && target.title === 'Testim Editor') || {};
        const { targetId: AUTTargetId } = targetInfos.find(target => target.type === 'page') || {};
        if (!extensionTargetId) {
            throw new Error('testim extension not found');
        }
        if (!AUTTargetId) {
            throw new Error('AUT target not found');
        }

        try {
            perf.log('before Target.attachToTarget');
            const [extensionSession, runRequestParams] = await Promise.all([
                cdpTestRunner.cdpCommand('Target.attachToTarget', { targetId: extensionTargetId, flatten: true }),
                this.getRunRequestParams(),
            ]);
            const { sessionId: extensionSessionId } = extensionSession || {};
            perf.log('before Runtime.evaluate');

            await pRetry(async () => {
                const { result } = await cdpTestRunner.cdpCommand('Runtime.evaluate', { expression: 'typeof runTestimTest !== \'undefined\'', returnByValue: true }, extensionSessionId);
                if (!result.value) {
                    throw new Error('runTestimTest not available on global scope');
                }
            }, { retries: 100, minTimeout: 30 });

            perf.log('after wait for runTestimTest function');
            const { result } = await cdpTestRunner.cdpCommand(
                'Runtime.evaluate',
                { expression: `runTestimTest(${JSON.stringify(runRequestParams)})`, awaitPromise: true, returnByValue: true },
                extensionSessionId,
            );
            if (result.subtype === 'error') {
                throw new Error(result.description);
            }
            perf.log('after Runtime.evaluate');
            return result.value;
        } catch (err) {
            logger.error('error running test using CDP', { err });
            throw new Error('Error running test using CDP');
        }
    }

    isRetryKeyMismatch(testResult) {
        return testResult.testRetryKey && (testResult.testRetryKey !== this.getRetryKey());
    }

    validateRunConfig() {
        const baseUrl = this.getBaseUrl();
        const { browserValue } = this.getRunConfig();

        if (baseUrl && browserValue === 'safari') {
            let parsedUrl;
            try {
                parsedUrl = new URL(baseUrl);
            } catch (err) {
                // ignore invalid URLs (missing http:// or https:// prefix)
                return;
            }
            const { username, password } = parsedUrl;

            if (username || password) {
                throw new Error('Basic authentication in URL is not supported in Safari');
            }
        }
    }

    onStarted(startTimeout) {
        return new Promise(resolve => {
            // We can't leave the test result as it may remove other listeners as well
            // We need to implement an .off(resultId, listener) method
            let reportedStart = false;
            const resolveResult = testResult => {
                if (reportedStart) {
                    return;
                }
                if (this.isRetryKeyMismatch(testResult)) {
                    logger.warn(`ignoring result update for on started due to retry key mismatch, got ${testResult.testRetryKey}, current is ${this.getRetryKey()}`, {
                        resultId: this.getTestResultId(),
                        testId: this.getTestId(),
                    });
                    return;
                }
                if (['running', 'completed'].includes(testResult.status)) {
                    testResult.resultId = this._testResultId;
                    if (testResult.status === 'completed') {
                        logger.info('setting _wasCompletedOnStartedCheck to true', {
                            testResult,
                            resultId: this.getTestResultId(),
                            testId: this.getTestId(),
                            testRetryKey: this.getRetryKey(),
                        });
                        this._wasCompletedOnStartedCheck = testResult;
                    }
                    reportedStart = true;
                    resolve(testResult);
                }
            };
            if (this._options.disableSockets) {
                const timeLimit = Date.now() + startTimeout;
                const checkIfDone = () => {
                    if (Date.now() > timeLimit) {
                        return;
                    }
                    const testId = this._testId;
                    const resultId = this._testResultId;
                    const projectId = this._options.project;
                    const branch = this.getBranch();

                    testimServicesApi.getTestResults(testId, resultId, projectId, branch).then(restResult => {
                        resolveResult(restResult);
                        if (!reportedStart) {
                            setTimeout(checkIfDone, 3000);
                        }
                    }).catch((err) => {
                        logger.error('failed to check if done', { err });
                        setTimeout(checkIfDone, 3000);
                    });
                };
                setTimeout(checkIfDone, 3000);
            } else {
                testResultService.listenToTestResult(this._testResultId, this._testId, resolveResult);
            }
        });
    }

    checkViaRestAPIIfTestStarted() {
        const testId = this._testId;
        const resultId = this._testResultId;
        const projectId = this._options.project;
        const branch = this.getBranch();
        return testimServicesApi.getTestResults(testId, resultId, projectId, branch)
            .then(testResult => {
                const expectedStatuses = ['running', 'completed'];
                if (expectedStatuses.includes(testResult.status)) {
                    logger.info(`get status: ${testResult.status} after not get test started status`, { testId, resultId, branch });
                    return testResult;
                }
                logger.error(`test not start test status: ${testResult.status} (expected [${expectedStatuses.join(', ')}])`, { testId, resultId, branch });
                throw new Error(timeoutMessages.TEST_START_TIMEOUT_MSG);
            })
            .catch(err => {
                logger.error('failed to get test result after test start timeout', { err, testId, resultId, branch });
                throw new Error(timeoutMessages.TEST_START_TIMEOUT_MSG);
            });
    }

    onCompletedCleanup() {
        if (!this._options.disableSockets) {
            return Promise.resolve(testResultService.leaveTestResult(this._testResultId, this._testId));
        }
        return Promise.resolve();
    }

    onCompleted() {
        let onConnected;
        return new Promise(resolve => {
            if (this._wasCompletedOnStartedCheck && !this.isRetryKeyMismatch(this._wasCompletedOnStartedCheck)) {
                logger.info('test was already completed in on started check', {
                    resultId: this.getTestResultId(),
                    testId: this.getTestId(),
                });
                resolve(this._wasCompletedOnStartedCheck);
                return;
            }

            if (!this._options.disableSockets) {
                testResultService.listenToTestResult(this._testResultId, this._testId, testResult => {
                    if (this.isRetryKeyMismatch(testResult)) {
                        logger.warn(`ignoring result update for on completed due to retry key mismatch, got ${testResult.testRetryKey}, current is ${this.getRetryKey()}`, {
                            resultId: this.getTestResultId(),
                            testId: this.getTestId(),
                        });
                        return;
                    }
                    if (testResult.status === 'completed') {
                        testResult.resultId = this._testResultId;
                        resolve(testResult);
                    }
                });
            }
            const debounceDelay = this._options.disableSockets ? 0 : Math.floor(10000 + (Math.random() * 5000));
            const maxWait = this._options.disableSockets ? 0 : Math.floor(60000 + (Math.random() * 15000));
            onConnected = _.debounce(() => testimServicesApi.getTestResults(this._testId, this._testResultId, this._options.project, this.getBranch())
                .then(testResult => {
                    if (this.isRetryKeyMismatch(testResult)) {
                        logger.warn(`ignoring result update for on completed (in reconnect) due to retry key mismatch, got ${testResult.testRetryKey}, current is ${this.getRetryKey()}`, {
                            resultId: this.getTestResultId(),
                            testId: this.getTestId(),
                        });
                        return false;
                    }
                    if (testResult && testResult.status === 'completed') {
                        logger.info('Socket reconnected - Test complete', { testId: this._testId, resultId: this._testResultId, projectId: this._options.project });
                        testResult.resultId = this._testResultId;
                        resolve(testResult);
                        return true;
                    }
                    return false;
                })
                .catch(err => logger.warn('Error while trying to check status on socket connect', err)), debounceDelay, { maxWait });
            if (!this._options.disableSockets) {
                testResultService.on('socket-connected', onConnected);
            } else {
                const waitForTestEnd = () => {
                    setTimeout(async () => {
                        try {
                            const { isComplete } = await testimServicesApi.isTestResultCompleted(this._testResultId, this._options.project, this.getRetryKey());
                            if (isComplete) {
                                const isDone = await onConnected();
                                if (!isDone) {
                                    logger.warn('onConnected returned false even though isComplete was true');
                                    waitForTestEnd();
                                }
                            } else {
                                waitForTestEnd();
                            }
                        } catch (err) {
                            logger.error('failed to check is complete', { err });
                            waitForTestEnd();
                        }
                    }, 3000);
                };
                waitForTestEnd();
            }
        })
            .then(async res => {
                await this.onCompletedCleanup();
                return res;
            })
            .finally(() => onConnected && !this._options.disableSockets && testResultService.off('socket-connected', onConnected));
    }

    listenToRemoteStep(browser) {
        remoteStepService.listenToRemoteStep(this._testResultId, step => {
            remoteStepPlayback.executeStep(this._options, browser, step, this._testResultId);
        });
    }

    hasMoreTimeoutRetries() {
        const maxRetryCount = this._options.disableTimeoutRetry ? 1 : RETRIES_ON_TIMEOUT;
        return this._timeoutRetryCount < maxRetryCount;
    }

    startNewTimeoutRetry() {
        this._timeoutRetryCount++;
        return this.onRetry();
    }

    getRetryCount() {
        return this._retryCount;
    }

    getPreviousTestResultId() {
        return this._previousTestResultId;
    }

    isAllowReportTestResultRetries() {
        return Boolean(_(this._options).get('company.activePlan.premiumFeatures.allowReportTestResultRetries'));
    }

    async onRetry() {
        this._previousTestResultId = this._testResultId;

        if (!this.isAllowReportTestResultRetries()) {
            return;
        }

        this._totalRetryCount++;
        this._originalTestResultId = this._originalTestResultId || this._previousTestResultId;
        this._testResultId = utils.guid();

        if (this._options.lightweightMode && this._options.lightweightMode.onlyTestIdsNoSuite) {
            return;
        }

        await this._testRunStatus.addRetryTestResult({
            retryCount: this._totalRetryCount,
            executionId: this._executionId,
            projectId: this._options.project,
            newResultId: this._testResultId,
            originalTestResultId: this._originalTestResultId,
            previousTestResultId: this._previousTestResultId,
        });
    }
}

module.exports = TestRun;

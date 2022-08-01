'use strict';

const Bluebird = require('bluebird');
const moment = require('moment');
const pRetry = require('p-retry');
const ms = require('ms');

const { timeoutMessages, testRunStatus, stepResult, runnerTestStatus } = require('../commons/constants');
const logger = require('../commons/logger').getLogger('base-worker');
const testResultService = require('../commons/socket/testResultService');
const remoteStepService = require('../commons/socket/remoteStepService');
const { isNetworkHealthy, didNetworkConnectivityTestFail } = require('../commons/httpRequest');
const testimServicesApi = require('../commons/testimServicesApi');
const gridService = require('../services/gridService');
const LambdatestService = require('../services/lambdatestService');
const reporter = require('../reports/reporter');
const utils = require('../utils');
const { releasePlayer } = require('./workerUtils');
const featureFlags = require('../commons/featureFlags');
const perf = require('../commons/performance-logger');
const {
    SeleniumError, StopRunOnError, GridError, GetBrowserError, NotImplementedError, PageNotAvailableError,
} = require('../errors');

const { GET_BROWSER_TIMEOUT_MSG, TEST_START_TIMEOUT_MSG, TEST_COMPLETE_TIMEOUT_MSG } = timeoutMessages;
const { SETUP_TIMEOUT, NETWORK_ERROR, GRID_ERROR, BROWSER_CLOSED, SELENIUM_ERROR, UNKNOWN_ERROR } = stepResult;

const DELAY_BETWEEN_TESTS = ms('1s');
let ordinal = 1;

function buildFailureResult(testId, testName, resultId, reason) {
    return {
        testId,
        reason,
        name: testName,
        resultId,
        success: false,
    };
}

class BaseWorker {
    constructor(executionQueue, options, customExtensionLocalLocation, executionId, onTestStarted, onTestCompleted, onGridSlot, onTestIgnored, releaseSlotOnTestFinished = true) {
        this.lambdatestService = new LambdatestService();

        this.id = BaseWorker.getWorkerId();
        this.executionQueue = executionQueue;
        this.customExtensionLocalLocation = customExtensionLocalLocation;

        this.isCodeMode = options.files && options.files.length > 0;
        this.baseUrl = options.baseUrl;
        this.isRegressionBaselineRun = options.isRegressionBaselineRun;
        this.testRunTimeout = options.timeout;
        this.onTestStarted = onTestStarted;
        this.onTestCompleted = onTestCompleted;
        this.onGridSlot = onGridSlot;
        this.onTestIgnored = onTestIgnored;
        this.releaseSlotOnTestFinished = releaseSlotOnTestFinished;

        this.userData = options.userData;
        this.executionId = executionId;
        this.options = options;
    }

    static getWorkerId() {
        return ordinal++;
    }

    getGridSlot(browser, testRunHandler) {
        return gridService.getGridSlot(browser, testRunHandler.getExecutionId(), testRunHandler.getTestResultId(), this.onGridSlot, this.options, this.id);
    }

    async getSlotOnce(testRunHandler) {
        const { browserValue } = this.testRunConfig;
        reporter.onGetSlot(this.id, browserValue || 'chrome');
        const gridInfo = await this.getGridSlot(browserValue, testRunHandler);
        return gridInfo;
    }

    initPlayer() {
        throw new NotImplementedError(true);
    }

    async getBrowserOnce() {
        throw new NotImplementedError(true);
    }

    async runTestOnce(testRunHandler, player) {
        testRunHandler.setSessionId(player.getSessionId());
        logger.info('Test run started', {
            testId: testRunHandler.getTestId(),
            resultId: testRunHandler.getTestResultId(),
            seleniumSession: player.getSessionId(),
        });

        return await testRunHandler.clearTestResult();
    }

    handleQuarantine(testRunHandler) {
        if (utils.isQuarantineAndNotRemoteRun({ testStatus: testRunHandler.getTestStatus() }, this.options)) {
            const testResult = {
                name: testRunHandler.getTestName(),
                testId: testRunHandler.getTestId(),
                resultId: testRunHandler.getTestResultId(),
                runnerStatus: runnerTestStatus.SKIPPED,
                testStatus: testRunHandler.getTestStatus(),
            };
            this.onTestIgnored(this.id, testResult);
            return testResult;
        }
        return undefined;
    }

    async getTestPlayer(testRunHandler, customExtensionLocalLocation) {
        const projectId = this.userData && this.userData.projectId;
        let testPlayer;

        try {
            perf.log('before getSlotOnce retries');
            let failedGetSlotAttempts = 0;

            let gridInfo = await pRetry(async () => {
                const startTime = Date.now();
                try {
                    return await Bluebird.resolve(this.getSlotOnce(testRunHandler))
                        .timeout(this.options.getBrowserTimeout, timeoutMessages.GET_BROWSER_TIMEOUT_MSG);
                } catch (error) {
                    logger.error('error getting grid slot', { error, testId: this.testId, testResultId: this.testResultId, executionId: this.executionId });
                    failedGetSlotAttempts++;
                    await utils.delay(this.options.getBrowserTimeout - (Date.now() - startTime));
                    throw error;
                }
            }, { retries: this.options.getBrowserRetries - 1, minTimeout: 0, factor: 1 });
            perf.log('after getSlotOnce retries');

            perf.log('before getBrowserOnce retries');
            const getBrowserRetriesNumber = this.options.getBrowserRetries - failedGetSlotAttempts;
            if (!getBrowserRetriesNumber) {
                throw new Error('No free browser slots in desired grid');
            }
            let failedGetBrowserAttempts = 0;
            testPlayer = await pRetry(async () => {
                const startTime = Date.now();
                const player = this.initPlayer(testRunHandler);
                try {
                    gridInfo = await gridService.handleHybridOrVendorIfNeeded(
                        this.options, gridInfo, this.testRunConfig, this.lambdatestService, { maxRetries: getBrowserRetriesNumber, currentRetry: failedGetBrowserAttempts + 1 },
                    );
                    this.options.gridData.provider = gridInfo.provider;
                    this.options.gridData.host = gridInfo.host;
                    this.options.gridData.failedGetBrowserAttempts = failedGetBrowserAttempts;
                    const getSessionTimeout = Math.max(this.lambdatestService.getSessionTimeout, this.options.getSessionTimeout);
                    const getBrowserRes = await Bluebird.resolve()
                        .log('before getBrowserOnce')
                        .then(() => this.getBrowserOnce(testRunHandler, customExtensionLocalLocation, player, gridInfo))
                        .log('after getBrowserOnce')
                        .timeout(getSessionTimeout, timeoutMessages.GET_BROWSER_TIMEOUT_MSG);
                    reporter.onGetBrowserSuccess(this.id, projectId);
                    return player || getBrowserRes;
                } catch (error) {
                    const grid = { provider: gridInfo.provider, host: gridInfo.host, failedGetBrowserAttempts, id: this.options.gridData.gridId, type: gridInfo.type };
                    logger.error('error getting browser from grid',
                        { error, testId: this.testId, testResultId: this.testResultId, executionId: this.executionId, grid });
                    reporter.onGetBrowserFailure(this.id, projectId, ++failedGetBrowserAttempts);
                    player.onDone();

                    if (!(error instanceof PageNotAvailableError)) {
                        await utils.delay(this.options.getBrowserTimeout - (Date.now() - startTime));
                    }
                    throw error;
                }
            }, { retries: getBrowserRetriesNumber - 1, minTimeout: 0, factor: 1 });
            perf.log('after getBrowserOnce retries');
        } catch (err) {
            await releasePlayer(this.id, this.releaseSlotOnTestFinished, projectId, testPlayer);
            if (err instanceof PageNotAvailableError) {
                throw err;
            }
            if (err instanceof GridError) {
                throw new GetBrowserError(err, GRID_ERROR);
            }
            throw new GetBrowserError(err, SELENIUM_ERROR);
        }

        return testPlayer;
    }

    async runTest(testRunHandler, customExtensionLocalLocation, shouldRerun) {
        perf.log('inside runTest');
        const projectId = this.userData && this.userData.projectId;
        const quarantineResult = this.handleQuarantine(testRunHandler);
        if (quarantineResult) {
            return quarantineResult;
        }

        perf.log('before runTest onTestStarted');
        const test = await this.onTestStarted(this.id, testRunHandler.getTestId(), testRunHandler.getTestResultId(), shouldRerun, testRunHandler.getRetryKey());
        testRunHandler._baseUrl = test.config.baseUrl;

        const testPlayer = await this.getTestPlayer(testRunHandler, customExtensionLocalLocation);
        try {
            return await this.runTestOnce(testRunHandler, testPlayer);
        } finally {
            await releasePlayer(this.id, this.releaseSlotOnTestFinished, projectId, testPlayer);
        }
    }

    async runTestCleanup() {
        return undefined;
    }

    onQueueCompleted() {
        return undefined;
    }

    run() {
        const runNextTest = () => process.nextTick(() => this.run());

        const onRunComplete = async (testResult, testRunHandler, err) => {
            if (utils.isQuarantineAndNotRemoteRun(testResult, this.options)) {
                return runNextTest();
            }
            const sessionId = testRunHandler.getSessionId();

            const isTimeoutError = (timeoutMsg) => err.message.includes(timeoutMsg);
            const isIgnoreErrors = err && (err instanceof GetBrowserError);
            const isTimeoutErrors = err && (isTimeoutError(TEST_START_TIMEOUT_MSG) || isTimeoutError(TEST_COMPLETE_TIMEOUT_MSG));

            const shouldRerun =
                !testResult.success &&
                (
                    (testRunHandler.hasMoreRetries() && !isIgnoreErrors && !isTimeoutErrors) ||
                    (isTimeoutErrors && testRunHandler.hasMoreTimeoutRetries())
                );

            try {
                const testRetryKey = testRunHandler.getRetryKey();
                testResult.testRetryKey = testRetryKey;
                await this.onTestCompleted(this.id, this.testId, testResult, sessionId, shouldRerun);
                if (this.executionQueue.hasMoreTests() && !(this.options.lightweightMode && this.options.lightweightMode.general)) {
                    await utils.delay(DELAY_BETWEEN_TESTS);
                }
                await this.runTestCleanup();
                if (shouldRerun) {
                    if (isTimeoutErrors) {
                        await testRunHandler.startNewTimeoutRetry();
                    } else {
                        await testRunHandler.startNewRetry();
                    }
                    logger.info(`retry test id: ${this.testId} name: ${this.testName} again`, {
                        testId: this.testId,
                        testName: this.testName,
                        isTimeoutErrors,
                        testRetryKey,
                        totalRetries: testRunHandler._totalRetryCount,
                    });
                    this.testResultId = testRunHandler.getTestResultId();
                    return await runTestAndCalcResult(testRunHandler, shouldRerun);
                }
                return await runNextTest();
            } catch (err) {
                if (err instanceof StopRunOnError) {
                    return undefined;
                }
                logger.error('failed to process test result', { err });
                runNextTest();
                return undefined;
            }
        };
        const getNetworkErrorMessage = () => 'Due to network connectivity issues, Testim CLI has been unable to connect to the grid.\n' +
                                             `Please make sure the CLI has stable access to the internet. ${didNetworkConnectivityTestFail() ? '(Internal: network connectivity test failed)' : ''}`;

        const buildError = (err, wasNetworkHealthy) => {
            if (!wasNetworkHealthy && featureFlags.flags.errorMessageOnBadNetwork.isEnabled()) {
                return {
                    errorType: NETWORK_ERROR,
                    reason: getNetworkErrorMessage(),
                };
            }

            const msg = err instanceof Error ? err.message : err;
            if (msg.includes(GET_BROWSER_TIMEOUT_MSG)) {
                return { errorType: SETUP_TIMEOUT, reason: "Test couldn't get browser" };
            }
            if (msg.includes(TEST_START_TIMEOUT_MSG)) {
                return { errorType: SETUP_TIMEOUT, reason: "Test couldn't be started" };
            }
            if (msg.includes(TEST_COMPLETE_TIMEOUT_MSG)) {
                if (!this.testRunTimeout) {
                    return { errorType: SETUP_TIMEOUT, reason: 'Test timeout reached: test is too long' };
                }
                const duration = moment.duration(this.testRunTimeout, 'milliseconds');
                const minutesCount = Math.floor(duration.asMinutes());
                const secondsCount = duration.seconds();
                const minutesTimeoutStr = minutesCount > 0 ? ` ${minutesCount} min` : '';
                const secondsTimoutStr = secondsCount > 0 ? ` ${secondsCount} sec` : '';
                return { errorType: SETUP_TIMEOUT, reason: `Test timeout reached (timeout:${minutesTimeoutStr}${secondsTimoutStr}): test is too long` };
            }

            if (err instanceof GetBrowserError && err.type) {
                if (err.type === GRID_ERROR) {
                    return { errorType: GRID_ERROR, reason: `Test couldn't get browser from grid - ${err.message}` };
                }
                if (err.type === SELENIUM_ERROR) {
                    return { errorType: SELENIUM_ERROR, reason: `Failed to create new session - ${err.message}` };
                }
            }

            if (err.type === BROWSER_CLOSED) {
                return { errorType: SELENIUM_ERROR, reason: 'Session terminated, it is possible that the cli could not connect to the grid to send keep-alive requests for a prolonged period' };
            }
            if (err.failure && err.failure instanceof SeleniumError) {
                return { errorType: SELENIUM_ERROR, reason: `Test couldn't get browser from grid - ${err.failure.message}` };
            }
            if (/SeleniumError: connect ECONNREFUSED/.test(err.message) || /Couldn't connect to selenium server/.test(err.message)) {
                return { errorType: SELENIUM_ERROR, reason: 'Failed to connect to the grid, please check if the grid is accessible from your network' };
            }
            if (/terminated due to FORWARDING_TO_NODE_FAILED/.test(err.message)) {
                return { errorType: SELENIUM_ERROR, reason: 'Session terminated, it is likely that the grid is out of memory or not responding, please try to rerun the test' };
            }
            if (/terminated due to PROXY_REREGISTRATION/.test(err.message)) {
                return { errorType: SELENIUM_ERROR, reason: 'Session terminated, it is likely that the grid is not responding, please try to rerun the test' };
            }
            if (/forwarding the new session cannot find : Capabilities/.test(err.message)) {
                return { errorType: SELENIUM_ERROR, reason: 'Session could not be created, please check that the browser you requested is supported in your plan' };
            }
            return { errorType: UNKNOWN_ERROR, reason: msg };
        };

        const onRunError = async (err, testRunHandler) => {
            const wasNetworkHealthy = await isNetworkHealthy();
            if (!wasNetworkHealthy && featureFlags.flags.warnOnBadNetwork.isEnabled()) {
                // intentional, we want to log to stderr:
                // eslint-disable-next-line no-console
                console.warn(getNetworkErrorMessage());
            }
            logger.warn('error on run', { err });

            const projectId = this.userData && this.userData.projectId;
            const { errorType, reason } = buildError(err, wasNetworkHealthy);
            testimServicesApi.updateTestResult(projectId, this.testResultId, this.testId, {
                status: testRunStatus.COMPLETED,
                success: false,
                reason,
                errorType,
                testRetryKey: testRunHandler.getRetryKey(),
                setupStepResult: { status: testRunStatus.COMPLETED, success: false, reason, errorType },
            }, testRunHandler.getRemoteRunId());
            await onRunComplete(buildFailureResult(this.testId, this.testName, this.testResultId, reason), testRunHandler, err);
        };

        const recoverTestResults = async (runError, testRunHandler) => {
            const testId = this.testId;
            const resultId = this.testResultId;
            const projectId = this.userData && this.userData.projectId;
            const branch = this.branch;
            if (!testId || !resultId || !projectId || !branch) {
                // Not enough data to call the API
                logger.warn('Test failed. Not enough data to recover results via API', { err: runError });
                return onRunError(runError, testRunHandler);
            }

            try {
                const testResult = await testimServicesApi.getTestResults(testId, resultId, projectId, branch);
                logger.warn('Test failed. Got results via API', { err: runError, testResult });
                if (testResult && testResult.status === testRunStatus.COMPLETED) {
                    return await onRunComplete(testResult, testRunHandler);
                }
                throw runError;
            } catch (err) {
                if (err !== runError) {
                    logger.error('Failed to fetch test results from server', {
                        testId,
                        resultId,
                        projectId,
                        branch,
                        err,
                    });
                }
                return onRunError(runError, testRunHandler);
            }
        };

        const disableResults = this.options.disableSockets || (this.options.lightweightMode && this.options.lightweightMode.disableResults && (this.options.useChromeLauncher || this.options.mode !== 'extension'));
        const disableRemoteStep = this.options.disableSockets || (this.options.lightweightMode && this.options.lightweightMode.disableRemoteStep);

        const runTestAndCalcResult = (testRunHandler, shouldRerun) => Promise.all([
            !disableRemoteStep && remoteStepService.joinToRemoteStep(this.testResultId),
            !disableResults && testResultService.joinToTestResult(this.testResultId, this.testId),
        ])
            .then(() => testRunHandler.validateRunConfig())
            .then(() => this.runTest(testRunHandler, this.customExtensionLocalLocation, shouldRerun))
            .then(testResult => onRunComplete(testResult, testRunHandler))
            .then(result => {
                perf.log('After onRunComplete');
                return result;
            })
            .catch(runError => recoverTestResults(runError, testRunHandler))
            .finally(() => {
                if (!disableRemoteStep) {
                    remoteStepService.unlistenToRemoteStep(this.testResultId);
                }
            });

        const testRunHandler = this.executionQueue.getNext();
        if (!testRunHandler) { // no more tests to run
            return this.onQueueCompleted();
        }
        this.testId = testRunHandler.getTestId();
        this.testName = testRunHandler.getTestName();
        this.testResultId = testRunHandler.getTestResultId();
        this.overrideTestConfigId = testRunHandler.getOverrideTestConfigId();
        this.testRunConfig = testRunHandler.getRunConfig();
        this.branch = testRunHandler.getBranch();
        return runTestAndCalcResult(testRunHandler);
    }
}

module.exports = BaseWorker;

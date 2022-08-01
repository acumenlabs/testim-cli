'use strict';

const Promise = require('bluebird');

const { timeoutMessages } = require('../commons/constants');
const { PageNotAvailableError } = require('../errors');
const BaseWorker = require('./BaseWorker');
const logger = require('../commons/logger').getLogger('worker-selenium');
const reporter = require('../reports/reporter');
const SeleniumTestPlayer = require('../player/seleniumTestPlayer');
const WindowUtils = require('../player/utils/windowUtils');
const sessionPlayerInit = require('../commons/getSessionPlayerRequire');
const perf = require('../commons/performance-logger');
const { preloadTests } = require('../commons/preloadTests');

// this navigation timeout is handled from outside the worker, so don't pass a small timeout to navigate
const NO_NAVIGATION_TIME_LIMIT = 1e9;

class WorkerSelenium extends BaseWorker {
    constructor(...args) {
        super(...args);
        this.getBrowserOnce = Promise.method(this.getBrowserOnce);
    }

    initPlayer(testRunHandler) {
        return new SeleniumTestPlayer(this.id,
            testRunHandler.getRunParams(),
            this.options.shouldMonitorPerformance,
            testRunHandler.getAutomationMode(),
            undefined,
            testRunHandler.getRetryCount(),
            testRunHandler.getPreviousTestResultId());
    }

    async getBrowserOnce(testRunHandler, customExtensionLocalLocation, seleniumTestPlayer, gridInfo) {
        perf.log('in WorkerSelenium getBrowserOnce');
        reporter.onGetSession(this.id, this.testName, testRunHandler.getRunMode());
        const { driver } = seleniumTestPlayer;

        this.windowUtils = new WindowUtils(this.id, driver);
        seleniumTestPlayer.clearSessionTabs();

        const { browserValue } = this.testRunConfig;
        const baseUrl = testRunHandler.getBaseUrl();

        try {
            const fastInit = this.options.useLocalChromeDriver;
            await driver.init(
                this.options,
                this.testName,
                this.testRunConfig,
                gridInfo,
                customExtensionLocalLocation,
                this.executionId,
                this.testResultId,
                testRunHandler.seleniumPerfStats,
                fastInit,
                this.lambdatestService
            );
            perf.log('in WorkerSelenium after driver.init');
            await seleniumTestPlayer.addTab(undefined, { skipLoadInfo: fastInit });
            perf.log('in WorkerSelenium after addTab');
            if (!fastInit) {
                await this.windowUtils.navigate(baseUrl, NO_NAVIGATION_TIME_LIMIT);
            }
            await this.windowUtils.validatePageIsAvailable();
            perf.log('in WorkerSelenium after navigate');
        } catch (err) {
            const firefoxPageNotAvailable = err.message && (err.message.startsWith('Malformed URL') || err.message.includes('Reached error page: about:neterror')) &&
                browserValue === 'firefox';

            const invalidURL = (err.message && err.message === 'invalid argument');

            if (err instanceof PageNotAvailableError || firefoxPageNotAvailable || invalidURL) {
                throw new PageNotAvailableError(`Page '${baseUrl}' is not available`);
            }

            logger.error('failed to navigate to page', { err });
            throw err;
        }
    }

    async runTestOnce(testRunHandler, seleniumTestPlayer) {
        const { driver, sessionPlayer } = seleniumTestPlayer;
        const version = sessionPlayerInit.manifestVersion || 'runner';

        reporter.onWaitToTestComplete(this.id, this.isCodeMode);

        setupCliPerformanceMonitoring(sessionPlayer);

        sessionPlayer.playbackManager.executionId = testRunHandler.getExecutionId();
        sessionPlayer.playbackManager.executionName = testRunHandler.getExecutionName();

        sessionPlayer.setLightweightMode(this.options.lightweightMode);
        if (sessionPlayerInit.localAssetService) {
            sessionPlayerInit.localAssetService.initialize({ serverUrl: this.options.localRCASaver });
        }

        let preloadedTest = null;
        if (this.options.lightweightMode && this.options.lightweightMode.preloadTests) {
            const preloadedTests = await preloadTests(this.options);
            preloadedTest = preloadedTests[this.testId];
        }

        async function runSeleniumTest() {
            if (testRunHandler.getAutomationMode() === 'codeful') {
                // Testim Development Kit test;
                if (!sessionPlayer.callOrderScheduler) { // old session player
                    await testRunHandler.waitForExecutionStartedFinished();
                } else {
                    sessionPlayer.callOrderScheduler.schedule(() =>
                        // this key is shared by clickim and this ensures that we do wait for the execution to be created before we do this.
                        testRunHandler.waitForExecutionStartedFinished(),
                    { key: `test-result:${this.userData.projectId}:${this.testResultId}` });
                }
                perf.log('right before playTestByCode');
                return new Promise((resolve, reject) => sessionPlayer.playTestByCode(
                    this.testId,
                    this.executionId,
                    this.testResultId,
                    this.baseUrl,
                    this.userData,
                    version,
                    resolve,
                    false,
                    this.overrideTestConfigId,
                    this.branch,
                    testRunHandler.getCode(),
                    testRunHandler.getTestName()
                ).catch(reject))
                    .log('right after playTestByCode')
                    .timeout(this.testRunTimeout, timeoutMessages.TEST_COMPLETE_TIMEOUT_MSG)
                    .catch(Promise.TimeoutError, err => {
                        if (sessionPlayer.stopPlayingOnTestTimeout) {
                            sessionPlayer.stopPlayingOnTestTimeout();
                        }
                        throw err;
                    })
                    .then(testResult => {
                        testResult.resultId = this.testResultId;
                        return testResult;
                    });
            }
            const INCOGNITO = false;

            return new Promise((resolve, reject) =>
                sessionPlayer.playByTestId(
                    this.testId,
                    this.executionId,
                    this.testResultId,
                    this.baseUrl,
                    this.userData,
                    version,
                    resolve,
                    false,
                    this.overrideTestConfigId,
                    this.branch,
                    INCOGNITO,
                    testRunHandler.getRemoteRunId(),
                    undefined,
                    undefined,
                    preloadedTest
                ).catch(reject))
                .timeout(this.testRunTimeout, timeoutMessages.TEST_COMPLETE_TIMEOUT_MSG)
                .catch(Promise.TimeoutError, err => {
                    if (sessionPlayer.stopPlayingOnTestTimeout) {
                        sessionPlayer.stopPlayingOnTestTimeout();
                    }
                    throw err;
                })
                .then(async testResult => {
                    if (sessionPlayerInit.localAssetService) {
                        await sessionPlayerInit.localAssetService.drain();
                    }
                    testResult.stepsResults = null;
                    testResult.resultId = this.testResultId;
                    if (!driver.isAlive()) {
                        logger.warn(`possible grid unresponsive for test ${this.testId}, result ${this.testResultId} (execution: ${this.executionId})`);
                        testResult.gridIssues = 'could not validate grid is alive';
                    }
                    const maxKeepAliveGap = driver.maxKeepAliveGap();
                    const MAX_KEEP_ALIVE_GAP = 30000;
                    if (maxKeepAliveGap >= MAX_KEEP_ALIVE_GAP) {
                        logger.warn(`possible browser keep alive issue ${this.testId}, result ${this.testResultId} (execution: ${this.executionId})`);
                        testResult.keepAliveIssue = maxKeepAliveGap;
                    }
                    const resultWithStats = { ...testResult, ...testRunHandler.seleniumPerfStats.getStats() };
                    if (this.lambdatestService.isLambdatestRun()) {
                        await driver.executeJS(`lambda-status=${!resultWithStats.success ? 'failed' : 'passed'}`).catch(() => { });
                    }
                    return resultWithStats;
                });
        }

        driver.start();

        perf.log('right before super.runTestOnce in workerSelenium');
        return super.runTestOnce(testRunHandler, seleniumTestPlayer)
            .log('right after super.runTestOnce in workerSelenium')
            .then(runSeleniumTest.bind(this))
            .log('right after runSeleniumTest')
            .catch(err => {
                logger.error('failed to run test once', { err });
                throw err;
            });
    }
}
function setupCliPerformanceMonitoring(sessionPlayer) {
    const { playback } = sessionPlayerInit.commonConstants;
    function monitorEvent(event) {
        sessionPlayer.playbackManager.on(event, (...args) => {
            perf.log(`Got event ${event}`);
        });
    }
    Object.values(playback).forEach(monitorEvent);
}
module.exports = WorkerSelenium;

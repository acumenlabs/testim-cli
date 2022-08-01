'use strict';

const Promise = require('bluebird');

const { timeoutMessages, stepResult } = require('../commons/constants');
const BaseWorker = require('./BaseWorker');
const logger = require('../commons/logger').getLogger('worker-ext');
const perf = require('../commons/performance-logger');
const ExtensionTestPlayer = require('../player/extensionTestPlayer');
const ChromeLauncherTestPlayer = require('../player/chromeLauncherTestPlayer');
const reporter = require('../reports/reporter');

const TEST_START_TIMEOUT_MS = parseInt(process.env.TESTIM_TEST_START_TIMEOUT, 10) || (2 * 60 * 1000);

class WorkerExtension extends BaseWorker {
    initPlayer() {
        if (this.options.useChromeLauncher) {
            return new ChromeLauncherTestPlayer(this.id);
        }
        return new ExtensionTestPlayer(this.id);
    }

    async _getBrowserOnce(testRunHandler, customExtensionLocalLocation, player, gridInfo) {
        const { driver } = player;
        try {
            return await driver.init(
                this.options,
                this.testName,
                this.testRunConfig,
                gridInfo,
                customExtensionLocalLocation,
                this.executionId,
                this.testResultId,
                testRunHandler.seleniumPerfStats,
                this.options.lightweightMode && this.options.lightweightMode.general,
                this.lambdatestService
            );
        } catch (err) {
            logger.error('failed to get browser', {
                err,
                gridInfo,
                testId: testRunHandler.getTestId(),
                resultId: testRunHandler.getTestResultId(),
            });
            throw err;
        }
    }

    async getBrowserOnce(testRunHandler, customExtensionLocalLocation, player, gridInfo) {
        reporter.onGetSession(this.id, this.testName, testRunHandler.getRunMode());
        return this._getBrowserOnce(testRunHandler, customExtensionLocalLocation, player, gridInfo);
    }

    runTestOnce(testRunHandler, player) {
        const { driver } = player;
        const { testResultId, executionId, testId } = this;
        perf.log('WorkerExtension runTestOnce');

        const runExtTest = (testRunHandler) => {
            perf.log('WorkerExtension runExtTest');
            const disableRemoteStep = (this.options.lightweightMode && this.options.lightweightMode.disableRemoteStep) || this.options.disableSockets;
            if (!disableRemoteStep) {
                testRunHandler.listenToRemoteStep(driver);
            }
            if (this.options.useChromeLauncher) {
                const testTimeout = this.options.timeoutWasGiven ?
                    Math.max(10000, this.options.timeout) :
                    TEST_START_TIMEOUT_MS;

                reporter.onWaitToTestStart(this.id);
                reporter.onWaitToTestComplete(this.id, this.isCodeMode);
                return Promise.resolve(testRunHandler.runTestUsingCDP(driver.cdpTestRunner))
                    .timeout(testTimeout, timeoutMessages.TEST_START_TIMEOUT_MSG)
                    .catch(Promise.TimeoutError, () => {
                        logger.warn('timeout while running test using CDP. Running checkViaRestAPIIfTestStarted', { testResultId });
                        return testRunHandler.checkViaRestAPIIfTestStarted();
                    })
                    .then(testResult => ({ ...testResult, ...testRunHandler.seleniumPerfStats.getStats() }))
                    .catch(err => {
                        logger.warn('failed to run test via CDP', { err });
                        throw err;
                    });
            }

            const startStausDetails = { driverUrlFinished: false, testRunHandlerStartedFinished: false }; //for logging / debugging purposes
            return new Promise((resolve, reject) => testRunHandler.getRunTestUrl()
                .then(url => {
                    reporter.onWaitToTestStart(this.id);
                    return Promise.all([
                        driver.url(url).tap(() => { startStausDetails.driverUrlFinished = true; }).catch(err => {
                            logger.error('error from driver.url', { err, testResultId, executionId, testId, url, urlLength: url.length });
                            throw err;
                        }),
                        testRunHandler.onStarted(TEST_START_TIMEOUT_MS).tap(() => { startStausDetails.testRunHandlerStartedFinished = true; }),
                    ])
                        .timeout(TEST_START_TIMEOUT_MS, timeoutMessages.TEST_START_TIMEOUT_MSG)
                        .catch(Promise.TimeoutError, () => {
                            logger.warn('timeout occurred (see log\'s payload). Running checkViaRestAPIIfTestStarted', { testResultId, executionId, testId, ...startStausDetails });
                            return testRunHandler.checkViaRestAPIIfTestStarted();
                        });
                })
                .then(() => {
                    reporter.onWaitToTestComplete(this.id, this.isCodeMode);
                    const onBrowserClosed = (err) => {
                        testRunHandler.onCompletedCleanup();
                        logger.warn('on browser closed error detected', { err, testResultId, executionId, testId });
                        driver.unregisterToClosedBrowser(onBrowserClosed);
                        err.type = stepResult.BROWSER_CLOSED;
                        reject(err);
                    };
                    driver.registerToClosedBrowser(onBrowserClosed);
                    return testRunHandler.onCompleted().timeout(this.testRunTimeout, timeoutMessages.TEST_COMPLETE_TIMEOUT_MSG)
                        .then(async testResult => {
                            driver.unregisterToClosedBrowser(onBrowserClosed);
                            if (this.lambdatestService.isLambdatestRun()) {
                                await driver.executeJS(`lambda-status=${!testResult.success ? 'failed' : 'passed'}`).catch(() => { });
                            }
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
                            resolve({ ...testResult, ...testRunHandler.seleniumPerfStats.getStats() });
                        })
                        .catch(err => {
                            logger.warn('timeout wait until test completed', { err, testResultId, executionId, testId });
                            // complete time out
                            reject(new Error(err));
                        })
                        .finally(() => {
                            driver.unregisterToClosedBrowser(onBrowserClosed);
                        });
                })
                .catch(err => {
                    logger.warn('failed to start url', { err });
                    reject(new Error(err));
                }));
        };

        driver.start();

        return super.runTestOnce(testRunHandler, player)
            .log('WorkerExtension super.runTestOnce')
            .then(() => runExtTest(testRunHandler))
            .catch(err => {
                logger.error('failed to run test', {
                    err,
                    testId: testRunHandler.getTestId(),
                    resultId: testRunHandler.getTestResultId(),
                });
                return Promise.reject(err);
            });
    }
}

module.exports = WorkerExtension;

'use strict';

const Bluebird = require('bluebird');
const { releasePlayer } = require('./workerUtils');
const WorkerExtension = require('./WorkerExtension');
const perf = require('../commons/performance-logger');
const reporter = require('../reports/reporter');
const logger = require('../commons/logger').getLogger('base-worker');

const DELAY_BETWEEN_TESTS = 500;

class WorkerExtensionSingleBrowser extends WorkerExtension {
    async _releasePlayer() {
        if (!this.testPlayer) {
            return;
        }
        await releasePlayer(this.id, this.releaseSlotOnTestFinished, this.userData && this.userData.projectId, this.testPlayer);
        this.testPlayer = null;
    }

    onQueueCompleted() {
        return this._releasePlayer();
    }

    async getBrowserOnce(testRunHandler, customExtensionLocalLocation, player, gridInfo) {
        reporter.onGetSession(this.id, `worker ${this.id}`, testRunHandler.getRunMode());
        return this._getBrowserOnce(testRunHandler, customExtensionLocalLocation, player, gridInfo);
    }

    async getTestPlayer(testRunHandler, customExtensionLocalLocation) {
        if (this.testPlayer && !this.testPlayer.driver.isAlive()) {
            logger.warn('WorkerExtensionSingleBrowser is releasing a dead player', { workerId: this.id });
            await this._releasePlayer();
        }
        if (!this.testPlayer) {
            this.testPlayer = await super.getTestPlayer(testRunHandler, customExtensionLocalLocation);
        }
        return this.testPlayer;
    }

    async runTest(testRunHandler, customExtensionLocalLocation, shouldRerun) {
        const quarantineResult = this.handleQuarantine(testRunHandler);
        if (quarantineResult) {
            return quarantineResult;
        }

        perf.log('before runTest onTestStarted single browser');
        const test = await this.onTestStarted(this.id, testRunHandler.getTestId(), testRunHandler.getTestResultId(), shouldRerun, testRunHandler.getRetryKey());
        testRunHandler._baseUrl = test.config.baseUrl;
        const testPlayer = await this.getTestPlayer(testRunHandler, customExtensionLocalLocation);

        testRunHandler.markClearBrowser();
        return await this.runTestOnce(testRunHandler, testPlayer);
    }

    async runTestCleanup() {
        if (!this.executionQueue.hasMoreTests()) {
            await this.onQueueCompleted();
            return;
        }
        if (this.options.lightweightMode && this.options.lightweightMode.general) {
            await Bluebird.delay(DELAY_BETWEEN_TESTS);
        }
    }
}

module.exports = WorkerExtensionSingleBrowser;

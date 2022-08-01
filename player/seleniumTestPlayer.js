'use strict';

const TabService = require('./services/tabService');
const PortSelector = require('./services/portSelector');
const windowCreationListener = require('./services/windowCreationListener');
const CookieUtils = require('./utils/cookieUtils');
const frameLocatorFactory = require('./services/frameLocator');
const Promise = require('bluebird');
const { isDebuggerConnected } = require('../commons/detectDebugger');

const sessionPlayer = require('../commons/getSessionPlayerRequire');

const player = sessionPlayer.sessionPlayer;
// delete after https://github.com/testimio/clickim/pull/3430 release to the store
const assetService = sessionPlayer.assetService;
const commonConstants = sessionPlayer.commonConstants;
const StepActionFactory = sessionPlayer.stepActionFactory;
const PlaybackTimeoutCalculator = require('./services/playbackTimeoutCalculator');
const testResultService = require('../commons/socket/testResultService');

const WebDriver = require('./webdriver');
// delete after https://github.com/testimio/clickim/pull/3430 release to the store
const CryptoJS = require('crypto-js');
const StepActionUtils = require('./utils/stepActionUtils');

class SeleniumTestPlayer {
    constructor(id, userParamsData, shouldMonitorPerformance, automationMode = 'code', driver = new WebDriver(), testRetryCount, previousTestResultId) {
        this.driver = driver;
        this.id = id;

        const stepActionUtils = new StepActionUtils(this.driver);
        this.stepActionFactory = new StepActionFactory(stepActionUtils);
        require('./stepActions/stepActionRegistrar')(this.driver, this.stepActionFactory, 'selenium');

        if (assetService.setMd5) {
            // delete after https://github.com/testimio/clickim/pull/3430 release to the store
            assetService.setMd5(CryptoJS);
        }
        this.tabService = this.driver.tabService || new TabService(this.driver);
        // expose the tabService on the driver so future sessions reusing the driver
        // know the tabs (for example - a TDK Hybrid step)
        this.driver.tabService = this.tabService;
        this.windowCreationListener = windowCreationListener;
        this.playbackTimeoutCalculator = new PlaybackTimeoutCalculator(isDebuggerConnected());

        this.tabService.createSesion(id);

        const FrameLocator = frameLocatorFactory(this.driver);

        this.sessionPlayer = new player(
            id,
            this.tabService,
            CookieUtils(this.driver),
            windowCreationListener,
            FrameLocator,
            PortSelector,
            null,
            null /* Not in use, placeholder for the order of arguments */,
            stepActionUtils,
            this.stepActionFactory,
            this.playbackTimeoutCalculator,
            testResultService.getSocket(),
            automationMode,
        );

        if (this.sessionPlayer.setShouldMonitorPerformance) {
            this.sessionPlayer.setShouldMonitorPerformance(shouldMonitorPerformance);
        }

        this.tabService.setAddFrameHandlerCallBack(this.sessionPlayer.addPlaybackFrameHandler.bind(this.sessionPlayer));

        this.sessionPlayer.playbackManager.isRemoteSession = true;
        this.sessionPlayer.playbackManager.isLocalRun = false;
        this.sessionPlayer.playbackManager.testRetryCount = testRetryCount;
        this.sessionPlayer.playbackManager.previousTestResultId = previousTestResultId;

        this.sessionPlayer.playbackManager.userParamsData = userParamsData || {};

        this.onStepCompleted = this.onStepCompleted.bind(this);

        this.sessionPlayer.playbackManager.on(commonConstants.playback.RESULT, this.onStepCompleted);
    }

    onStepCompleted(result, testId, resultId, step) {
        if (step && step.isTabOpener) {
            this.tabService.addNewPopup(this.id, step.id)
                .catch(() => { });
        }
    }

    onDone() {
        const END_DRIVER_TIMEOUT = 1000 * 60 * 2;
        return this.driver.end()
            .timeout(END_DRIVER_TIMEOUT)
            .catch(Promise.TimeoutError, () => this.driver.forceEnd())
            .catch(() => { })
            .then(() => {
                this.sessionPlayer.playbackManager.off(commonConstants.playback.RESULT, this.onStepCompleted);
                this.sessionPlayer = null;
                this.tabService = null;
                this.stepActionFactory = null;
                this.driver = null;
            });
    }

    clearSessionTabs() {
        this.tabService.clearAllTabs(this.id);
    }

    addTab(openerStepId, options = { loadInfo: true }) {
        return this.driver.getTabIds()
            .tap(ids => this.tabService.addNewTab(this.id, ids[ids.length - 1], openerStepId, options))
            .then(ids => this.sessionPlayer.addPlaybackFrameHandler(ids[ids.length - 1], undefined, { emptyPage: true }));
    }

    async addAllTabs(openerStepId, options = { loadInfo: true, checkForMainTab: true, takeScreenshots: true }, blackList = []) {
        const ids = await this.driver.getTabIds();
        // the ids are reversed so we search first in the last tab opened - otherwise it starts looking from the testim editor and not the AUT

        const PROHIBITED_URLS = ['app.testim.io'].concat(blackList);
        for (const id of ids.reverse()) {
            await this.tabService.addNewTab(this.id, id, openerStepId, { ...options, forceSwitch: true });
            const tabInfo = this.tabService.getTabInfo(this.id, id);
            if (PROHIBITED_URLS.some(bad => tabInfo.url.includes(bad))) {
                await this.tabService.removeTabInfo(this.id, id);
                continue;
            }
            await this.sessionPlayer.addPlaybackFrameHandler(id, undefined, { emptyPage: true });
        }
        if (this.tabService.tabCount(this.id) === 1) {
            // if we only have one tab because we removed the editor tab - we have to switchTab to one of the other tabs, otherwise
            // tabService will assume it's on a good context but it's not.
            const tabInfo = this.tabService.getMainTabInfo(this.id);
            const utils = this.tabService.getTabUtils(this.id, tabInfo);
            await this.tabService.switchTab(utils.tabId, this.id, { forceSwitch: true });
        }
        // deal with checkForMainTab failing due to the page refreshing or JavaScript not responding or a similar issue
        this.tabService.fixMissingMainTab(this.id);
    }

    getSessionId() {
        return this.driver.getSessionId();
    }
}

module.exports = SeleniumTestPlayer;

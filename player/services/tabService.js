'use strict';

const sessionPlayer = require('../../commons/getSessionPlayerRequire');

const Promise = require('bluebird');
const WindowUtils = require('../utils/windowUtils');
const ScreenshotUtils = require('../utils/screenshotUtils');
const ImageCaptureUtils = require('../utils/imageCaptureUtils');
const guid = require('../../utils').guid;

const UrlUtils = sessionPlayer.urlUtils;
const semver = require('semver');

const constants = sessionPlayer.commonConstants.stepResult;
const tabMatcher = sessionPlayer.tabMatcher;
const logger = require('../../commons/logger').getLogger('tab-service');

class TabService {
    constructor(driver) {
        this.driver = driver;
        this._utils = {};
        this.sessionTabs = {};
        this.pendingTabs = {};
        this.addedTabs = {};
    }

    on() {}

    tabCount(sessionId) {
        if (this.sessionTabs[sessionId]) {
            return this.sessionTabs[sessionId].tabCount;
        }
        return undefined;
    }

    getAllOpenTabIds(sessionId) {
        const allTabInfos = this.getAllTabInfos(sessionId);
        return Object.keys(allTabInfos)
            .filter(tabId => !allTabInfos[tabId].isClosed);
    }

    /**
     * Get last tab info for pixel validation
     *
     * @returns last tab info
     */
    getActiveTabInfo(sessionId) {
        return this.sessionTabs[sessionId].lastActiveTabInfo;
    }

    getAllTabIds(sessionId) {
        return Object.keys(this.getAllTabInfos(sessionId)).map(id => id);
    }

    isSessionTab(sessionId, tabId) {
        return this.getAllTabIds(sessionId).includes(tabId);
    }

    createSesion(sessionId) {
        if (this.sessionTabs[sessionId]) { // joining an existing session
            return;
        }
        this.addedTabs[sessionId] = new Set();
        this.sessionTabs[sessionId] = {
            tabCount: 0,
            tabInfos: {},
        };
    }

    setAddFrameHandlerCallBack(addFrameHandlerCb) {
        this.addFrameHandler = addFrameHandlerCb;
    }

    getAllTabInfoStrings(sessionId) {
        const allIds = this.getAllTabIds(sessionId);
        return allIds.map(tabId => {
            const tabInfo = this.getTabInfo(sessionId, tabId);
            return `tabId=${tabId}, url=${tabInfo.url}, order=${tabInfo.order}, isMain=${tabInfo.isMain}, openerStepId=${tabInfo.openerStepId}, isClosed=${tabInfo.isClosed}, currentUrl: ${tabInfo.currentUrl}, lastUpdatedUrl: ${tabInfo.lastUpdatedUrl}`;
        });
    }

    getAllTabInfos(sessionId) {
        return this.sessionTabs[sessionId].tabInfos;
    }

    addNewTab(sessionId, tabId, openerStepId, options = {}) {
        if (this.addedTabs[sessionId].has(tabId)) {
            return Promise.resolve();
        }
        this.addedTabs[sessionId].add(tabId);
        logger.info(`Adding a new tab sessionId: ${sessionId}, tabId: ${tabId}, openerId: ${openerStepId}`);
        return this.addTab(sessionId, tabId, this.sessionTabs[sessionId].tabCount++, openerStepId, options);
    }

    addOpenerStepId(sessionId, tabId, openerStepId) {
        this.sessionTabs[sessionId].tabInfos[tabId].openerStepId = openerStepId;
    }
    addOpenerStep(sessionId, tabId, openerStep) {
        this.sessionTabs[sessionId].tabInfos[tabId].openerStepId = openerStep.id;
        this.sessionTabs[sessionId].tabInfos[tabId].openerOriginalStepId = openerStep.originalStepId;
    }

    fixMissingMainTab(sessionId) {
        const mainTab = this.getMainTabInfo(sessionId);
        if (mainTab) {
            return;
        }
        const allTabInfos = this.getAllTabInfos(sessionId);
        if (Object.keys(allTabInfos).length === 0) {
            // no tab infos 🤷
            return;
        }
        Object.values(this.getAllTabInfos(sessionId))[0].isMain = true;
    }

    buildTabInfo(sessionId, tabId, order, openerStepId, options = {}) {
        return this.getTabDetails(tabId, sessionId, options)
            .then(tab => {
                const infoId = guid();

                function isMainTab(tabService) {
                    if (options.checkForMainTab) {
                        return tab.isMainTab;
                    }

                    if (!tab.isMainTab || tab.isMainTab === 'unknown') {
                        const missingMainTab = !tabService.getMainTabInfo(sessionId);
                        return missingMainTab;
                    }
                    return tab.isMainTab;
                }
                this.sessionTabs[sessionId].tabInfos[tabId] = {
                    infoId,
                    url: tab.url,
                    title: tab.title,
                    favIconUrl: tab.favIconUrl,
                    order,
                    from: this.getTabInfo(sessionId, tab.openerTabId),
                    isMain: isMainTab(this),
                    openerStepId,
                };

                return infoId;
            });
    }

    addTab(sessionId, id, order, openerStepId, options = {}) {
        return this.buildTabInfo(sessionId, id, order, openerStepId, options)
            .then(infoId => {
                const _windowUtils = new WindowUtils(id, this.driver);
                this._utils[infoId] = {
                    attachDebugger: () => Promise.resolve(),
                    detachDebugger: () => Promise.resolve(),
                    onDebuggerDetached: () => {},
                    tabId: id,
                    domUtils: { getDOM: () => Promise.resolve() },
                    windowUtils: _windowUtils,
                    imageCaptureUtils: new ImageCaptureUtils(
                        id,
                        _windowUtils,
                        new ScreenshotUtils(id, this.driver, { takeScreenshots: options.takeScreenshots })
                    ),
                };
            });
    }

    getTabUtilsByTabIdAndSessionId(sessionId, tabId) {
        const tabInfo = this.sessionTabs[sessionId].tabInfos[tabId];
        return this._utils[tabInfo.infoId];
    }

    getTabUtilsByTabId(tabId) {
        const infoId = Object.keys(this._utils).find(uId => this._utils[uId].tabId === tabId);
        return this._utils[infoId];
    }

    getTabInfo(sessionId, id) {
        return this.sessionTabs[sessionId].tabInfos[id];
    }

    getTabUtils(sessionId, tabInfo) {
        if (!tabInfo) {
            return this.getMainTabUtils(sessionId);
        }

        if (this._utils[tabInfo.infoId]) {
            return this._utils[tabInfo.infoId];
        }

        if (tabInfo.isMain) {
            return this.getMainTabUtils(sessionId);
        }

        const infos = this.getAllTabInfos(sessionId);
        const nonMainTabs = Object.keys(infos)
            .map(tabId => infos[tabId])
            .filter(info => !info.isMain);
        if (nonMainTabs.length === 1) {
            return this._utils[nonMainTabs[0].infoId];
        }

        const sameTabs = Object.keys(sessionId)
            .map(key => sessionId[key])
            .filter(info => this.isSameTab(sessionId, tabInfo, info));
        if (sameTabs.length > 0) {
            return this._utils[sameTabs[0].infoId];
        }

        // if nothing else
        return this.getMainTabUtils(sessionId);
    }

    exactUrlMatch(first, second, allUrls) {
        const exactUrlMatch = allUrls
            .filter(url => url === second.url);

        if ((first.url === second.url || first.currentUrl === second.url || (first.currentUrl && (first.currentUrl === second.currentUrl))) && (exactUrlMatch.length === 1)) {
            return true;
        }
        return false;
    }

    singleExactMatchForParts(first, second, allUrls, combinePartsFunction) {
        const firstUrlParts = UrlUtils.urlBreaker(first.url || first.currentUrl);
        const secondUrlParts = UrlUtils.urlBreaker(second.url || second.currentUrl);
        const firstPartsCombined = combinePartsFunction(firstUrlParts);
        const secondPartsCombined = combinePartsFunction(secondUrlParts);
        const allDomainAndPathMatches = allUrls.map(url => UrlUtils.urlBreaker(url))
            .map(urlParts => combinePartsFunction(urlParts))
            .filter(combinedParts => combinedParts === firstPartsCombined);
        if ((firstPartsCombined === secondPartsCombined) && (allDomainAndPathMatches.length === 1)) {
            return true;
        }
        return false;
    }

    isSameTab(sessionId, first, second) {
        if (tabMatcher) {
            const infos = this.getAllTabInfos(sessionId);
            const allTabInfos = Object.keys(infos).map(tabId => infos[tabId]);
            return tabMatcher.isSameTab(allTabInfos, first, second);
        }
        // flow:
        // both main => exact match => exact match for domain and path => exact match for domain path and hash
        // => order (legacy data)
        if (first.isMain && second.isMain) {
            return true;
        }

        if (first.openerStepId && second.openerStepId && first.openerStepId === second.openerStepId) {
            return true;
        }

        const infos = this.getAllTabInfos(sessionId);
        const alltopFrameUrls = Object.keys(infos)
            .map(tabId => infos[tabId].url);

        if (this.exactUrlMatch(first, second, alltopFrameUrls)) {
            return true;
        }

        const combineDomainAndPath = urlParts => (`${urlParts.domain}/${urlParts.path.join('/')}`);
        if (this.singleExactMatchForParts(first, second, alltopFrameUrls, combineDomainAndPath)) {
            return true;
        }

        const combineDomainPathAndHash = urlParts => (`${urlParts.domain}/${urlParts.path.join('/')}#${urlParts.hash}`);
        if (this.singleExactMatchForParts(first, second, alltopFrameUrls, combineDomainPathAndHash)) {
            return true;
        }

        if (first.order === second.order) {
            return true;
        }

        return false;
    }

    getMainTabInfo(sessionId) {
        const infos = this.getAllTabInfos(sessionId);
        return Object.keys(infos)
            .map(id => infos[id])
            .find(tabInfo => tabInfo.isMain);
    }

    getMainTabUtils(sessionId) {
        const mainTabInfo = this.getMainTabInfo(sessionId);
        if (!mainTabInfo) {
            return {};
        }
        return this.getTabUtils(sessionId, mainTabInfo);
    }

    removeTabInfo(sessionId, tabId) {
        const infos = this.getAllTabInfos(sessionId);
        const info = infos[tabId];
        delete this.sessionTabs[sessionId].tabInfos[tabId];
        delete this._utils[info.infoId];
        this.sessionTabs[sessionId].tabCount--;
    }

    getMainTabId(sessionId) {
        const infos = this.getAllTabInfos(sessionId);
        return Object.keys(infos).find(id => infos[id].isMain);
    }

    isMainTabExists(sessionId) {
        const mainTabId = this.getMainTabId(sessionId);
        if (!mainTabId) {
            return Promise.resolve(false);
        }
        return Promise.resolve(true);
    }

    clearAllTabs(sessionId) {
        const infos = this.getAllTabInfos(sessionId);

        this.sessionTabs[sessionId].tabCount = 0;
        Object.keys(infos)
            .forEach(tabId => this.removeTabInfo(sessionId, tabId));
    }

    clearNonMainTabs(sessionId) {
        const infos = this.getAllTabInfos(sessionId);
        Object.keys(infos)
            .filter(tabId => !infos[tabId].isMain)
            .forEach(tabId => this.removeTabInfo(sessionId, tabId));

        this.sessionTabs[sessionId].tabCount = 1;
    }

    switchTab(tabId, sessionId, { forceSwitch } = { forceSwitch: false }) {
        const tabCount = this.sessionTabs[sessionId] ? this.sessionTabs[sessionId].tabCount : 1;
        // looking at session tabs here and tabCount only works if we already "know" all the tabs, so we
        // opt out of it in hybrid steps and other cases.
        if ((typeof tabCount === 'number' && tabCount > 1) || forceSwitch) {
            return this.driver.switchTab(tabId);
        }
        return Promise.resolve();
    }

    getTabDetails(tabId, sessionId, options = {}) {
        return this.switchTab(tabId, sessionId, options)
            .then(() => {
                if (options.skipLoadInfo) { // the tab title and url are not interesting yet
                    return { title: '', url: '' };
                }
                let mainTabPromise = Promise.resolve('unknown');
                if (options.checkForMainTab) {
                    mainTabPromise = this.driver.executeJS('return window.__isMainTestimTab').get('value');
                }

                return Promise.all([this.driver.getTitle(), this.driver.getUrl(), mainTabPromise]).then(
                    ([title, url, isMainTab]) => ({ title, url, isMainTab }),
                    err => {
                        logger.error('failed to get url or title', { err });
                        return {
                            title: '',
                            url: '',
                        };
                    },
                );
            })
            .catch(err => {
                logger.error('failed to switch to tab', { tabId, err });
            });
    }

    getUnregisteredTabId(sessionId) {
        return this.driver.getTabIds()
            .then(ids => ids.find(tabId => !this.getAllTabIds(sessionId).includes(tabId)));
    }

    waitForTabToOpen(sessionId) {
        return this.getUnregisteredTabId(sessionId)
            .then(newId => (newId ?
                Promise.resolve(newId) :
                Promise.delay(500).then(() => this.waitForTabToOpen(sessionId))));
    }

    tryToAddTab(sessionId, openerStepId) {
        if (this.pendingTabs[sessionId]) {
            // don't mess with the main flow
            return Promise.resolve();
        }
        return this.getUnregisteredTabId(sessionId)
            .then(newId => {
                if (!newId) {
                    return Promise.resolve();
                }
                return this.addNewTab(sessionId, newId)
                    .then(() => this.addFrameHandler(newId))
                    .then(() => (this.sessionTabs[sessionId].currentTab = null));
            });
    }

    addNewPopup(id, openerStepId) {
        const tabInfos = this.getAllTabInfos(id);
        const stepWasAdded = Object.keys(tabInfos).find(tabId => tabInfos[tabId].openerStepId === openerStepId);
        if (stepWasAdded) {
            return Promise.resolve();
        }
        if (this.pendingTabs[id]) {
            logger.info(`overriding opener step id from ${this.pendingTabs[id]} to ${openerStepId}`);
            this.pendingTabs[id] = openerStepId;
            return Promise.resolve();
        }
        this.pendingTabs[id] = openerStepId;
        return this.waitForTabToOpen(id)
            .then(newTabId => this.addNewTab(id, newTabId, this.pendingTabs[id])
                .then(() => this.addFrameHandler(newTabId))
                .then(() => delete this.pendingTabs[id])
                .then(() => (this.sessionTabs[id].currentTab = null)));
    }

    waitToPendingTabs(id, openerStepId) {
        const retryInterval = 500;
        let timeToWait = 3000;
        const that = this;

        if (!openerStepId) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            function checkPendingTabs() {
                if (that.pendingTabs[id] === openerStepId) {
                    if (timeToWait - retryInterval > 0) {
                        timeToWait -= retryInterval;
                        setTimeout(checkPendingTabs, retryInterval);
                    } else {
                        resolve();
                    }
                } else {
                    resolve();
                }
            }

            checkPendingTabs();
        });
    }

    isMainTabIncognito() {
        return Promise.resolve(false);
    }

    isInvalidStepVersion(step) {
        const isOldVersion = semver.lt(step._version || step.version, '1.2.0');
        const hasParams = !!step.parameterValues;
        const hasBadLocateParams = hasParams &&
            step.parameterValues
                .filter(param => param.type === 'locate')
                .filter(param => !param.frameLocators)
                .length > 0;

        return isOldVersion && (!hasParams || hasBadLocateParams);
    }

    getTabIdByTabInfo(sessionId, step) {
        if (this.isInvalidStepVersion(step)) {
            return Promise.reject({
                success: false,
                shouldRetry: false,
                errorType: constants.INVALID_TEST_VERSION,
            });
        }
        const openerStepId = (step.tabInfo || {}).openerStepId;
        return this.waitToPendingTabs(sessionId, openerStepId)
            .then(() => {
                let tabId;
                if (tabMatcher) {
                    const allTabInfos = this.getAllTabIds(sessionId).map(tabId => Object.assign({}, this.getTabInfo(sessionId, tabId), { tabId })).filter(tabInfo => !tabInfo.isClosed);
                    tabId = tabMatcher.matchTabs(step, allTabInfos);
                } else {
                    // old session player (clickim) version - remove once enough time passed
                    const stepTabInfo = step.tabInfo;
                    if (!stepTabInfo) {
                        tabId = this.getMainTabId(sessionId);
                    } else {
                        tabId = this.getAllTabIds(sessionId).find(tabId => {
                            const tabInfo = this.getTabInfo(sessionId, tabId);
                            return this.isSameTab(sessionId, tabInfo, stepTabInfo);
                        });
                    }
                }

                if (!tabId) {
                    return this.tryToAddTab(sessionId, openerStepId)
                        .then(() => Promise.reject(new Error('No tab ID found')));
                }
                if (this.sessionTabs[sessionId].currentTab === tabId) {
                    return Promise.resolve(tabId);
                }
                return this.switchTab(tabId, sessionId)
                    .then(() => {
                        this.sessionTabs[sessionId].currentTab = tabId;
                        return tabId;
                    })
                    .catch(err => {
                        const windowClosedErrors = ['no such window', 'no window found', 'the window could not be found'];
                        if (err.message && windowClosedErrors.find(errorString => err.message.toLowerCase().includes(errorString))) {
                            this.sessionTabs[sessionId].tabCount--;
                            this.sessionTabs[sessionId].tabInfos[tabId].isClosed = true;
                            return this.getTabIdByTabInfo(sessionId, step);
                        }
                        throw err;
                    });
            });
    }
}

module.exports = TabService;

'use strict';

const Promise = require('bluebird');
const pRetry = require('p-retry');
const { PageNotAvailableError } = require('../../errors');
const logger = require('../../commons/logger').getLogger('window-utils');

function WindowUtils(id, driver) {
    this.id = id;
    this.driver = driver;
}

WindowUtils.prototype.getElementFromPoint = function (x, y) {
    function elementFromPoint(x, y) {
        var el = document.elementFromPoint(x, y);
        return { testimId: el ? el.getAttribute('testim_dom_element_id') : null, tagName: el ? el.tagName : null };
    }

    return this.driver.executeJS(elementFromPoint, x, y).then(result => Promise.resolve(result.value));
};

WindowUtils.prototype.getLocation = function () {
    return this.driver.getUrl();
};

WindowUtils.prototype.stopListeningToScroll = function () {
    return Promise.resolve();
};

WindowUtils.prototype.resumeListeningToScroll = function () {
    return Promise.resolve();
};

WindowUtils.prototype.scrollToPosition = function (pos) {
    return this.driver.scroll(pos.x, pos.y);
};

WindowUtils.prototype.scrollToPositionWithoutAnimation = function (pos) {
    //if scroll behaviour is not supported, then the scrolling is not animated anyway
    function scrollWithoutAnimation(position) {
        var scrollBehaviorSupported = 'scrollBehavior' in document.documentElement.style;
        if (scrollBehaviorSupported) {
            return window.scrollTo({ left: position.x, top: position.y, behavior: 'instant' });
        }
        return window.scrollTo(position.x, position.y);
    }
    return this.driver.executeJS(scrollWithoutAnimation, pos);
};

WindowUtils.prototype.getCurrentScrollPosition = function () {
    function scrollPosition() {
        return { x: window.scrollX, y: window.scrollY };
    }

    return this.driver.executeJS(scrollPosition).then(result => Promise.resolve(result.value));
};

WindowUtils.prototype.navigate = function (location, NAVIGATION_MAX_TIME = 15000) {
    const that = this;

    async function navigate(retries = 3) {
        try {
            await that.driver.url(location);
        } catch (err) {
            const shouldRetryNavigation = err.seleniumStack && err.message.includes('method IWebBrowser2::Navigate2() failed');
            if (shouldRetryNavigation && retries > 0) {
                logger.warn('selenium navigation failed. retrying to navigate', { err });
                await Promise.delay(1500);
                return navigate(retries - 1);
            }
            throw err;
        }
        return undefined;
    }

    return Promise.race([navigate(), Promise.delay(NAVIGATION_MAX_TIME)]);
};

WindowUtils.prototype.reloadTab = (timeoutMSec = 15000) => {
    return Promise.race([
        this.driver.reloadTab(),
        Promise.delay(timeoutMSec),
    ]);
};

WindowUtils.prototype.getViewportSize = function () {
    return this.driver.getViewportSize();
};

WindowUtils.prototype.maximizeWithoutValidation = function () {
    return this.driver.maximizeWithoutValidation();
}

WindowUtils.prototype.getFullPageSize = function () {
    function fullPageSize() {
        var body = document.body, html = document.documentElement;
        var height = Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight);
        var width = Math.max(body.scrollWidth, body.offsetWidth, html.clientWidth, html.scrollWidth, html.offsetWidth);
        return {
            height: height,
            width: width
        };
    }

    return this.driver.executeJS(fullPageSize).then(result => Promise.resolve(result.value));
};

WindowUtils.prototype.extractToNewWindow = function () {
    return Promise.resolve();
};

WindowUtils.prototype.checkSize = function (size) {
    return Promise.delay(1000)
        .then(() => this.getViewportSize())
        .then(actualSize => {
            if (actualSize.width !== size.width || actualSize.height !== size.height) {
                return Promise.reject({ actualSize: actualSize, expectedSize: size });
            }
            return Promise.resolve({ actualSize: actualSize, expectedSize: size });
        });
};

WindowUtils.prototype.setViewportSize = function (size) {
    return this.driver.setViewportSize(size.width, size.height)
        .then(() => this.checkSize(size));
};

WindowUtils.prototype.validatePageIsAvailable = function () {
    function pageIsAvailable() {
        var locationObj;
        // this sometimes happens on IE
        if (typeof location !== 'undefined') {
            locationObj = location;
        } else if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
            locationObj = window.location;
        } else {
            return false;
        }

        return locationObj.href !== 'chrome-error://chromewebdata/' && locationObj.href !== 'safari-resource:/ErrorPage.html' && locationObj.href.indexOf('res://ieframe.dll/http_404.htm') !== 0 && locationObj.href.indexOf('ms-appx-web://microsoft.microsoftedge/assets/errorpages/') !== 0;
    }

    return this.driver.executeJS(pageIsAvailable).then(result => result.value ? Promise.resolve() : Promise.reject(new PageNotAvailableError()));
};

WindowUtils.prototype.focusTab = function () {
    return this.driver.switchTab(this.id);
};

WindowUtils.prototype.quit = function () {
    return undefined;
};

WindowUtils.prototype.getOsAndBrowser = function () {
    return pRetry(() => this.driver.getBrowserAndOS(), { retries: 3 })
        .then(osAndBrowser => ({ uaBrowserName: osAndBrowser.browser, uaOs: osAndBrowser.os, userAgent: osAndBrowser.userAgent, browserVersion: osAndBrowser.browserVersion }));
};

WindowUtils.prototype.getUserAgentInfo = function () {
    return pRetry(() => this.driver.getUserAgentInfo(), { retries: 3 });
};

module.exports = WindowUtils;

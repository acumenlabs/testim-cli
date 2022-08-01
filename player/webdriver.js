/* eslint-disable no-var */
'use strict';

const logger = require('../commons/logger').getLogger('webdriver');
const Promise = require('bluebird');
const parser = require('ua-parser-js');
const desiredCapabilitiesBuilder = require('../commons/testimDesiredCapabilitiesBuilder');
const { SeleniumError, SeleniumCrashError, IeError } = require('../errors');
const utils = require('../utils');
const WebDriverApi = require('./WebdriverioWebDriverApi');
const doubleClick = require('./stepActions/scripts/doubleClick');
const dispatchFocus = require('./stepActions/scripts/focusElement');
const { isOldProtocol } = require('./webDriverUtils');
const featureFlags = require('../commons/featureFlags');
const _ = require('lodash');

const [LEFT, RIGHT] = [0, 2];
const { extractElementId, getCdpAddressForHost } = utils;
const perf = require('../commons/performance-logger');
const { SeleniumPerfStats, SELENIUM_PERF_MARKS } = require('../commons/SeleniumPerfStats');

const codeSnippets = () => {
    const sessionPlayer = require('../commons/getSessionPlayerRequire');
    return sessionPlayer.codeSnippets;
};
const locatorBuilderUtils = () => {
    const sessionPlayer = require('../commons/getSessionPlayerRequire');
    return sessionPlayer.locatorBuilderUtils;
};
const playerUtils = () => {
    const sessionPlayer = require('../commons/getSessionPlayerRequire');
    return sessionPlayer.utils;
};

async function getCdpAddress(initResult) {
    try {
        const debuggerHost = initResult && initResult.value && initResult.value['goog:chromeOptions'] && initResult.value['goog:chromeOptions'].debuggerAddress;
        if (!debuggerHost) {
            return undefined;
        }
        return await getCdpAddressForHost(debuggerHost);
    } catch (e) {
        logger.info('Error getting cdpAddress', e);
        return undefined;
    }
}
class WebDriver extends WebDriverApi {
    constructor() {
        super();
        this.started = false;
        this.keepAliveTimer = null;
        this.unsupportedActions = {};
        this._isAlive = false;
        this._keepAliveRequests = [];
        this.cdpUrl = undefined;
        this.browserClosedCallbacks = [];
        this.browserClosedFailedKeepAlives = 0;
        this.ignoreHiddenTagsText = false;
    }

    registerToClosedBrowser(callback) {
        this.browserClosedCallbacks.push(callback);
    }

    unregisterToClosedBrowser(callback) {
        this.browserClosedCallbacks = this.browserClosedCallbacks.filter(cb => cb !== callback);
    }

    async init(browserOptions, testName, testRunConfig, gridInfo, customExtensionLocalLocation, executionId, testResultId, seleniumPerfStats = new SeleniumPerfStats(), fastInit = false, lambdatestService) {
        this.browserClosedFailedKeepAlives = 0;
        this.ignoreHiddenTagsText = _(browserOptions).get('company.activePlan.premiumFeatures.ignoreHiddenTagsText');
        this.browserClosedCallbacks = [];
        const capabilities = desiredCapabilitiesBuilder.buildSeleniumOptions(browserOptions, testName, testRunConfig, gridInfo, customExtensionLocalLocation, executionId, testResultId, lambdatestService);
        if (capabilities.desiredCapabilities) {
            delete capabilities.desiredCapabilities.marionette;
        }
        if (capabilities.capabilities) {
            delete capabilities.capabilities.alwaysMatch.marionette;
        }
        const browser = browserOptions.browser || (testRunConfig && testRunConfig.browserValue);
        this.initUnsupportedActions(browser, lambdatestService && lambdatestService.isLambdatestRun());
        this.browserAndOS = null;
        this.seleniumPerfStats = seleniumPerfStats;
        const driverDelay = fastInit ? 0 : 1500;
        const focus = fastInit ? (() => { }) : () => this.executeJS('window.focus()');
        try {
            perf.log('before initClient in webdriver.js init');
            const initResult = await this.initClient(capabilities, testName, testResultId);
            perf.log('after initResult before getCdpAddress in init');
            this.cdpUrl = await getCdpAddress(initResult);
            perf.log('after getCdpAddress in webdriver.js init');
            logger.info(`init new session testName: ${testName}`, { sessionId: this.getSessionId(), testResultId });
            await Promise.delay(driverDelay);
            await focus();
            perf.log('after focus and delay in webdriver.js init');
        } catch (err) {
            logger.error('failed to init webdriver', { err });
            if (err.seleniumStack) {
                const newError = new SeleniumError(err.seleniumStack);
                const isFreeCompany = _(browserOptions).get('company.activePlan.plan') === 'free';
                if (newError.message.includes('timed out waiting for a node') && isFreeCompany) {
                    throw new Error('Our free grids are in full capacity, please try again or upgrade to our Professional plan');
                }
                throw newError;
            }
            throw new Error('failed to init client driver');
        }
    }

    initUnsupportedActions(browser, isLambdatestRun) {
        if (isLambdatestRun && browser !== 'ie11' && browser !== 'edge') {
            this.unsupportedActions = {
                ...this.unsupportedActions,
                move: true,
            };
        }
    }

    isAlive() {
        return this._isAlive;
    }

    maxKeepAliveGap() {
        const slidingPairsWindow = (arr) => _.zip(_.dropRight(arr, 1), _.drop(arr, 1));
        const startTimeArray = this._keepAliveRequests.map(({ start }) => start).filter(Boolean);
        const timeGaps = slidingPairsWindow(startTimeArray).map(([a, b]) => b - a);
        return Math.max(...timeGaps);
    }

    isClosedBrowserError(err) {
        if (!err || !err.seleniumStack || !err.message) {
            return false;
        }
        return ((err.seleniumStack.type === 'UnknownError') &&
            (err.message.includes('CLIENT_STOPPED_SESSION') || err.message.includes('BROWSER_TIMEOUT') || err.message.includes('was terminated due to TIMEOUT'))) ||
            (err.seleniumStack.type === 'NoSuchWindow' && err.message.includes('window was already closed')) ||
            (err.seleniumStack.type === 'SelectorTimeoutError' && err.message.includes('chrome not reachable'));
    }

    start() {
        if (this.started) {
            return;
        }
        this.started = true;
        const that = this;
        const keepAlive = function () {
            function createKeepAliveRequestData(id) {
                that._keepAliveRequests.push({ start: Date.now(), id });
            }
            function updateKeepAliveRequestData(field, id) {
                (that._keepAliveRequests.find(item => item.id === id) || {})[field] = Date.now();
            }

            function checkKeepAliveScript() {
                return window.getTestimStatus && window.getTestimStatus();
            }

            if (that.queue.getQueueLength() > 0) {
                return Promise.resolve();
            }

            const requestId = utils.guid();
            createKeepAliveRequestData(requestId);
            return that.executeJS(checkKeepAliveScript)
                .then(() => {
                    that._isAlive = true;
                    updateKeepAliveRequestData('end', requestId);
                    that.browserClosedFailedKeepAlives = 0;
                })
                .catch(err => {
                    updateKeepAliveRequestData('error', requestId);
                    if (err.seleniumStack && err.seleniumStack.type === 'UnexpectedAlertOpen') {
                        that.browserClosedFailedKeepAlives = 0;
                        logger.warn('close unexpected alert open');
                        return that.alertAccept().catch(innerErr => logger.warn('failed to click on alert', { err: innerErr }));
                    }
                    logger.warn('err while getting testim status', { err });
                    that._isAlive = false;
                    if (that.isClosedBrowserError(err)) {
                        that.browserClosedFailedKeepAlives++;
                        const CLOSED_BROWSER_THRESHOLD_COUNT = 3;
                        if (that.browserClosedFailedKeepAlives >= CLOSED_BROWSER_THRESHOLD_COUNT) {
                            that.browserClosedCallbacks.forEach(cb => {
                                try {
                                    cb(err);
                                } catch { /* ignore */ }
                            });
                        }
                    } else {
                        that.browserClosedFailedKeepAlives = 0;
                    }
                    return undefined;
                });
        };

        this.keepAliveTimer = setInterval(keepAlive, 10000);
    }

    switchToLocatedFrame(locatedElement) {
        return this.getElement(locatedElement)
            .then(async el => {
                await this.switchToFrame(el.value);
                return el;
            });
    }

    switchToFrame(el) {
        return this.frame(el);
    }

    switchToTopFrame() {
        return this.frame().catch(err => {
            if (err.message && err.message.includes('ECONNREFUSED')) {
                throw new SeleniumCrashError();
            }
            throw err;
        });
    }

    getElement(locatedElement) {
        const perfId = this.seleniumPerfStats.markStart(SELENIUM_PERF_MARKS.GET_ELEMENT);
        if (typeof locatedElement === 'string' || typeof locatedElement === 'number') { // support testimId in the meanwhile for backwards compatability
            return this.getElementBySelector(`[testim_dom_element_id='${locatedElement}']`)
                .finally(() => this.seleniumPerfStats.markEnd(perfId, SELENIUM_PERF_MARKS.GET_ELEMENT));
        }
        const getElementAtAut = (locatedElement && locatedElement.shadowPath && locatedElement.shadowPath.length) ||
            (featureFlags.flags.runGetElementCodeInAut.isEnabled() && this.isSafari());

        if (getElementAtAut) {
            return this.execute(`
                    var fn = ${codeSnippets().getLocatedElementCode};
                    return fn.apply(null, arguments);
                `, locatedElement
            ).finally(() => this.seleniumPerfStats.markEnd(perfId, SELENIUM_PERF_MARKS.GET_ELEMENT));
        }

        return this.getElementBySelector(`[testim_dom_element_id='${locatedElement && locatedElement.testimId}']`)
            .finally(() => this.seleniumPerfStats.markEnd(perfId, SELENIUM_PERF_MARKS.GET_ELEMENT));
    }

    executeJS(fn, args) {
        return this.execute(fn, args);
    }

    executeJSWithArray(fn, args) {
        args.unshift(fn);
        return this.execute.apply(this, args);
    }

    executeCodeAsync(fn, timeout, args) {
        return this.timeouts('script', timeout)
            .then(() => this.executeAsync(fn, args));
    }

    markDynamicParent(target, dynamicParentId) {
        function setDynamicParentAttribute(data) {
            var attributeName = data.attributeName;
            var attributeValue = data.attributeValue;
            var element = getLocatedElement(data.locatedElement);
            if (!element) {
                throw new Error('could not find dynamic parent');
            }
            element.setAttribute(attributeName, attributeValue);
        }

        return this.executeJS(`
            var getLocatedElement = ${codeSnippets().getLocatedElementCode};
            var setDynamicParentAttribute = ${setDynamicParentAttribute.toString()};
            return setDynamicParentAttribute.apply(null, arguments)
        `, {
            attributeName: locatorBuilderUtils().DYNAMIC_PARENT_FIELD_NAME,
            attributeValue: dynamicParentId,
            locatedElement: target.locatedElement
        });
    }

    getLocatedElementRectWithPadding(locatedElement) {
        // this is here to conform with clickim's logic in frame offset calculations
        function getLocationCode(locatedElement) {
            var element = getLocatedElement(locatedElement);
            if (!element) {
                return null;
            }
            var paddingTop = parseInt(window.getComputedStyle(element).paddingTop.replace('px', '')) || 0;
            var paddingLeft = parseInt(window.getComputedStyle(element).paddingLeft.replace('px', '')) || 0;
            var rect = element.getBoundingClientRect();
            return { top: Math.round(rect.top + paddingTop), left: Math.round(rect.left + paddingLeft) };
        }

        return this.executeJS(`
            var getLocatedElement = ${codeSnippets().getLocatedElementCode};
            var getLocation = ${getLocationCode.toString()};
            return getLocation.apply(null, arguments)
        `, locatedElement);
    }

    getElementLocationWithPadding(locatedElement) {
        return this.getLocatedElementRectWithPadding(locatedElement);
    }

    getLocatedElementRect(locatedElement) {
        function getLocationCode(locatedElement) {
            var element = getLocatedElement(locatedElement);
            if (!element) {
                return null;
            }
            var rect = element.getBoundingClientRect();
            return {
                bottom: Math.round(rect.bottom),
                height: Math.round(rect.height),
                x: Math.round(rect.left),
                right: Math.round(rect.right),
                y: Math.round(rect.top),
                width: Math.round(rect.width)
            };
        }

        return this.executeJS(`
            var getLocatedElement = ${codeSnippets().getLocatedElementCode};
            var getLocation = ${getLocationCode.toString()};
            return getLocation.apply(null, arguments)
        `, locatedElement);
    }

    getElementLocation(target) {
        return this.getLocatedElementRect(target.locatedElement);
    }

    getTargetText(target) {
        return this.getElementTextJS(target.locatedElement);
    }

    getElementTextJS(locatedElement) {
        function extractTextCode(locatedElement, ignoreHiddenTagsText) {
            // copy of utils.getElementTextContent to run inside content script
            // sadly .children doesn't work for SVG elements in IE11
            function clearTitleTags(node) {
                if (!node.childNodes || node.childNodes.length === 0) {
                    return node;
                }

                var children = Array.apply(null, node.childNodes).filter(function (x) { return x.nodeType === Node.ELEMENT_NODE; });
                children.forEach(function (child) {
                    if (typeof child.tagName === 'string' && child.tagName.toLowerCase() === 'title') {
                        node.removeChild(child);
                    } else {
                        clearTitleTags(child);
                    }
                });
                return node;
            }

            function isTextElement(element) {
                var tagName = element.tagName;
                return (tagName === 'INPUT' || tagName === 'TEXTAREA');
            }

            function getFixedTextContent(element) {
                try { // fix for salesforce's custom-elements
                    if (element.shadowRoot && Object.getOwnPropertyDescriptor(element.ownerDocument.defaultView.Node.prototype,'textContent').get.toString().indexOf('[native code]') === -1) {
                        return element.shadowRoot.textContent.replace(/(\r\n|\n|\r)/gm, '');
                    }
                } catch (err) { }
                if (ignoreHiddenTagsText && Array.prototype.some.call(element.children, function (elem) { return elem.hidden; })) {
                    var dupElement = element.cloneNode(true);
                    var hiddenChildren = Array.prototype.filter.call(dupElement.children, function (elem) { return elem.hidden; });
                    hiddenChildren.forEach(function (child) { 
                        dupElement.removeChild(child);
                    });
                    return dupElement.textContent.replace(/(\r\n|\n|\r)/gm, '');
                }
                return element.textContent.replace(/(\r\n|\n|\r)/gm, '');
            }

            function getElementTextContent(element) {
                if (isTextElement(element)) {
                    return element.value;
                } else if (element instanceof SVGElement) {
                    var isIE = navigator.userAgent.indexOf('MSIE') !== -1
                        || navigator.userAgent.indexOf('Trident/') !== -1;

                    var copyElement = element.cloneNode(true);
                    // clone doesn't work for SVG elements in IE11
                    if (isIE) {
                        var svgContent = new XMLSerializer().serializeToString(element);
                        copyElement = new DOMParser().parseFromString(svgContent, 'text/html').body.firstChild;
                    }
                    return clearTitleTags(copyElement).textContent.replace(/(\r\n|\n|\r)/gm, '');
                } else {
                    return getFixedTextContent(element);
                }
            }

            var element = getLocatedElement(locatedElement);
            return element ? getElementTextContent(element) : '';
        }

        return this.executeJS(`
            var getLocatedElement = ${codeSnippets().getLocatedElementCode};
            var extractText = ${extractTextCode.toString()};
            return extractText.apply(null, arguments)
        `, locatedElement, this.ignoreHiddenTagsText)
            .then(result => result.value);
    }

    isUsingUnsupportedCompabilityMode(userAgent) {
        return /MSIE ((10.0)|(9.0)|(8.0)|(7.0))/.test(userAgent);
    }

    isIePageNotAvailableUrl(url) {
        return url && url.startsWith('res://ieframe.dll/dnserror');
    }

    getIeError(msg = '') {
        return Object.assign(new IeError(msg), { success: false, reason: msg, errorType: 'compatibility-mode-error' });
    }

    getHTML(locateStep) {
        const getHTMLCode = codeSnippets().getHtmlCode(null, locateStep);
        const perfId = this.seleniumPerfStats.markStart(SELENIUM_PERF_MARKS.GET_HTML);
        return this.executeJS(getHTMLCode)
            .then(result => {
                this.seleniumPerfStats.markEnd(perfId, SELENIUM_PERF_MARKS.GET_HTML);
                if (this.isIE() && result.value.runLocation && this.isIePageNotAvailableUrl(result.value.runLocation.href)) {
                    throw this.getIeError('Page is not loaded');
                }
                return result.value;
            })
            .catch(err => !(err instanceof IeError), err => {
                this.seleniumPerfStats.markEnd(perfId, SELENIUM_PERF_MARKS.GET_HTML);
                const testimInternalError = Object.assign(new Error(), { success: false, reason: err.toString(), errorType: 'internal-error' });
                if (!this.client.requestHandler.sessionID) {
                    // we got here after the driver has been disposed of. It's impossible to run JavaScirpt on the page.
                    testimInternalError.extraInfo = 'Inside getHtml catch and trying to check if in quirks mode - but the session has already terminated';
                    throw testimInternalError;
                }
                if (!this.isIE()) { // no need to check quirks mode if I'm not in IE
                    throw testimInternalError;
                }
                return this.executeJS('return navigator.userAgent;')
                    .catch(() => Promise.reject(testimInternalError))
                    .then(ua => {
                        const error = this.isUsingUnsupportedCompabilityMode(ua.value) ? this.getIeError('Can’t run test in IE compatibility mode') : testimInternalError;
                        return Promise.reject(error);
                    });
            });
    }

    maximizeWithoutValidation() {
        return this.windowHandleMaximize();
    }

    setViewportSizeNEW(size, type) {
        const MAX_TRIES = 5;

        const getViewportSizeScript = function () {
            var pixelRatio = (/(MSIE)|(Trident)/.test(navigator.userAgent)) ? (window.screen.systemXDPI / window.screen.deviceXDPI) : 1;
            return {
                screenWidth: Math.floor(window.innerWidth || 0) / pixelRatio,
                screenHeight: Math.floor(window.innerHeight || 0) / pixelRatio
            };
        };

        /**
         * to set viewport size properly we need to execute the process multiple times
         * since the difference between the inner and outer size changes when browser
         * switch between fullscreen modes or visibility of scrollbar
         */
        const _setViewportSize = (size, tryNo = 1) => {
            /**
             * get window size
             */
            return this.windowHandleSize()
                .then((windowHandleSize) => {
                    /**
                     * get viewport size
                     */
                    return this.execute(getViewportSizeScript)
                        .then(viewportSize => {
                            const widthDiff = windowHandleSize.value.width - viewportSize.value.screenWidth;
                            const heightDiff = windowHandleSize.value.height - viewportSize.value.screenHeight;
                            /**
                             * change window size with indent
                             */
                            return this.windowHandleSize({
                                width: size.width + widthDiff,
                                height: size.height + heightDiff
                            });
                        })
                        .then(() => this.execute(getViewportSizeScript))
                        .then(res => {
                            /**
                             * if viewport size not equals desired size, execute process again
                             */
                            if (tryNo < MAX_TRIES && (res.value.screenWidth !== size.width || res.value.screenHeight !== size.height)) {
                                return _setViewportSize.call(this, size, tryNo + 1);
                            }
                        });
                });
        };

        /**
         * parameter check
         */
        if (typeof size !== 'object' ||
            typeof size.width !== 'number' ||
            typeof size.height !== 'number' ||
            (typeof type !== 'undefined' && typeof type !== 'boolean')) {
            throw new Error('number or type of arguments don\'t agree with setViewportSize command');
        }

        let shouldIndent = (typeof type === 'undefined') ? true : type;

        return shouldIndent ? _setViewportSize.call(this, size) : this.windowHandleSize(size);
    }

    setViewportSize(width, height) {
        var type = true; //set to false to change window size, true (default) to change viewport size
        return utils.blueBirdify(() => this.setViewportSizeNEW({
            width: width,
            height: height
        }, type));
    }

    getBrowserMajorVersion(parse) {
        try {
            return parseInt(parse.browser.major);
        } catch (err) {
            logger.error('failed to get browser version', { err: err });
            return 0;
        }
    }

    getBrowserAndOS() {
        function getBrowserName(ua, browserDetails) {
            var M = ua.match(/(opera|chrome|safari|firefox|msie|trident(?=\/))\/?\s*(\d+)/i) || [];
            if (/trident/i.test(M[1])) {
                return 'Internet Explorer ' + browserDetails.major;
            }
            if (M[1] === 'Chrome' && ua.match(/\bOPR\/(\d+)/) !== null) {
                return 'opera';
            }
            if (M[1] === 'Chrome' && ua.match(/\bEdge|Edg\/(\d+)/) !== null) {
                return 'edge';
            }
            M = M[2] ? [M[1], M[2]] : [ua.appName, ua.appVersion, '-?'];
            var tem = ua.match(/version\/(\d+)/i);
            if (tem !== null) {
                M.splice(1, 1, tem[1]);
            }
            return M[0].toLowerCase();
        }

        if (this.browserAndOS) {
            return Promise.resolve(this.browserAndOS);
        }

        return this.executeJS(function () {
            if (typeof window === 'undefined' || !window.navigator || !window.navigator.userAgent) {
                return 'unknown';
            }
            return window.navigator.userAgent;
        }).then(userAgent => {
            const rawUserAgent = userAgent.value;
            const parse = parser(rawUserAgent);
            const osDetails = parse.os;
            this.browserAndOS = {
                os: osDetails.name + ' ' + osDetails.version,
                browserMajor: this.getBrowserMajorVersion(parse),
                browser: getBrowserName(userAgent.value, parse.browser),
                userAgent: rawUserAgent,
                browserVersion: parse.browser.version
            };
            return Promise.resolve(this.browserAndOS);
        });
    }

    getUserAgentInfo() {
        return this.executeJS(`return ${codeSnippets().getUserAgentInfo()}`)
            .then(result => result.value);
    }

    setValue(element, value) {
        return super.setValue(element, value);
    }

    getRelativeMoveActions(offsets, element) {
        const { rect, clickOffset } = offsets;
        const inViewCenter = this.inViewCenter(rect);
        const left = Math.floor(clickOffset.x - inViewCenter.x);
        const top = Math.floor(clickOffset.y - inViewCenter.y);

        if (!playerUtils().isWithinBounds(-inViewCenter.x, inViewCenter.x, left) ||
            !playerUtils().isWithinBounds(-inViewCenter.y, inViewCenter.y, top)) {
            // [NOTE] the code is not supposed to get here! - using center (0,0) instead of step offsets.
            // this is a fallback so the action will take place even if for some reason calculation went out of element..
            logger.warn('using center as fallback for offset');
            return this.getMoveActions(0, 0, element);
        }
        return this.getMoveActions(left, top, element);
    }

    computeAbsoluteMovement(offsets) {
        const { frameOffset, rect, clickOffset } = offsets;
        const fallbackLeft = rect.left + clickOffset.x + frameOffset.x;
        const fallbackTop = rect.top + clickOffset.y + frameOffset.y;
        return { x: fallbackLeft, y: fallbackTop };
    }

    actWithActionsAPI(offsets, button, element, actions) {
        const moveActions = this.getRelativeMoveActions(offsets, element);
        const clickActions = this.getClickActions(actions, button);
        return this.actions([{
            type: 'pointer',
            id: 'mouse',
            parameters: { pointerType: 'mouse' },
            actions: moveActions.concat(clickActions),
        }]).catch(err => {
            logger.error('tried to use element origin but failed because of visibility, trying absolute', err);
            const { x, y } = this.computeAbsoluteMovement(offsets);
            const moveActions = this.getMoveActions(x, y);
            return this.actions([{
                type: 'pointer',
                id: 'mouse',
                parameters: { pointerType: 'mouse' },
                actions: moveActions.concat(clickActions),
            }]);
        });
    }

    doubleClickWithActionsAPI(element, offsets) {
        return this.actWithActionsAPI(offsets, LEFT, element, ['pointerDown', 'pointerUp', 'pointerDown', 'pointerUp']);
    }

    doubleClickWithJS(eventData) {
        const eventParam = this.isEdge() ? JSON.stringify(eventData) : eventData;
        return this.executeCodeAsync(`
            var getLocatedElement = ${codeSnippets().getLocatedElementCode};
            var dispatchFocus = ${dispatchFocus.toString()};
            var doubleClick = ${doubleClick.toString()};
            var eventData = ${this.isEdge() ? 'JSON.parse(arguments[0])' : 'arguments[0]'};
            var done = arguments[1];
            return doubleClick.call(null, eventData, done);
        `, eventData.timeout, eventParam);
    }

    getClickActions(types = [], button) {
        return types.map(type => ({ type: type, button }));
    }

    getClickActionList(types = [], button) {
        return [{
            type: 'pointer',
            id: 'mouse',
            actions: this.getClickActions(types, button)
        }];
    }

    leftClickWithActionsAPI(element, offsets) {
        return this.actWithActionsAPI(offsets, LEFT, element, ['pointerDown', 'pointerUp']);
    }

    rightClickWithActionsAPI(element, offsets) {
        return this.actWithActionsAPI(offsets, RIGHT, element, ['pointerDown', 'pointerUp']);
    }

    rightClick(element, offsets) {
        if (this.unsupportedActions.move) {
            return this.rightClickWithActionsAPI(element, offsets);
        }
        return super.rightClick(element)
            .catch(err => {
                if (isOldProtocol(err)) {
                    this.unsupportedActions.move = true;
                    return this.rightClickWithActionsAPI(element, offsets);
                }
                return Promise.reject(err);
            });
    }

    leftClick(element, offsets) {
        if (this.unsupportedActions.move) {
            return this.leftClickWithActionsAPI(element, offsets);
        }
        return super.leftClick(element)
            .catch(err => {
                if (isOldProtocol(err)) {
                    this.unsupportedActions.move = true;
                    return this.leftClickWithActionsAPI(element, offsets);
                }
                return Promise.reject(err);
            });
    }

    dragAndDropOldAPI(sourceSeleniumElement, destinationSeleniumElement) {
        return this.moveTo(extractElementId(sourceSeleniumElement))
            .then(() => this.buttonDown())
            .then(() => this.moveTo(extractElementId(destinationSeleniumElement)))
            .then(() => this.buttonUp());
    }

    calculateElementMiddlePoint(locatedElement, offset = { top: 0, left: 0 }) {
        return this.getLocatedElementRect(locatedElement).then(response => {
            if (!response || !response.value) {
                logger.warn(`could not find element for locatedElement ${locatedElement}`);
                throw new Error('could not calculate rect');
            }
            const { x, y, width, height } = response.value;
            return {
                x: offset.left + x + (width / 2),
                y: offset.top + y + (height / 2),
            };
        });
    }

    hover(seleniumElement, offsets) {
        // this will attempt to use the old api with moveTOObject (using the selector)
        // if the old api is unsupported, it will move absolutePoint, or calc the point using the seleniumElement and offset
        if (this.unsupportedActions.move) {
            return this.moveToElementWithActionsAPI(seleniumElement, offsets);
        }

        const { rect, clickOffset } = offsets;
        const center = this.inViewCenter(rect);
        // moveto element (actions and legacy) is always vs. the center of an element, so the offset needs to get fixed.
        const xOffset = this.isEdge() ? clickOffset.x : Math.floor(clickOffset.x - center.x);
        const yOffset = this.isEdge() ? clickOffset.y : Math.floor(clickOffset.y - center.y);

        return this.moveTo(extractElementId(seleniumElement), xOffset, yOffset)
            .catch(err => {
                if (isOldProtocol(err)) {
                    this.unsupportedActions.move = true;
                    return this.moveToElementWithActionsAPI(seleniumElement, offsets);
                }

                throw err;
            });
    }

    getMoveActions(x = 1, y = 1, origin = 'viewport', duration = 0) {
        // force x != 0 ,y != 0 because of Safari issues
        return [{ type: 'pointerMove', duration, x: Math.floor(x) || 1, y: Math.floor(y) || 1, origin }];
    }

    moveWithActionsAPI(point) {
        const actions = this.getMoveActions(point.x, point.y);
        return this.actions([{
            type: 'pointer',
            id: 'mouse',
            actions: actions
        }]);
    }

    moveToElementWithActionsAPI(seleniumElement, offsets) {
        return this.actions([{
            type: 'pointer',
            id: 'mouse',
            actions: this.getRelativeMoveActions(offsets, seleniumElement),
        }]).catch(err => {
            logger.error('tried to use element origin but failed because of visibility, trying location', err);
            const point = this.computeAbsoluteMovement(offsets);
            return this.moveWithActionsAPI(point);
        });
    }

    getDragCoordinates(events) {
        const mouseEvents = events.filter(e => e.event === 'mousemove' || e.event === 'pointermove');

        const first = _.first(mouseEvents).pointerPosition;
        const last = _.last(mouseEvents).pointerPosition;

        return {
            xDiff: last.screenX - first.screenX,
            yDiff: last.screenY - first.screenY,
        };
    }

    dragWithMoveTo(seleniumElement, xDiff, yDiff, xOffset, yOffset) {
        return this.moveTo(extractElementId(seleniumElement), xOffset, yOffset)
            .then(() => this.buttonDown())
            .then(() => this.moveTo(extractElementId(seleniumElement), xDiff, yDiff))
            .then(() => this.buttonUp());
    }

    dragWithActionsAPI(seleniumElement, xDiff, yDiff, xOffset, yOffset) {
        const goToDrag = this.getMoveActions(xOffset, yOffset, seleniumElement, 1);
        const startDrag = this.getClickActions(['pointerDown'], LEFT);
        const doDrag = this.getMoveActions(xDiff, yDiff, 'pointer', 1);
        const endDrag = this.getClickActions(['pointerUp'], LEFT);
        return this.actions([{
            type: 'pointer',
            id: 'mouse',
            actions: goToDrag.concat(startDrag).concat(doDrag).concat(endDrag)
        }]);
    }

    drag(seleniumElement, targetRect, xElementOffset, yElementOffset, events) {
        const { width, height } = targetRect;
        const midXRelative = this.isEdge() ? xElementOffset : (xElementOffset - width / 2 + 1);
        const midYRelative = this.isEdge() ? yElementOffset : (yElementOffset - height / 2);
        return this.getDragCoordinates(events)
            .then(coordinates => {
                const { xDiff, yDiff } = coordinates;
                if (this.unsupportedActions.move) {
                    return this.dragWithActionsAPI(seleniumElement, xDiff, yDiff, midXRelative, midYRelative);
                }
                return this.dragWithMoveTo(seleniumElement, xDiff, yDiff, midXRelative, midYRelative)
                    .catch(err => {
                        if (isOldProtocol(err)) {
                            this.unsupportedActions.move = true;
                            return this.dragWithActionsAPI(seleniumElement, xDiff, yDiff, midXRelative, midYRelative);
                        }
                        return Promise.reject(err);
                    });
            });
    }

    getMoveRelativeSequence(startLeft, startTop, endLeft, endTop) {
        const sqr = x => x * x;
        const distance = (p1, p2) => Math.sqrt(sqr(p1.x - p2.x) + sqr(p1.y - p2.y));

        const from = { x: startLeft, y: startTop };
        const to = { x: endLeft, y: endTop };
        const MOVE_EVENT_DIST = 10;
        const eventCount = Math.round(distance(from, to) / MOVE_EVENT_DIST);

        /* generate move events array */
        const moves = Array.apply([], new Array(eventCount))
            .map(() => {
                return {
                    x: Math.round((to.x - from.x) / eventCount),
                    y: Math.round((to.y - from.y) / eventCount)
                };
            });
        return [{ x: 1, y: 1 }].concat(moves);
    }

    getMoveAbsoluteSequence(startLeft, startTop, endLeft, endTop) {
        const relativeMoves = this.getMoveRelativeSequence(startLeft, startTop, endLeft, endTop);
        return relativeMoves.reduce((newMoves, relativeMove) => {
            const lastMove = _.last(newMoves);
            return newMoves.concat({ x: Math.round(lastMove.x + relativeMove.x), y: Math.round(lastMove.y + relativeMove.y) });
        }, [{ x: Math.round(startLeft), y: Math.round(startTop) }]);
    }

    dragAndDropWithGeneratedMoves(sourceSeleniumElement, destinationSeleniumElement, rectsAndOffsets) {
        const { fromRect, fromX, fromY, toRect, toX, toY } = rectsAndOffsets;
        const moveSequence = this.getMoveRelativeSequence(fromRect.left + fromX, fromRect.top + fromY, toRect.left + toX, toRect.top + toY);

        return this.moveTo(extractElementId(sourceSeleniumElement), Math.round(fromX), Math.round(fromY))
            .then(() => this.buttonDown())
            .then(() => Promise.each(moveSequence, movePosition => this.moveTo(null, movePosition.x, movePosition.y)))
            .then(() => this.moveTo(extractElementId(destinationSeleniumElement), Math.round(toX), Math.round(toY)))
            .then(() => this.buttonUp());
    }

    dragAndDropWithActionsAPIWithGeneratedMoves(rectsAndOffsets) {
        const { fromRect, fromX, fromY, toRect, toX, toY } = rectsAndOffsets;
        const startLeft = Math.round(fromRect.left + fromX);
        const startTop = Math.round(fromRect.top + fromY);
        const endLeft = Math.round(toRect.left + toX);
        const endTop = Math.round(toRect.top + toY);
        const moveSequence = this.getMoveAbsoluteSequence(fromRect.left + fromX, fromRect.top + fromY, toRect.left + toX, toRect.top + toY);
        const startMovePositionActions = this.getMoveActions(startLeft, startTop);
        const pointerDownActions = this.getClickActions(['pointerDown'], LEFT);
        const moveSequenceActions = _.flatMap(moveSequence, movePosition => this.getMoveActions(movePosition.x, movePosition.y));
        const endMovePositionActions = this.getMoveActions(endLeft, endTop);
        const pointerUpActions = this.getClickActions(['pointerUp'], LEFT);
        const actions = startMovePositionActions.concat(pointerDownActions).concat(moveSequenceActions).concat(endMovePositionActions).concat(pointerUpActions);

        return this.actions([{
            type: 'pointer',
            id: 'mouse',
            actions: actions
        }]);
    }

    dragAndDrop(sourceSeleniumElement, destinationSeleniumElement, rectsAndOffsets) {
        if (this.isEdge() || this.isSafari() || this.isIE()) {
            if (this.unsupportedActions.move) {
                return this.dragAndDropWithActionsAPIWithGeneratedMoves(rectsAndOffsets);
            }
            return this.dragAndDropWithGeneratedMoves(sourceSeleniumElement, destinationSeleniumElement, rectsAndOffsets)
                .catch(err => {
                    if (isOldProtocol(err)) {
                        this.unsupportedActions.move = true;
                        return this.dragAndDropWithActionsAPIWithGeneratedMoves(rectsAndOffsets);
                    }
                    return Promise.reject(err);
                });
        } else if (this.unsupportedActions.move) {
            return this.dragAndDropWithActionsAPI(rectsAndOffsets);
        }
        return this.dragAndDropOldAPI(sourceSeleniumElement, destinationSeleniumElement)
            .catch(err => {
                if (isOldProtocol(err)) {
                    this.unsupportedActions.move = true;
                    return this.dragAndDropWithActionsAPI(rectsAndOffsets);
                }
                return Promise.reject(err);
            });
    }

    doubleClickFallback(element, eventData, offsets) {
        if (this.isSafari()) {
            return this.doubleClickWithJS(eventData);
        }
        return this.doubleClickWithActionsAPI(element, offsets);
    }

    doubleClick(element, eventData, offsets) {
        if (this.unsupportedActions.move || this.isSafari()) { // doDoubleClick API doesn't work in Safari browser
            return this.doubleClickFallback(element, eventData, offsets);
        }
        return this.moveTo(extractElementId(element))
            .then(() => utils.blueBirdify(() => this.doDoubleClick()))
            .catch(err => {
                if (isOldProtocol(err)) {
                    this.unsupportedActions.move = true;
                    return this.doubleClickFallback(element, eventData, offsets);
                }
                return Promise.reject(err);
            });
    }

    dragAndDropWithActionsAPI(rectsAndOffsets) {
        const { fromRect, fromX, fromY, toRect, toX, toY } = rectsAndOffsets;
        const startLeft = Math.round(fromRect.left + fromX);
        const startTop = Math.round(fromRect.top + fromY);
        const endLeft = Math.round(toRect.left + toX);
        const endTop = Math.round(toRect.top + toY);
        return this.moveWithActionsAPI({ x: startLeft, y: startTop })
            .then(() => {
                const actions = this.getClickActionList(['pointerDown'], LEFT);
                return utils.blueBirdify(() => this.actions(actions));
            })
            .then(() => this.moveWithActionsAPI({ x: endLeft, y: endTop }))
            .then(() => {
                const actions = this.getClickActionList(['pointerUp'], LEFT);
                return utils.blueBirdify(() => this.actions(actions));
            });
    }

    getTabIds() {
        return this.windowHandles().get('value');

    }

    isVisible(el) {
        return this.elementIdDisplayed(extractElementId(el)).get('value');
    }

    getSource() {
        return this.source();
    }

    getElementRect(target) {
        let defaultLocation = { width: 0, height: 0, top: 0, left: 0 };
        return this.getElementLocation(target).catch((err) => logger.error('error getting element location', { err }))
            .then(loc => {
                if (loc && loc.value) {
                    return {
                        top: loc.value.y,
                        left: loc.value.x,
                        width: loc.value.width,
                        height: loc.value.height,
                    };
                }
                return defaultLocation;
            });
    }

    end() {
        logger.info('delete session', { sessionId: this.getSessionId() });
        if (!this.getSessionId()) {
            logger.warn('failed to close session because session is undefined');
        }
        clearInterval(this.keepAliveTimer);
        return super.end()
            .catch(() => {
                /* !!!!SILENCE!!!! */
            });
    }

    inViewCenter(rectangle) {
        return {
            x: rectangle.width / 2,
            y: rectangle.height / 2,
        }
    }
}

module.exports = WebDriver;

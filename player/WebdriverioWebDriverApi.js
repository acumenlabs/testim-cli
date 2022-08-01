'use strict';

const webdriverio = require('@testim/webdriverio');
const Queue = require('promise-queue');
const Promise = require('bluebird');
const config = require('../commons/config');
const {
    UNICODE_CHARACTERS, W3C_ELEMENT_ID, EDGE_LAST_VERSION, EDGE_CHROMIUM_MIN_VERSION,
} = require('./constants');
const isElementDisplayed = require('./scripts/isElementDisplayed');
const logger = require('../commons/logger').getLogger('WebDriverApi');
const { isOldProtocol, encodeForSafari } = require('./webDriverUtils');
const { extractElementId } = require('../utils');
const { SELENIUM_PERF_MARKS } = require('../commons/SeleniumPerfStats');

Queue.configure(Promise);
const perf = require('../commons/performance-logger');

const getViewportSizeHelper = function () {
    // this runs on the AUT, should be compatible with old browsers
    // eslint-disable-next-line no-var
    var pixelRatio = (/(MSIE)|(Trident)/.test(navigator.userAgent)) ? (window.screen.systemXDPI / window.screen.deviceXDPI) : 1;
    return {
        screenWidth: Math.floor((window.innerWidth || 0) / pixelRatio),
        screenHeight: Math.floor((window.innerHeight || 0) / pixelRatio),
    };
};

class WebdriverioWebDriverApi {
    constructor() {
        this.w3cRequests = {};
    }

    windowHandleMaximize() {
        return this.addToQueue(() => this.client.windowHandleMaximize().then(result => ({
            height: result.value.height,
            width: result.value.width,
        })));
    }

    rejectWithLog(err, func) {
        const { testName, testResultId } = this;
        const crashingFunc = func ? func.toString().substr(0, 2000) : '';
        logger.warn('error from selenium', {
            err, testResultId, testName, crashingFunc,
        });
        return Promise.reject(err);
    }

    initQueueRequests() {
        let maxConcurrent = Infinity;
        if (this.isIE() || this.isAndroid()) {
            maxConcurrent = 1;
        }
        if (typeof config.REQUESTS_QUEUE_SIZE !== 'undefined') {
            maxConcurrent = config.REQUESTS_QUEUE_SIZE;
        }
        const maxQueue = Infinity;
        this.queue = new Queue(maxConcurrent, maxQueue);
    }

    addToQueue(func) {
        const perfId = this.seleniumPerfStats.markStart();
        return this.queue.add(func)
            .catch(err => this.rejectWithLog(err, func))
            .finally(() => this.seleniumPerfStats.markEnd(perfId));
    }

    initClient(capabilities, testName, testResultId) {
        this.testName = testName;
        this.testResultId = testResultId;
        // silence warning regarding `buttonPress` being deprecated
        capabilities.deprecationWarnings = false;
        this.client = webdriverio.remote(capabilities);
        this.initQueueRequests();
        perf.log('right before addToQueue');
        const perfId = this.seleniumPerfStats.markStart(SELENIUM_PERF_MARKS.GET_BROWSER);
        return this.addToQueue(() => {
            logger.info('requesting browser', { testResultId, testName });
            perf.log('before this.client.init');
            return this.client.init();
        })
            .log('after client init')
            .finally(() => this.seleniumPerfStats.markEnd(perfId, SELENIUM_PERF_MARKS.GET_BROWSER));
    }

    get isMobile() {
        return this.client.isMobile;
    }

    getSessionId() {
        return this.client && this.client.requestHandler && this.client.requestHandler.sessionID;
    }

    isChrome() {
        return this.client.desiredCapabilities.browserName === 'chrome';
    }

    isChromium() {
        return this.isChrome() || this.isEdgeChromium();
    }

    isFirefox() {
        return this.client.desiredCapabilities.browserName === 'firefox';
    }

    isSafari() {
        return this.client.desiredCapabilities.browserName === 'safari' || this.client.desiredCapabilities.browserName === 'safari technology preview';
    }

    isIE() {
        return this.client.desiredCapabilities.browserName === 'internet explorer';
    }

    isAndroid() {
        return this.client.desiredCapabilities.platformName === 'Android';
    }

    isEdge() {
        return this.client.desiredCapabilities.browserName === 'MicrosoftEdge' && this.client.desiredCapabilities._isOldEdge;
    }

    isEdgeChromium() {
        return this.client.desiredCapabilities.browserName === 'MicrosoftEdge' && !this.client.desiredCapabilities._isOldEdge;
    }

    execute(...args) {
        return this.addToQueue(() => {
            let script = args.shift();

            /*!
             * parameter check
             */
            if ((typeof script !== 'string' && typeof script !== 'function')) {
                return Promise.reject(new Error('number or type of arguments don\'t agree with execute protocol command'));
            }

            /*!
             * instances started as multibrowserinstance can't getting called with
             * a function parameter, therefor we need to check if it starts with "function () {"
             */
            if (typeof script === 'function') {
                script = `return (${script}).apply(null, arguments)`;
            }

            const decorateErrorWithExecutedScript = (err => {
                err.executedScript = script;
                throw err;
            });
            const newEndpoint = () => this.client.requestHandler.create('/session/:sessionId/execute/sync', {
                script,
                args,
            }).catch(decorateErrorWithExecutedScript);
            const oldEndpoint = () => this.client.requestHandler.create('/session/:sessionId/execute', { script, args })
                .catch(decorateErrorWithExecutedScript);

            if (this.w3cRequests.execute) {
                return newEndpoint();
            }

            return oldEndpoint()
                .catch(err => {
                    /**
                     * jsonwire command not supported try webdriver endpoint
                     */
                    if (isOldProtocol(err)) {
                        this.w3cRequests.execute = true;
                        return newEndpoint();
                    }

                    return Promise.reject(err);
                });
        });
    }

    /**
     * note that script received here must accept a callback, and call it when they finish running!
     * @param  {...any} args - the first argument is a script, the others are the script arguments.
     */
    executeAsync(...args) {
        return this.addToQueue(() => {
            let script = args.shift();

            /*!
             * parameter check
             */
            if ((typeof script !== 'string' && typeof script !== 'function')) {
                return Promise.reject(new Error('number or type of arguments don\'t agree with execute protocol command'));
            }

            /*!
             * instances started as multibrowserinstance can't getting called with
             * a function parameter, therefor we need to check if it starts with "function () {"
             */
            if (typeof script === 'function') {
                script = `return (${script}).apply(null, arguments)`;
            }

            const newEndpoint = () => this.client.requestHandler.create('/session/:sessionId/execute/async', {
                script,
                args,
            });
            const oldEndpoint = () => this.client.requestHandler.create('/session/:sessionId/execute_async', {
                script,
                args,
            });

            if (this.w3cRequests.executeAsync) {
                return newEndpoint();
            }

            return oldEndpoint()
                .catch(err => {
                    /**
                     * jsonwire command not supported try webdriver endpoint
                     */
                    if (isOldProtocol(err)) {
                        this.w3cRequests.executeAsync = true;
                        return newEndpoint();
                    }

                    return Promise.reject(err);
                });
        });
    }

    async executeCDP(command, parameters = {}) {
        if (!this.isChromium()) {
            return undefined;
        }
        const result = await this.client.requestHandler.create({
            path: '/session/:sessionId/chromium/send_command_and_get_result',
            method: 'POST',
        }, {
            cmd: command,
            params: parameters,
        });
        if (!result || !result.value || !result.value.targetInfos) {
            return [];
        }
        return result.value.targetInfos;
    }

    takeScreenshot() {
        const perfId = this.seleniumPerfStats.markStart(SELENIUM_PERF_MARKS.GET_SCREENSHOT);
        return this.addToQueue(() => this.client.screenshot())
            .finally(() => this.seleniumPerfStats.markEnd(perfId, SELENIUM_PERF_MARKS.GET_SCREENSHOT));
    }

    getElementBySelector(selector) {
        return this.addToQueue(() => this.client.element(selector));
    }

    elementIdDisplayed(elementId) {
        return this.addToQueue(() => {
            const oldEndpoint = () => this.client.elementIdDisplayed(elementId);
            const newEndpoint = () => this.execute(isElementDisplayed, { ELEMENT: elementId, [W3C_ELEMENT_ID]: elementId });

            if (this.w3cRequests.elementIdDisplayed) {
                return newEndpoint();
            }

            return oldEndpoint()
                .catch(err => {
                    /**
                     * jsonwire command not supported try webdriver endpoint
                     */
                    if (isOldProtocol(err)) {
                        this.w3cRequests.elementIdDisplayed = true;
                        return newEndpoint();
                    }

                    return Promise.reject(err);
                });
        });
    }

    windowHandles() {
        return this.addToQueue(() => {
            const oldEndpoint = () => this.client.requestHandler.create('/session/:sessionId/window_handles');
            const newEndpoint = () => this.client.requestHandler.create('/session/:sessionId/window/handles');

            if (this.w3cRequests.windowHandles) {
                return newEndpoint();
            }

            return oldEndpoint()
                .catch(err => {
                    /**
                     * jsonwire command not supported try webdriver endpoint
                     */
                    if (isOldProtocol(err)) {
                        this.w3cRequests.windowHandles = true;
                        return newEndpoint();
                    }

                    return Promise.reject(err);
                });
        });
    }

    url(url) {
        return this.addToQueue(() => this.client.url(encodeForSafari(url, this.isSafari(), logger)));
    }

    reloadTab() {
        return this.addToQueue(() => this.client.refresh());
    }

    source() {
        return this.addToQueue(() => this.client.source());
    }

    timeouts(type, ms) {
        return this.addToQueue(() => {
            const oldEndpoint = () => this.client.requestHandler.create('/session/:sessionId/timeouts', {
                type,
                ms,
            });

            const newEndpoint = () => this.client.requestHandler.create('/session/:sessionId/timeouts', {
                [type]: ms,
            });

            if (this.w3cRequests.timeouts) {
                return newEndpoint();
            }

            return oldEndpoint()
                .catch(err => {
                    if (isOldProtocol(err)) {
                        this.w3cRequests.timeouts = true;
                        return newEndpoint();
                    }
                    return Promise.reject(err);
                });
        });
    }

    scroll(xoffset, yoffset) {
        xoffset = typeof xoffset === 'number' ? xoffset : 0;
        yoffset = typeof yoffset === 'number' ? yoffset : 0;

        const scroll = function (x, y) {
            window.scrollTo(x, y);
        };

        return this.execute(scroll, xoffset, yoffset);
    }

    setValue(element, value) {
        return this.elementIdClear(extractElementId(element))
            .then(() => this.elementIdValue(extractElementId(element), value));
    }

    getViewportSize(prop) {
        return this.execute(getViewportSizeHelper).then((res) => {
            if (typeof prop === 'string' && prop.match(/(width|height)/)) {
                prop = `screen${prop.slice(0, 1).toUpperCase()}${prop.slice(1)}`;
                return res.value[prop];
            }

            return {
                width: res.value.screenWidth || 0,
                height: res.value.screenHeight || 0,
            };
        });
    }

    keys(value) {
        const checkUnicode = value => (UNICODE_CHARACTERS.hasOwnProperty(value) ? [UNICODE_CHARACTERS[value]] : value.split(''));

        let key = [];

        /**
         * replace key with corresponding unicode character
         */
        if (typeof value === 'string') {
            key = checkUnicode(value);
        } else if (value instanceof Array) {
            for (const charSet of value) {
                key = key.concat(checkUnicode(charSet));
            }
        } else {
            return Promise.reject(new Error('number or type of arguments don\'t agree with keys protocol command'));
        }

        const oldEndpoint = () => this.client.requestHandler.create('/session/:sessionId/keys', { value: key });
        const newEndpoint = () => {
            const keyDownActions = key.map((value) => ({ type: 'keyDown', value }));
            const keyUpActions = key.map((value) => ({ type: 'keyUp', value }));

            return this.actions([{
                type: 'key',
                id: 'keys',
                actions: [...keyDownActions, ...keyUpActions],
            }]);
        };

        if (this.w3cRequests.keys) {
            return newEndpoint();
        }

        return this.addToQueue(() => oldEndpoint().catch(err => {
            /**
             * use W3C path if old path failed
             */
            if (isOldProtocol(err)) {
                this.w3cRequests.keys = true;
                return newEndpoint();
            }

            return Promise.reject(err);
        }));
    }

    elementIdValue(elementId, value) {
        return this.addToQueue(() => this.client.elementIdValue(elementId, value));
    }

    elementIdClear(elementId) {
        return this.addToQueue(() => this.client.elementIdClear(elementId));
    }

    submitForm(element) {
        return this.addToQueue(() => this.client.submit(extractElementId(element)));
    }

    buttonPress(button) {
        return this.addToQueue(() => this.client.buttonPress(button));
    }

    findElementAndPress(element, xOffset, yOffset, button) {
        return this.moveTo(extractElementId(element), xOffset, yOffset)
            .then(() => this.buttonPress(button));
    }

    rightClick(element, xOffset, yOffset) {
        return this.findElementAndPress(element, xOffset, yOffset, 'right');
    }

    leftClick(element, xOffset, yOffset) {
        return this.findElementAndPress(element, xOffset, yOffset, 'left');
    }

    elementIdClick(elementId) {
        return this.addToQueue(() => this.client.elementIdClick(elementId));
    }

    actions(actions) {
        return this.addToQueue(() => this.client.actions(actions));
    }

    doDoubleClick() {
        return this.addToQueue(() => this.client.doDoubleClick());
    }

    dragAndDrop(sourceSelector, destinationSelector) {
        return this.addToQueue(() => this.client.dragAndDrop(sourceSelector, destinationSelector));
    }

    buttonDown() {
        return this.addToQueue(() => this.client.buttonDown());
    }

    buttonUp() {
        return this.addToQueue(() => this.client.buttonUp());
    }

    moveTo(element, xoffset, yoffset) {
        const data = {};

        if (typeof xoffset === 'number') {
            data.xoffset = xoffset;
        }

        if (typeof yoffset === 'number') {
            data.yoffset = yoffset;
        }

        // wordaround change offset to x=1 y=1 on Safari
        if (this.isSafari() && !data.hasOwnProperty('yoffset')) {
            data.yoffset = 1;
        }

        if (this.isSafari() && !data.hasOwnProperty('xoffset')) {
            data.xoffset = 1;
        }

        if (typeof element === 'string') {
            data.element = element;
        }

        return this.addToQueue(() => this.client.requestHandler.create('/session/:sessionId/moveto', data));
    }

    uploadFile(localFileLocation) {
        return this.addToQueue(() => this.client.uploadFile(localFileLocation));
    }

    getUrl() {
        return this.addToQueue(() => this.client.getUrl());
    }

    getTitle() {
        return this.addToQueue(() => this.client.getTitle());
    }


    windowHandleSize(windowHandle = 'current', size) {
        return this.addToQueue(() => {
            let data = {};

            if (typeof windowHandle === 'object') {
                [windowHandle, size] = ['current', windowHandle];
            }

            /*!
             * protocol options
             */
            const requestOptions = {
                path: `/session/:sessionId/window/${windowHandle}/size`,
                method: 'GET',
            };

            /*!
             * change window size if the new size is given
             */
            if (typeof size === 'object' && size.width && size.height) {
                requestOptions.method = 'POST';
                // The width and height value might return as a negative value, so
                // we make sure to use its absolute value.
                data = {
                    width: Math.abs(size.width),
                    height: Math.abs(this.isEdge() ? size.height - 1 : size.height),
                };
            }

            /*!
             * type check
             */
            if (requestOptions.method === 'POST' && typeof data.width !== 'number' && typeof data.height !== 'number') {
                return Promise.reject(new Error('number or type of arguments don\'t agree with windowHandleSize protocol command'));
            }

            const oldEndpoint = () => this.client.requestHandler.create(requestOptions, data);
            const newEndpoint = () => {
                requestOptions.path = '/session/:sessionId/window/rect';
                return this.client.requestHandler.create(requestOptions, data);
            };

            if (this.w3cRequests.windowHandleSize) {
                return newEndpoint();
            }

            return oldEndpoint()
                .catch(err => {
                    /**
                     * use W3C path if old path failed
                     */
                    if (isOldProtocol(err)) {
                        this.w3cRequests.windowHandleSize = true;
                        return newEndpoint();
                    }

                    return Promise.reject(err);
                });
        });
    }

    setCookie(name, value, domain, httpOnly, secure, path, expiry) {
        return this.addToQueue(() => this.client.setCookie({
            name,
            value,
            domain,
            httpOnly,
            secure,
            path,
            expiry: expiry ? Math.floor(expiry) : expiry,
        }));
    }

    getCookie(name) {
        return this.addToQueue(() => this.client.requestHandler.create('/session/:sessionId/cookie')
            .then(res => {
                res.value = res.value || [];

                if (typeof name === 'string') {
                    return res.value.find((cookie) => cookie.name === name || cookie.name === encodeURIComponent(encodeURIComponent(name))) || null;
                }

                return res.value || (typeof name === 'string' ? null : []);
            }));
    }

    deleteCookie(name) {
        return this.addToQueue(() => this.client.deleteCookie(name));
    }

    isVisibleWithinViewport(selector) {
        return this.addToQueue(() => this.client.isVisibleWithinViewport(selector));
    }

    getCurrentTabId() {
        return this.addToQueue(() => this.client.getCurrentTabId());
    }

    frame(id) {
        return this.addToQueue(() => this.client.frame(id));
    }

    switchTab(tabId) {
        return this.addToQueue(() => this.client.switchTab(tabId));
    }

    alertAccept() {
        return this.addToQueue(() => this.client.alertAccept());
    }

    log(type = 'browser') {
        return this.addToQueue(() => this.client.log(type));
    }

    end() {
        this.w3cRequests = {};
        return this.queue ? this.addToQueue(() => this.client.end()) : Promise.resolve();
    }

    forceEnd() {
        this.w3cRequests = {};
        return this.client ? this.client.end() : Promise.resolve();
    }

    touchPerform(actions) {
        return this.addToQueue(() => this.client.touchPerform(actions));
    }

    touchAction(attr) {
        return this.addToQueue(() => this.client.touchAction(attr));
    }

    pressKeycode(keyCode) {
        return this.addToQueue(() => this.client.pressKeycode(keyCode));
    }

    setImmediateValue(elementId, text) {
        return this.addToQueue(() => this.client.setImmediateValue(elementId, text));
    }

    elementIdText(elementId) {
        return this.addToQueue(() => this.client.elementIdText(elementId))
            .then(res => res.value);
    }

    isAppInstalled(packageName) {
        return this.addToQueue(() => this.client.isAppInstalled(packageName))
            .then(isInstalled => {
                const ret = !!isInstalled.value;
                logger.info(`is app (${packageName}) installed? ${ret}`, isInstalled);
                return ret;
            });
    }

    launch() {
        return this.addToQueue(() => this.client.launch());
    }

    context(id) {
        return this.addToQueue(() => this.client.context(id));
    }

    elementIdLocation(elementId) {
        return this.addToQueue(() => this.client.elementIdLocation(elementId));
    }
}

module.exports = WebdriverioWebDriverApi;

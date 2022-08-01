const sessionPlayer = require('../../commons/getSessionPlayerRequire');

const { locatorBuilderUtils, utils, codeSnippets } = sessionPlayer;
const CookieUtils = require('./cookieUtils');

class StepActionUtils {
    constructor(driver, cookieUtils) {
        this.driver = driver;
        this._abortedSteps = [];
        this.cookieUtils = cookieUtils || new CookieUtils(this.driver);
    }

    getTimeStamp() {
        return Date.now();
    }

    getTestimId(element) {
        if (!element) {
            return undefined;
        }
        const testimIDFieldName = locatorBuilderUtils.TESTIM_ID_FIELD_NAME;
        return locatorBuilderUtils.isEmptyResult(element) ? locatorBuilderUtils.EMPTY_RESULT_ID : element.getAttribute(testimIDFieldName);
    }

    resetAbort() {
        this._abortedSteps = [];
    }

    abort(result) {
        this._abortedSteps.push(result);
    }

    get abortedSteps() {
        return this._abortedSteps;
    }

    restoreNativeAlerts() {}

    executeOverloadNativeAlertsInFrame() {}

    getClickOffset(clickOffset, rect) {
        if (clickOffset && utils.isWithinBounds(0, rect.width, clickOffset.x) && utils.isWithinBounds(0, rect.height, clickOffset.y)) {
            return {
                xOffset: clickOffset.x,
                yOffset: clickOffset.y,
            };
        }
        return {
            xOffset: rect.width / 2,
            yOffset: rect.height / 2,
        };
    }

    executeInAut(context, code) {
        return this.driver.executeJS(code).get('value');
    }

    extractTargetText(target) {
        return this.driver.getTargetText(target);
    }

    extractText(locatedElement) {
        return this.driver.getElementTextJS(locatedElement);
    }

    markDynamicParent(target, id) {
        return this.driver.markDynamicParent(target, id);
    }

    getCookie(name) {
        return this.cookieUtils.get({ name }).then(cookie => (cookie ? [cookie] : []));
    }
    setCookie(cookieObject, frameHandler) {
        return this.cookieUtils.set(cookieObject).then(cookie => [cookie]);
    }

    getNextDynamicParent(frameHandler, dynamicParentOptions) {
        const code = `return ${codeSnippets.getNextDynamicParent(dynamicParentOptions)}`;
        return this.driver.executeJS(code).then(res => res.value);
    }
}

module.exports = StepActionUtils;

/**
 * @typedef {typeof import('../../../../clickim/src/background/eyeSdkBuilder').EyeSdkBuilder} EyeSdkBuilder
 * @typedef {import('@applitools/types').SpecDriver} SpecDriver
 * @typedef {import('@applitools/types').Core} Core
 */

const { EyeSdkBuilder } = require('../../commons/getSessionPlayerRequire');
const { makeSDK } = require('@applitools/eyes-sdk-core');
const { W3C_ELEMENT_ID } = require('../constants');
const _ = require('lodash');

let packageJson;
// There is a difference in the folder structure in prod vs. dev
try {
    // PRODUCTION
    // eslint-disable-next-line import/no-unresolved
    packageJson = require('../../package.json');
} catch (e) {
    //pass
}
if (!packageJson) {
    try {
        // in dev, they are one level up
        packageJson = require('../../../package.json');
    } catch (e) {
        //pass
    }
}

const LEGACY_ELEMENT_ID = 'ELEMENT';

function extractElementId(element) {
    if (_.has(element, 'elementId')) {
        return element.elementId;
    }
    if (_.has(element, W3C_ELEMENT_ID)) {
        return element[W3C_ELEMENT_ID];
    }
    if (_.has(element, LEGACY_ELEMENT_ID)) {
        return element[LEGACY_ELEMENT_ID];
    }
    return undefined;
}
/** implements the ?? capability for backward compatibility */
function getValueOrFallbackIfNullOrUndefined(value, fallback) {
    if (value === null || value === undefined) {
        return fallback;
    }
    return value;
}

/**
 * Applitools Spec Driver for webdriverIO 4.
 * @see https://github.com/applitools/eyes.sdk.javascript1/blob/master/packages/eyes-webdriverio-4/src/spec-driver.ts
 * @implements {SpecDriver}
 */
class EyesSpec {
    // #region UTILITY
    isDriver(driver) {
        return Boolean(driver && driver.getPrototype && driver.desiredCapabilities && driver.requestHandler);
    }

    isElement(element) {
        if (!element) {
            return false;
        }
        const elementToCheck = element.value || element;
        return Boolean(elementToCheck[W3C_ELEMENT_ID] || elementToCheck[LEGACY_ELEMENT_ID]);
    }

    isSelector(selector) {
        return _.isString(selector);
    }

    transformDriver(driver) {
        return new Proxy(driver, {
            get: (target, key) => {
                if (key === 'then') {
                    return undefined;
                }
                return Reflect.get(target, key);
            },
        });
    }

    transformElement(element) {
        const elementId = extractElementId(element.value || element);
        return { [W3C_ELEMENT_ID]: elementId, [LEGACY_ELEMENT_ID]: elementId };
    }

    transformSelector(selector) {
        if (!_.has(selector, 'selector')) {
            return selector;
        }
        if (!_.has(selector, 'type')) {
            return selector.selector;
        }
        if (selector.type === 'css') {
            return `css selector:${selector.selector}`;
        }
        return `${selector.type}:${selector.selector}`;
    }

    extractSelector(element) {
        return _.has(element, 'selector') ? element.selector : undefined;
    }

    isStaleElementError(error, selector) {
        if (!error) {
            return false;
        }
        const errOrResult = error.originalError || error;
        return errOrResult instanceof Error ?
            errOrResult.seleniumStack && errOrResult.seleniumStack.type === 'StaleElementReference' :
            errOrResult.value && errOrResult.selector && errOrResult.selector === selector;
    }

    isEqualElements(_browser, element1, element2) {
        if (!element1 || !element2) {
            return false;
        }
        const elementId1 = extractElementId(element1);
        const elementId2 = extractElementId(element2);
        return elementId1 === elementId2;
    }
    // #endregion

    // #region COMMANDS
    async executeScript(driver, script, arg) {
        const { value } = await driver.execute(script, arg);
        return value;
    }

    async mainContext(driver) {
        await driver.frame(null);
        return driver;
    }

    async parentContext(driver) {
        await driver.frameParent();
        return driver;
    }

    async childContext(driver, element) {
        await driver.frame(element);
        return driver;
    }

    async findElement(driver, selector, parent) {
        const { value } = parent ? await driver.elementIdElement(extractElementId(parent), selector) : await driver.element(selector);
        return value;
    }

    async findElements(driver, selector, parent) {
        const { value } = parent ? await driver.elementIdElements(extractElementId(parent), selector) : await driver.elements(selector);
        return value;
    }

    async getWindowSize(driver) {
        const { value: size } = await driver.windowHandleSize();
        return { width: size.width, height: size.height };
    }

    async setWindowSize(driver, size) {
        await driver.windowHandlePosition({ x: 0, y: 0 });
        await driver.windowHandleSize(size);
    }

    async getDriverInfo(driver) {
        const desiredCapabilities = driver.desiredCapabilities;

        return {
            sessionId: driver.requestHandler.sessionID || driver.sessionId,
            isMobile: driver.isMobile,
            isNative: driver.isMobile && !desiredCapabilities.browserName,
            deviceName: desiredCapabilities.deviceName,
            platformName: desiredCapabilities.platformName || desiredCapabilities.platform,
            platformVersion: desiredCapabilities.platformVersion,
            browserName: getValueOrFallbackIfNullOrUndefined(desiredCapabilities.browserName, desiredCapabilities.name),
            browserVersion: getValueOrFallbackIfNullOrUndefined(desiredCapabilities.browserVersion, desiredCapabilities.version),
            pixelRatio: desiredCapabilities.pixelRatio,
        };
    }

    async getTitle(driver) {
        return driver.getTitle();
    }

    async getUrl(driver) {
        return driver.getUrl();
    }

    async visit(driver, url) {
        await driver.url(url);
    }

    async takeScreenshot(driver) {
        return driver.saveScreenshot();
    }

    async click(driver, element) {
        if (this.isSelector(element)) {
            element = await this.findElement(driver, element);
        }
        await driver.elementIdClick(extractElementId(element));
    }

    async hover(driver, element, offset) {
        if (this.isSelector(element)) {
            element = await this.findElement(driver, element);
        }
        await driver.moveTo(extractElementId(element), offset && offset.x, offset && offset.y);
    }

    async type(driver, element, keys) {
        if (this.isSelector(element)) {
            element = await this.findElement(driver, element);
        } else {
            driver.elementIdValue(extractElementId(element), keys);
        }
    }

    async scrollIntoView(driver, element, align = false) {
        if (this.isSelector(element)) {
            element = await this.findElement(driver, element);
        }
        await driver.execute('arguments[0].scrollIntoView(arguments[1])', element, align);
    }

    async waitUntilDisplayed(driver, selector, timeout) {
        await driver.waitForVisible(selector, timeout);
    }
    // #endregion
}

class EyeSdkService {
    constructor() {
        const sdkVersion = packageJson ? packageJson.dependencies['@applitools/eyes-sdk-core'] : 'N/A';

        /** @type {Core} */
        this.sdk = makeSDK({
            name: 'Testim.io',
            version: `4.0.0/eyes-sdk-core/${sdkVersion}`,
            spec: new EyesSpec(),
            VisualGridClient: require('@applitools/visual-grid-client'),
        });
        /** @type {EyeSdkBuilder['handleApplitoolsSdkResult']} */
        this.handleApplitoolsSdkResult = EyeSdkBuilder.handleApplitoolsSdkResult;
    }
    async getManager(useVisualGrid, concurrency, batchId, applitoolsIntegrationData) {
        const manager = await this.sdk.makeManager({ type: useVisualGrid ? 'vg' : 'classic', concurrency });
        EyeSdkBuilder.rememberCreatedBatch(batchId, applitoolsIntegrationData);
        return manager;
    }
}

exports.eyeSdkService = new EyeSdkService();

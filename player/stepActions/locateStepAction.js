'use strict';

const StepAction = require('./stepAction');
const Promise = require('bluebird');
const sessionPlayer = require('../../commons/getSessionPlayerRequire');
const featureFlags = require('../../commons/featureFlags');
const logger = require('../../commons/logger').getLogger('locate-step-action');

const { JSDOM, VirtualConsole } = require('jsdom');

const {
    locatorBuilderUtils, codeSnippets, visibilityUtils, positionUtils,
} = sessionPlayer;

const DEFAULT_VISIBILITY_RESULT = { opacity: 1, clientRects: {} };

function createUtils(driver) {
    return class LocatorUtils {
        static getFrameIdByTestimFrameId() { }

        static setElementResultDataOnContext(target) {
            return driver.getElement(target.locatedElement)
                .then(seleniumResponse => {
                    target.seleniumElement = seleniumResponse.value;
                });
        }

        static getElementRectangle(target) {
            return driver.getElementRect(target);
        }

        static getOffsets(frameHandler) {
            return Promise.resolve([frameHandler.frameOffset || {}]);
        }

        static htmlStringToDom(htmlString, url, nonBodyElements, bodyTagName, setDomTimeout = true) {
            const virtualConsole = new VirtualConsole();
            const jsdom = new JSDOM(htmlString, {
                virtualConsole,
            });

            const { window } = jsdom;
            if (setDomTimeout) {
                // memory leak fix.
                // this used to be nexttick, but it was too soon.

                setTimeout(() => {
                    window.close();
                }, 1000 * 60);
            }
            window.document.TESTIM_URL = url;
            return window.document;
        }

        static shouldUseNativeVisibilityCheck(locateStep, driver, visibilityUtils, positionUtils) {
            if (locateStep.opacity === 0) {
                return false;
            }
            if (locateStep.isShadowed) {
                return false;
            }
            if ((visibilityUtils === undefined) || (positionUtils === undefined)) {
                return true;
            }
            if (featureFlags.flags.useClickimVisibilityChecks.isEnabled()) {
                return false;
            }
            if (driver.isSafari()) {
                return featureFlags.flags.useSafariWebdriverVisibilityChecks.isEnabled();
            }
            if (driver.isIE()) {
                return featureFlags.flags.useIEWebdriverVisibilityChecks.isEnabled();
            }
            return true;
        }

        static isVisible(target, targetElement, rect, locateStep, frameHandler, allOffsets, dom) {
            const skipVisibilityCheck =
                featureFlags.flags.disableEdgeVisibilityChecks.isEnabled() && driver.isEdge();

            if (skipVisibilityCheck) {
                logger.info('bypassed visibility check because of feature flag');
                target.visibilityCheckSkipped = skipVisibilityCheck;
                return driver.isVisible(target.seleniumElement).catch(() => { }).then(() => true);
            }

            const useNativeVisibilityCheck = LocatorUtils.shouldUseNativeVisibilityCheck(locateStep, driver, visibilityUtils, positionUtils);
            if (useNativeVisibilityCheck) {
                return driver.isVisible(target.seleniumElement);
            }

            const handler = res => {
                if (!targetElement || locatorBuilderUtils.isEmptyResult(targetElement)) {
                    return Promise.resolve({ visible: false, invisibleReason: 'element not found' });
                }
                const middlePosition = positionUtils.calculateElementMiddlePoint(rect);
                const points = [middlePosition, positionUtils.calculateClickPoint(locateStep.clickOffset, rect)].filter(Boolean);
                const code = codeSnippets.getVisibilityCode.getCompoundVisibilityInfoCode(target.locatedElement, points, false, locateStep);
                return driver.execute(`return ${code}`)
                    .catch(err => {
                        logger.error('failed to execute getVisibilityCode', { err });
                        throw err;
                    })
                    .then((response = {}) => {
                        const { value: result } = response;
                        const elementVisibilityInfo = result.elementVisibilityInfo || DEFAULT_VISIBILITY_RESULT;
                        const [middleElementFromPoint, clickElementFromPoint] = result.elementsFromPointResults || [null, null];

                        return visibilityUtils.checkElementVisibility(elementVisibilityInfo, locateStep, clickElementFromPoint, middleElementFromPoint, dom, targetElement);
                    });
            };

            if (!target.seleniumElement) {
                return Promise.resolve({ visible: false, invisibleReason: 'element not found' });
            }

            // this is here for the side effects.
            return driver.isVisible(target.seleniumElement)
                .catch(() => { })
                .then(handler);
        }

        static scrollToElement(frameHandler, locatedElement) {
            const code = codeSnippets.scrollToElement;
            return driver.execute(code(locatedElement));
        }
    };
}

class LocateStepAction extends StepAction {
    execute() {
        return this.driver.getHTML(this.step);
    }

    static getUtils(driver) {
        return Object.assign(createUtils(driver), { useLocatedElement: true });
    }

    static getFrameIdByTestimFrameId(...args) {
        logger.warn('Unplanned access to getFrameIdByTestimFrameId()');
        throw new Error('Use .getUtils() instead');
    }

    static setElementResultDataOnContext(...args) {
        logger.warn('Unplanned access to setElementResultDataOnContext()');
        throw new Error('Use .getUtils() instead');
    }

    static getElementRectangle(...args) {
        logger.warn('Unplanned access to getElementRectangle()');
        throw new Error('Use .getUtils() instead');
    }

    static getOffsets(...args) {
        logger.warn('Unplanned access to getOffsets()');
        throw new Error('Use .getUtils() instead');
    }

    static htmlStringToDom(...args) {
        logger.warn('Unplanned access to htmlStringToDom()');
        throw new Error('Use .getUtils() instead');
    }

    static isVisible(...args) {
        logger.warn('Unplanned access to isVisible()');
        throw new Error('Use .getUtils() instead');
    }
}

module.exports = LocateStepAction;


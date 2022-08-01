'use strict';

const Promise = require('bluebird');
const logger = require('../../commons/logger').getLogger('frame-locator');
const { locatorBuilderUtils } = require('../../commons/getSessionPlayerRequire');
const featureFlags = require('../../commons/featureFlags');

const SELENIUM_ELEMENT_KEY = 'ELEMENT';
const SELENIUM_GUID_KEY = 'element-6066-11e4-a52e-4f735466cecf';

const _getGuidFromSeleniumElement = (seleniumElement) => {
    if (!seleniumElement) {
        return null;
    }

    return seleniumElement[SELENIUM_ELEMENT_KEY] || seleniumElement[SELENIUM_GUID_KEY];
};

/** @param {import('../webdriver')} driver*/
module.exports = function frameLocatorFactory(driver) {
    class FrameLocator {
        constructor(frameManager, locateElementPlayer) {
            this.frameManager = frameManager;
            this.locateElementPlayer = locateElementPlayer;
            this._cache = {};
        }

        cacheResults(seleniumGuid, resultsUrl) {
            this._cache[seleniumGuid] = resultsUrl;
        }

        getResultsFromCache(seleniumGuid) {
            return this._cache[seleniumGuid];
        }

        cacheFrameLocateResults(frameHandler) {
            if (frameHandler && frameHandler.seleniumFrameElement && frameHandler.frameLocateResultUrl) {
                const guid = _getGuidFromSeleniumElement(frameHandler.seleniumFrameElement);
                if (guid) {
                    this.cacheResults(guid, frameHandler.frameLocateResultUrl);
                }
            }
        }

        foundFrameCallback(result, frameTree, testimFrameId) {
            const { frameOffset, locatedElement } = result;
            if (locatorBuilderUtils.isEmptyResult(locatedElement)) {
                logger.error('got empty result in frame result, not rejected from locate element player');
                return Promise.reject();
            }
            return driver.switchToLocatedFrame(locatedElement)
                .then(el => {
                    const guid = _getGuidFromSeleniumElement(el.value);
                    const frameLocateResultUrl = this.getResultsFromCache(guid);

                    return {
                        frameId: -1,
                        frameOffset,
                        tabInfo: frameTree.tabInfo,
                        tabId: frameTree.tabId,
                        testimFrameId,
                        testimFullFrameId: `${this.currentFrameHandler.testimFullFrameId}-${testimFrameId}`,
                        seleniumFrameElement: el.value,
                        frameLocateResultUrl,
                    };
                });
        }

        locate(frameLocator, frameDepth, currentFrame, context, frameTree, stepData) {
            // eslint-disable-next-line new-cap
            const locateElementPlayer = new this.locateElementPlayer(context);
            frameLocator.targetId = `frameLocator_${frameDepth}`;
            return locateElementPlayer.locate(frameLocator, currentFrame, frameLocator.targetId)
                .then(result => {
                    result.isVisible = true; // frame visibility check is done on the target element
                    return locateElementPlayer.handleLocateResult(result, stepData, frameLocator)
                        .catch(() => { throw new Error(); }); // silence [object object] errors;
                })
                .then(result => {
                    const { locatedElement } = context.data[frameLocator.targetId];
                    return driver.getElementLocationWithPadding(locatedElement)
                        .then(location => {
                            const value = location.value || { top: 0, left: 0 };
                            result.frameOffset = {
                                top: currentFrame.frameOffset.top + value.top,
                                left: currentFrame.frameOffset.left + value.left,
                            };
                            return result;
                        });
                })
                .then(result => {
                    if (locateElementPlayer.addFrameDataToContext) {
                        locateElementPlayer.addFrameDataToContext(result.targetId, result.locateResult);
                    }
                    return this.foundFrameCallback(result, frameTree, frameLocator.testimFrameId);
                })
                .then(frameHandler => {
                    this.currentFrameHandler = frameHandler;
                    return frameHandler;
                });
        }

        findFrame(stepData, frameLocators, context, frameTree) {
            const allowNoFrameSwitch = featureFlags.flags.enableFrameSwitchOptimization.isEnabled();
            const chronologicalResults = context.playback.resultsHandler.resultsByChronologicOrder;
            const lastResult = chronologicalResults[chronologicalResults.length - 1];
            const allowedRetries = 1;
            const moreThanAllowedRetries = Boolean(lastResult) && lastResult.stepId === stepData.id && lastResult.results.length > allowedRetries;
            if (allowNoFrameSwitch && !moreThanAllowedRetries && this.currentFrameHandler) {
                const currentFramePos = frameLocators.findIndex(x => x.testimFrameId === this.currentFrameHandler.testimFrameId);
                if (currentFramePos > -1) {
                    const shorterPath = frameLocators.slice(currentFramePos + 1);
                    return Promise.reduce(shorterPath, (currentFrame, frameLocator, index) => this.locate(frameLocator, index, currentFrame, context, frameTree, stepData), this.currentFrameHandler);
                }
            }

            return frameTree.getTopFrameHandler()
                .then(topFrameHandler => {
                    topFrameHandler.frameOffset = { top: 0, left: 0 };
                    const switchToTop = (allowNoFrameSwitch && this.currentFrameHandler === topFrameHandler) ?
                        Promise.resolve(this.currentFrameHandler) :
                        driver.switchToTopFrame();
                    return switchToTop.then(() => {
                        this.cacheFrameLocateResults(this.currentFrameHandler);
                        this.currentFrameHandler = topFrameHandler;
                        return Promise.reduce(frameLocators, (currentFrame, frameLocator, index) =>
                            this.locate(frameLocator, index, currentFrame, context, frameTree, stepData), topFrameHandler);
                    });
                });
        }
    }

    return FrameLocator;
};

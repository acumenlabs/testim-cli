'use strict';

const StepAction = require('./stepAction');
const _ = require('lodash');
const logger = require('../../commons/logger').getLogger('input-file-step-action');
const { codeSnippets, utils } = require('../../commons/getSessionPlayerRequire');
const { extractElementId, download } = require('../../utils');
const inputFileUtils = require('../../inputFileUtils');
const featureFlagService = require('../../commons/featureFlags');

class InputFileStepAction extends StepAction {
    uploadFile(localFileLocation) {
        return this.driver.uploadFile(localFileLocation);
    }

    forceInputToBeVisible(target, visibleScriptOptions) {
        logger.info('workaround - stepaction - move element to visible position');

        const getVisibleElementCode = `
            var getLocatedElement = ${codeSnippets.getLocatedElementCode};
            var getVisibleElement = ${inputFileUtils.getVisibleElementScript(visibleScriptOptions)};
            return getVisibleElement.apply(null, arguments);
        `;

        return this.driver.executeJS(getVisibleElementCode, target.locatedElement);
    }

    async safariPreUploadActions(target) {
        const options = {
            width: '150px',
            height: '150px',
            left: '10px',
            top: '10px',
        };
        try {
            return await this.forceInputToBeVisible(target, options);
        } catch (err) {
            logger.error('failed to set input file in Safari recovery', { err });
            throw err;
        }
    }

    async uploadFilesAndForceVisibility(gridLocalFiles, target) {
        try {
            if (this.driver.isSafari()) {
                await this.safariPreUploadActions(target);
            }
            await this.uploadFiles(gridLocalFiles, target);
        } catch (err) {
            const edgeErrorEditableMessage = 'The element is not editable';
            const edgeErrorFocusableMessage = 'The element is not focusable';
            const safariErrorVisibleMessage = 'An element command could not be completed because the element is not visible on the page.';
            const elementNotInteractable = 'element not interactable';
            const elementNotPointerOrKeyboardInteractable = 'element is not pointer- or keyboard interactable';
            const invalidStateMsg = 'invalid element state: Element is not currently interactable and may not be manipulated';
            const mustBeVisibleMsg = 'Element must not be hidden, disabled or read-only';
            const notReachableByKeyboard = 'is not reachable by keyboard';
            const errorMsg = err ? err.message : '';
            // Workaround move element if element is not visible or disabled
            if (_.isEqual(errorMsg, invalidStateMsg) ||
                _.startsWith(errorMsg, mustBeVisibleMsg) ||
                _.startsWith(errorMsg, edgeErrorEditableMessage) ||
                _.startsWith(errorMsg, edgeErrorFocusableMessage) ||
                _.startsWith(errorMsg, safariErrorVisibleMessage) ||
                _.includes(errorMsg, notReachableByKeyboard) ||
                _.includes(errorMsg, elementNotInteractable) ||
                _.includes(errorMsg, elementNotPointerOrKeyboardInteractable)
            ) {
                await this.forceInputToBeVisible(target);
                await this.uploadFiles(gridLocalFiles, target);
                return;
            }

            logger.error('failed to set input file', { err });
            throw err;
        }
    }

    async uploadFiles(gridLocalFiles, target) {
        for (const file of gridLocalFiles) {
            await this.driver.elementIdValue(extractElementId(target.seleniumElement), file);
        }
    }

    async performAction() {
        const target = this.context.data[this.step.targetId || 'targetId'];
        const overrideAzureStorageUrl = featureFlagService.flags.overrideAzureStorageUrl.isEnabled();
        const useJsInputCodeInSafari = featureFlagService.flags.useJsInputCodeInSafari.isEnabled();
        const useJsInputCodeInFirefox = featureFlagService.flags.useJsInputCodeInFirefox.isEnabled();
        const downloadToBase64 = featureFlagService.flags.downloadToBase64.isEnabled();

        let fileUrls = await utils.addTokenToFileUrl(this.context.project.id, this.step.fileUrls, this.stepActionUtils.testimServicesApi, overrideAzureStorageUrl, logger);


        const isSafariJsInputCode = this.driver.isSafari() && (useJsInputCodeInSafari || fileUrls.length > 1);
        const isFirefoxJsInputCode = this.driver.isFirefox() && (useJsInputCodeInFirefox || fileUrls.length > 1);

        if (downloadToBase64) {
            fileUrls = await Promise.all(fileUrls.map(async ({ name, url }) => {
                const res = await download(url);
                return { name, url: `data:${res.type};base64,${Buffer.from(res.body).toString('base64')}` };
            }));
        }
        if (isSafariJsInputCode || isFirefoxJsInputCode) {
            await this.driver.executeJSWithArray(`
                const getLocatedElement = ${codeSnippets.getLocatedElementCode};
                const downloadAndUploadFile = ${downloadAndUpload()};
                return downloadAndUploadFile.apply(null, arguments);`, [target.locatedElement, fileUrls]);
            return;
        }

        const gridLocalFiles = await inputFileUtils.downloadFilesAndUploadToGrid(fileUrls, this.uploadFile.bind(this));
        await this.uploadFilesAndForceVisibility(gridLocalFiles, target);
    }
}

module.exports = InputFileStepAction;
function downloadAndUpload() {
    return `async function downloadAndUpload(locatedElement, fileUrls) {
        const fileIsNative = typeof window.File === 'function' && (window.File.toString().indexOf('native code') > -1);
        const File = fileIsNative ? window.File : (function obtainSafeGlobals() {
            const attachTo  = document.body || document.documentElement;
            if (attachTo) {
                let tempIFrame;
                try {
                    tempIFrame = document.createElement('iframe');
                    tempIFrame.style.setProperty('display', 'none');
                    tempIFrame.style.setProperty('pointer-events', 'none');
                    attachTo.appendChild(tempIFrame);
                    const { File } = tempIFrame.contentWindow;
                    return File;
                } finally {
                    if (tempIFrame) {
                        tempIFrame.parentElement.remove(frame);
                    }
                }
            } else {
                return window.File;
            }
        })();
        const element = getLocatedElement(locatedElement);
        if(!element) {
            throw new Error('element not found');
        }

        function getFileBlob(url) {
            return new Promise((resolve, reject) => {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.responseType = 'blob';

                xhr.onload = function() {
                    if (this.status === 200) {
                        resolve(this.response);
                    } else {
                        reject(new Error('Could not load file, failure status:' + this.status));
                    }
                }
                xhr.onerror = function(e) {
                    reject(new Error("Error " + e.target.status + " occurred while loading the file."));
                };
                xhr.send();
            });

        }

        const fileList = await Promise.all(fileUrls.map(async ({ url, name }) => {
            let blob;
            try {
                const res = await fetch(url)
                blob = await res.blob();
            } catch (err) {
                blob = await getFileBlob(url); // Sometimes the fetch fails, try using XHR as fallback
            }
            return new File([blob], name, { type: blob.type });
        }));

        const dt = new DataTransfer();
        for (const file of fileList) {
            dt.items.add(file);
        }
        element.files = dt.files;

        let changeWasFired = false;
        const changeFiredHandler = (e) => {
            changeWasFired = true;
        };

        element.addEventListener("change", changeFiredHandler, true);
        await Promise.resolve(); // wait microtick
        element.dispatchEvent(new Event("input", { bubbles: true }));
        if (!changeWasFired) {
            element.dispatchEvent(new Event("change", { bubbles: true }));
        }
        element.removeEventListener("change", changeFiredHandler, true);
    }`;
}

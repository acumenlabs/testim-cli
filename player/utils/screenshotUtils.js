'use strict';

const Promise = require('bluebird');
const pRetry = require('p-retry');

class ScreenshotUtils {
    constructor(tabId, driver, options = { takeScreenshots: true }) {
        this.tabId = tabId;
        this.driver = driver;
        this.options = options;
    }

    base64AddPadding(str) {
        return str + Array(((4 - (str.length % 4)) % 4) + 1).join('=');
    }

    shouldTakeScreenshots() {
        if (typeof this.options.takeScreenshots !== 'boolean') {
            return true;
        }
        return this.options.takeScreenshots;
    }

    takeScreenshot() {
        if (!this.shouldTakeScreenshots()) {
            return Promise.resolve({ devicePixelRatio: 1, image: '' });
        }
        const MAX_RETRY_COUNT = 3;
        const SCREENSHOT_RETRY_DELAY = 2000;
        const devicePixelRatioPromise = this.currentDevicePixelRatio ? Promise.resolve(this.currentDevicePixelRatio) : this.getDevicePixelRatio();
        const getScreenshot = () => Promise.all([devicePixelRatioPromise, this.driver.takeScreenshot()]);
        return pRetry(getScreenshot, { retries: MAX_RETRY_COUNT, minTimeout: SCREENSHOT_RETRY_DELAY })
            .then(([devicePixelRatio, image]) => {
                const base64 = image ? image.value : '';
                const dataUrl = `data:image/png;base64,${this.base64AddPadding(base64.replace(/[\r\n]/g, ''))}`;
                return {
                    image: dataUrl,
                    devicePixelRatio,
                };
            });
    }

    getDevicePixelRatio() {
        function devicePixelRatioJS() {
            try {
                return window.devicePixelRatio;
            } catch (err) {
                return 1;
            }
        }

        return this.driver.executeJS(devicePixelRatioJS).then(result => Promise.resolve(result.value));
    }

    forcePixelRatio(forceRatio = 1) {
        this.currentDevicePixelRatio = forceRatio;
        return Promise.resolve();
    }

    getCurrentDevicePixelRatio() {
        return this.currentDevicePixelRatio;
    }
}

module.exports = ScreenshotUtils;


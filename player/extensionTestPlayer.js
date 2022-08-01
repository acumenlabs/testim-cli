"use strict";

const Promise = require('bluebird');
const WebDriver = require('./webdriver');

class ExtensionTestPlayer {
    constructor(id) {
        this.driver = new WebDriver();
        this.id = id;
    }

    onDone() {
        const END_DRIVER_TIMEOUT = 1000 * 60 * 2;
        return this.driver.end()
            .timeout(END_DRIVER_TIMEOUT)
            .catch(Promise.TimeoutError, () => {
                return this.driver.forceEnd();
            })
            .catch(() => {})
            .then(() => {
                this.driver = null;
            });
    }

    getSessionId() {
        return this.driver.getSessionId();
    }
}

module.exports = ExtensionTestPlayer;

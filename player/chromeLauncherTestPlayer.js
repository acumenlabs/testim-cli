'use strict';

const launcher = require('chrome-launcher');
const desiredCapabilitiesBuilder = require('../commons/testimDesiredCapabilitiesBuilder');
const utils = require('../utils');
const httpRequest = require('../commons/httpRequest');
const { registerExitHook } = require('../processHandler');
const CDPTestRunner = require('../cdpTestRunner');

class LauncherDriver {
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.cdpTestRunner = new CDPTestRunner();
    }

    async init(browserOptions, testName, testRunConfig, gridInfo, customExtensionLocalLocation, executionId, testResultId) {
        const capabilities = desiredCapabilitiesBuilder.buildSeleniumOptions(browserOptions, testName, testRunConfig, gridInfo, customExtensionLocalLocation, executionId, testResultId);
        const chromeFlags = [
            ...capabilities.desiredCapabilities.chromeOptions.args,
            ...launcher.Launcher.defaultFlags().filter(flag => flag !== '--disable-extensions'),
        ];
        this.chrome = await launcher.launch({ chromeFlags, startingUrl: undefined, ignoreDefaultFlags: true });
        this.chrome.process.once('exit', () => { this._isAlive = false; });
        this.chrome.process.once('close', () => { this._isAlive = false; });
        this._isAlive = true;
        const webSocketDebuggerUrl = await utils.getCdpAddressForHost(`localhost:${this.chrome.port}`);
        await this.cdpTestRunner.initSession(webSocketDebuggerUrl);

        registerExitHook(() => this.chrome.kill());
    }

    isAlive() {
        return this._isAlive;
    }

    start() {
    }

    async stop() {
        await this.cdpTestRunner.stopSession();
        if (this.chrome) {
            await this.chrome.kill();
        }
        this._isAlive = false;
    }

    getSessionId() {
        return this.sessionId;
    }
}

class ChromeLauncherTestPlayer {
    constructor(id) {
        this.sessionId = utils.guid();
        this.driver = new LauncherDriver(this.sessionId);
        this.id = id;
    }

    async onDone() {
        return this.driver.stop();
    }

    getSessionId() {
        return this.sessionId;
    }
}

module.exports = ChromeLauncherTestPlayer;

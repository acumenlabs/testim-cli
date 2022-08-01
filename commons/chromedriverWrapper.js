/* eslint-disable no-console */

const fkill = require('fkill');
const pRetry = require('p-retry');

const httpRequest = require('./httpRequest');
const npmWrapper = require('./npmWrapper');
const { getCliLocation } = require('../utils');
const { requireWithFallback } = require('./requireWithFallback');

const PACKAGE_NAME = 'chromedriver';
const DRIVER_PORT = 9515;
const DRIVER_BASE_URL = `http://localhost:${DRIVER_PORT}/wd/hub`;
const DEFAULT_DRIVER_ARGS = [
    // webdriverio expects a wd/hub (selenium-server like server endpoint)
    '--url-base=/wd/hub',
    // don't complain about driver version
    '--disable-build-check',
    // allow any ip to connect chrome driver
    '--whitelisted-ips=0.0.0.0',
    '--log-level=OFF', // instead we could try to log it somehow or at least have a flag to enable this
];

// [NOTE] This is a "smart installation":
// By default chromedriver package, when installed, will search for an existing binary in the configured temp directory.
// If found, and it is the correct version, it will simply copy it to your node_modules directory, and if not it will download the newer version.
const install = async () => {
    await npmWrapper.installPackageLocally(getCliLocation(), `${PACKAGE_NAME} --detect_chromedriver_version`);
};

const start = async () => {
    // remove --inspect before starting chromedriver
    process.env.NODE_OPTIONS = '';

    // kill any localhost running chromedriver instance
    await fkill(`:${DRIVER_PORT}`, { silent: true });

    const chromedriver = requireWithFallback(PACKAGE_NAME);
    await chromedriver.start(DEFAULT_DRIVER_ARGS, true);
};

const isReady = async ({ chromeBinaryLocation }) => {
    // 100 tries, every 30ms
    await pRetry(async () => {
        const statusResponse = await httpRequest.get(`${DRIVER_BASE_URL}/status`);
        if (!statusResponse || !statusResponse.value || !statusResponse.value.ready) {
            throw new Error('status failed');
        }

        const chromeOptions = {};
        if (chromeBinaryLocation) {
            chromeOptions.binary = chromeBinaryLocation;
        }
        const sessionResponse = await httpRequest.post({
            url: `${DRIVER_BASE_URL}/session`,
            body: { desiredCapabilities: { browserName: 'chrome', chromeOptions } },
            headers: { 'Content-Type': 'application/json' },
        });
        if (!sessionResponse || sessionResponse.status !== 0 || !sessionResponse.sessionId) {
            throw new Error('create session failed');
        }
        await httpRequest.delete(`${DRIVER_BASE_URL}/session/${sessionResponse.sessionId}`);
    }, { retries: 100, minTimeout: 30 });
};

module.exports = {
    install,
    start,
    isReady,
};

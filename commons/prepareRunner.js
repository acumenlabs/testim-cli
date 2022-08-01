// @ts-check

const { CLI_MODE } = require('./constants');

// @ts-ignore
const Promise = require('bluebird');
const os = require('os');
const utils = require('../utils');
const Ajv = require('ajv');
const prepareRunnerAndTestimStartUtils = require('./prepareRunnerAndTestimStartUtils');
const mockNetworkRuleFileSchema = require('./mockNetworkRuleFileSchema.json');
const { initializeUserWithAuth } = require('./initializeUserWithAuth');
const { downloadAndInstallChromium } = require('../chromiumInstaller');

const MAX_RULE_FILE_SIZE_IN_MB = 1;
const PREPARE_MOCK_NETWORK_ERROR_PREFIX = 'JSON file supplied to --mock-network-pattern';

const logger = require('./logger').getLogger('prepare runner');

Promise.resolve().then(() => {
    // @ts-ignore
    global.xhr2 = require('./xhr2'); // this is inside a `then` to not block and let network requests start
});

async function prepare(options) {
    /**
     * @type {Promise}
     */
    let chromedriverPromise = Promise.resolve();

    const hasNoGrid = !options.host && !options.gridId && !options.grid && (!options.testPlan || options.testPlan.length === 0);
    const isTdkRun = options.files.length !== 0;
    if ((hasNoGrid && isTdkRun) || options.useLocalChromeDriver) {
        options.chromeBinaryLocation = options.downloadBrowser ? await downloadAndInstallChromium() : options.chromeBinaryLocation;
        chromedriverPromise = prepareRunnerAndTestimStartUtils.prepareChromeDriver(
            { projectId: options.project, userId: options.user },
            { chromeBinaryLocation: options.chromeBinaryLocation },
            Boolean(options.lightweightMode && options.lightweightMode.general)
        );
        options.useLocalChromeDriver = true;
    }

    if (!options.playerRequirePath && options.mode !== CLI_MODE.EXTENSION) {
        await prepareRunnerAndTestimStartUtils.preparePlayer(options.playerLocation, options.canary);
    }
    if (options.mode === CLI_MODE.EXTENSION && !options.ext) {
        await prepareRunnerAndTestimStartUtils.prepareExtension(options.extensionLocation);
    }

    let customExtensionLocation;

    if (options.installCustomExtension) {
        const unlimitedSize = Boolean(options.useLocalChromeDriver || options.useChromeLauncher);
        customExtensionLocation = await prepareRunnerAndTestimStartUtils.prepareCustomExtension(options.installCustomExtension, unlimitedSize);
    }

    await chromedriverPromise;

    return customExtensionLocation;
}

async function prepareMockNetwork(location) {
    logger.info('prepare MockNetwork', { location });
    const rulesJsonBuf = await utils.getSourceAsBuffer(location);
    if (rulesJsonBuf.byteLength > MAX_RULE_FILE_SIZE_IN_MB * 1000000) {
        throw new Error(`${PREPARE_MOCK_NETWORK_ERROR_PREFIX} exceeded ${MAX_RULE_FILE_SIZE_IN_MB}MB`);
    }

    let rulesJson;
    try {
        rulesJson = JSON.parse(rulesJsonBuf);
    } catch (error) {
        throw new Error(`${PREPARE_MOCK_NETWORK_ERROR_PREFIX} cannot be parsed.${os.EOL}${error}`);
    }

    const ajv = new Ajv();
    const valid = ajv.validate(mockNetworkRuleFileSchema, rulesJson);
    if (!valid) {
        const errors = ajv.errors.map((e, i) => `${++i}) ${e.dataPath} ${e.message}`).join(os.EOL);
        throw new Error(`${PREPARE_MOCK_NETWORK_ERROR_PREFIX} is malformed.${os.EOL}${errors}`);
    }

    return rulesJson.entries;
}

module.exports = {
    prepare,
    prepareMockNetwork,
    initializeUserWithAuth,
};

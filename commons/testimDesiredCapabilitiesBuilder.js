/* eslint-disable camelcase */

'use strict';

const crypto = require('crypto');
const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const featureFlags = require('./featureFlags');
const { CLI_MODE, mobileWeb, gridTypes } = require('./constants');
const config = require('./config');
const utils = require('../utils');
const LambdatestService = require('../services/lambdatestService');
const logger = require('./logger').getLogger('testim-desired-capabilities-builder');

const LOG_LEVEL = config.WEBDRIVER_DEBUG ? 'verbose' : 'silent';
const CONTENT_SETTING = {
    CONTENT_SETTING_DEFAULT: 0,
    CONTENT_SETTING_ALLOW: 1,
    CONTENT_SETTING_BLOCK: 2,
    CONTENT_SETTING_ASK: 3,
};
const DEFAULT_CHROME_OPTIONS_ARGS = [
    '--disable-popup-blocking',
    '--ignore-gpu-blacklist',
    '--auto-select-desktop-capture-source=Entire screen',
    '--ignore-certificate-errors',
    // Disable built-in Google Translate service
    '--disable-features=TranslateUI',
    // Disable various background network services, including extension updating,
    // safe browsing service, upgrade detector, translate, UMA
    '--disable-background-networking',
    // Disable syncing to a Google account
    '--disable-sync',
    // Disable reporting to UMA, but allows for collection
    '--metrics-recording-only',
    // Disable installation of default apps on first run
    '--disable-default-apps',
    // Mute any audio
    '--mute-audio',
    // Skip first run wizards
    '--no-first-run',
];

const getHash = (...str) => crypto.createHash('sha256').update(str.join('')).digest('hex');

const isDFGrid = (gridInfo) => gridInfo.type === gridTypes.DEVICE_FARM || (gridInfo.type === gridTypes.HYBRID && gridInfo.provider === 'devicefarm');

const convertToNewCapabilitiesFormat = (desiredCapabilities) => {
    if (desiredCapabilities.hasOwnProperty('version')) {
        desiredCapabilities.browserVersion = desiredCapabilities.version;
        delete desiredCapabilities.version;
    }
    if (desiredCapabilities.hasOwnProperty('platform')) {
        desiredCapabilities.platformName = desiredCapabilities.platform;
        delete desiredCapabilities.platform;
    }
    if (desiredCapabilities.hasOwnProperty('acceptSslCerts')) {
        desiredCapabilities.acceptInsecurecerts = desiredCapabilities.acceptSslCerts;
        delete desiredCapabilities.acceptSslCerts;
    }
    if (desiredCapabilities.hasOwnProperty('unexpectedAlertBehaviour')) {
        desiredCapabilities.unhandledPromptBehavior = desiredCapabilities.unexpectedAlertBehaviour;
        delete desiredCapabilities.unexpectedAlertBehaviour;
    }
};

function buildEdgeOptions(opts) {
    Object.assign(opts.desiredCapabilities, {
        browserName: 'MicrosoftEdge',
        _isOldEdge: true,
    });

    return opts;
}

function buildSafariOptions(opts, browserName) {
    const safariOptions = { browserName: 'safari' };

    if (browserName === 'safari technology preview') {
        safariOptions['safari.options'] = { technologyPreview: true };
    }

    Object.assign(opts.desiredCapabilities, safariOptions);
    return opts;
}

function buildIEOptions(opts, browserOptions, gridInfo, lambdatestService) {
    const ieOptions = {
        ignoreProtectedModeSettings: true,
        'ie.ensureCleanSession': true,
        'ie.enableFullPageScreenshot': false,
        'ie.fileUploadDialogTimeout': 3000,
        'ie.acceptSslCerts': true,
    };

    let version = '11';
    if (isDFGrid(gridInfo)) {
        version = 'latest';
    }

    Object.assign(opts.desiredCapabilities, {
        browserName: 'internet explorer',
        version,
        pageLoadStrategy: 'none',
    });

    const isLambdatestRun = lambdatestService && lambdatestService.isLambdatestRun();
    if (isLambdatestRun) {
        opts.desiredCapabilities.ignoreProtectedModeSettings = true; // this might be the correct way to do it for all grids
    }

    if (browserOptions.oldCapabilities && !isLambdatestRun) {
        Object.assign(opts.desiredCapabilities, ieOptions);
    }

    if (browserOptions.w3cCapabilities) {
        opts.desiredCapabilities['se:ieOptions'] = ieOptions;
    }

    return opts;
}

function readFileToBase64(fileLocation) {
    return fs.readFileSync(fileLocation, { encoding: 'base64' });
}

function setCustomExtension(customExtensionLocalLocation, extensions, lambdatestService) {
    if (lambdatestService && lambdatestService.isLambdatestRun() && utils.isURL(customExtensionLocalLocation)) {
        return;
    }

    if (customExtensionLocalLocation) {
        const extStr = readFileToBase64(customExtensionLocalLocation);
        // for debugging purpose should be removed in the future
        logger.info(`adding extension: custom, path: ${customExtensionLocalLocation} length: ${extStr.length} hash: ${getHash(extStr)} current extension count: ${extensions.length}`);
        extensions.push(extStr);
    }
}

function setTestimExtension(browserOptions, extensions, args, predefinedTestimExtension, lambdatestService) {
    if (lambdatestService && lambdatestService.isLambdatestRun()) {
        return;
    }

    if (browserOptions.ext || predefinedTestimExtension) {
        const extFromOptions = typeof (browserOptions.ext) === 'string' ? browserOptions.ext : (`${__dirname}/..`);
        const ext = predefinedTestimExtension || extFromOptions;
        const loadExt = `--load-extension=${ext}`;
        logger.info(`adding extension: testim unpacked , path: ${ext}`);
        args.push(loadExt);
        return;
    }

    const zipFileSuffix = browserOptions.canary ? '-master.zip' : '.zip';
    const filePath = path.join(process.cwd(), `testim-headless${zipFileSuffix}`);
    const extStr = readFileToBase64(filePath);
    // for debugging purpose should be removed in the future
    logger.info(`adding extension: testim zipped, path: ${filePath} length: ${extStr.length} hash: ${getHash(extStr)} current extension count: ${extensions.length}`);
    extensions.push(extStr);
}

function _buildChromiumOptions(opts, browserOptions, testRunConfig, customExtensionLocalLocation, gridInfo, predefinedTestimExtension, lambdatestService) {
    // * Make sure to add any referenced attributes of the function arguments to the hash created in buildChromiumOptions * //

    const browserName = testRunConfig.seleniumName || testRunConfig.browserValue;
    const extensions = [];
    const args = [...DEFAULT_CHROME_OPTIONS_ARGS];
    if (browserOptions.headless) {
        args.push('--headless');
    }
    //sauce labs issues - if you set w3c = true sauce search the data in capabilities instead of desiredCapabilities
    const isW3CMode = () => browserOptions.mode !== CLI_MODE.EXTENSION;
    const chromiumOptions = {
        prefs: {
            'profile.default_content_setting_values.popups': CONTENT_SETTING.CONTENT_SETTING_ALLOW,
            // allow multiple download files
            'profile.default_content_setting_values.automatic_downloads': CONTENT_SETTING.CONTENT_SETTING_ALLOW,
            // disable pdf viewer
            'plugins.always_open_pdf_externally': true,
            // unintuitively stops download protection ("Dangerous file blocked")
            // if needed in the future, consider adding --safebrowsing-disable-download-protection or --safebrowsing-disable-extension-blacklist to the chrome flags
            'safebrowsing.enabled': true,
            'profile.content_settings.exceptions.clipboard': {
                '[*.],*': { last_modified: Date.now(), setting: 1 },
            },
            'download.allow_office_viewer_for_download': false,
        },
        w3c: isW3CMode(),
    };

    if (isDFGrid(gridInfo)) {
        chromiumOptions.prefs['download.default_directory'] = 'C:\\Users\\testnode';
        chromiumOptions.w3c = true;
        opts.desiredCapabilities.version = 'latest-1';
        opts.desiredCapabilities['aws:maxDurationSecs'] = 2400; // Maximum duration of the session before it is forcibly closed, in seconds. Range: 180 to 2400.
        opts.desiredCapabilities['aws:idleTimeoutSecs'] = 60; // Maximum delay between WebDriver commands before the session is forcibly closed. Range: 30 to 900.
    }

    if (isDFGrid(gridInfo) && browserName === 'MicrosoftEdge') {
        opts.desiredCapabilities['ms:edgeChromium'] = true;
    }

    if (browserOptions.chromeExtraPrefs) {
        Object.assign(chromiumOptions.prefs, browserOptions.chromeExtraPrefs);
    }

    if (browserOptions.chromeExtraArgs) {
        browserOptions.chromeExtraArgs.forEach(arg => args.push(`--${arg}`));
    }

    if (browserOptions.chromeBlockLocation) {
        chromiumOptions.prefs['profile.default_content_setting_values.geolocation'] = CONTENT_SETTING.CONTENT_SETTING_BLOCK;
    }

    if (browserOptions.chromeUserDataDir) {
        args.push(`--user-data-dir=${browserOptions.chromeUserDataDir}`);
    }

    if (browserOptions.projectData && browserOptions.projectData.defaults && browserOptions.projectData.defaults.disableChromiumGpu) {
        args.push('--disable-gpu');
    }

    Object.assign(opts.desiredCapabilities, { browserName });

    function setMobileEmulationSettings() {
        if (testRunConfig.mobileEmulation) {
            chromiumOptions.mobileEmulation = {
                deviceMetrics: {
                    width: testRunConfig.mobileEmulation.device.width,
                    height: testRunConfig.mobileEmulation.device.height + mobileWeb.MOBILE_WEB_REMOTE_RUN_HEADER_SPACING,
                    pixelRatio: testRunConfig.mobileEmulation.device.deviceScaleFactor,
                },
                userAgent: testRunConfig.mobileEmulation.userAgent,
            };
        }
    }

    setMobileEmulationSettings();

    setCustomExtension(customExtensionLocalLocation, extensions, lambdatestService);
    if (browserOptions.mode === CLI_MODE.EXTENSION) {
        setTestimExtension(browserOptions, extensions, args, predefinedTestimExtension, lambdatestService);
    }
    if (extensions.length > 0) {
        chromiumOptions.extensions = extensions;
    }

    if (browserOptions.disableCookiesSameSiteNoneRequiresSecure) {
        chromiumOptions.localState = {
            'browser.enabled_labs_experiments': [
                'cookies-without-same-site-must-be-secure@2',
            ],
        };
    }

    chromiumOptions.args = args;
    const optionsKey = { MicrosoftEdge: 'edgeOptions', chrome: 'chromeOptions' }[browserName];
    const vendor = { MicrosoftEdge: 'ms', chrome: 'goog' }[browserName];

    if (LambdatestService.isLambdatestGrid(gridInfo)) {
        delete chromiumOptions.w3c;
    }

    if (browserOptions.oldCapabilities && gridInfo.type !== 'testimEnterprise' && !(lambdatestService && lambdatestService.isLambdatestRun())) {
        opts.desiredCapabilities[optionsKey] = chromiumOptions;
    }

    if (browserOptions.w3cCapabilities || gridInfo.type === 'testimEnterprise') {
        opts.desiredCapabilities[`${vendor}:${optionsKey}`] = chromiumOptions;
    }

    return opts;
}

const buildChromiumOptions = _.memoize(_buildChromiumOptions, (opts, browserOptions, testRunConfig, customExtensionLocalLocation, gridInfo, predefinedTestimExtension) => {
    // Only hash the attributes which are used in _buildChromiumOptions, some others (which are irrelevant) change and invalidate the hash
    const stringOptsDesiredCapabilities = JSON.stringify(opts.desiredCapabilities);
    const stringBrowserOptions = JSON.stringify(_.omit(browserOptions, 'runParams'));
    const stringTestRunConfig = JSON.stringify(testRunConfig);
    const stringGridInfoType = JSON.stringify(gridInfo.type);
    return getHash(stringOptsDesiredCapabilities, stringBrowserOptions, stringTestRunConfig, customExtensionLocalLocation, stringGridInfoType, predefinedTestimExtension);
});


// list of content type that Firefox browser will not open the download popup and start the download automaticlly into Downloads folder
const FIREFOX_FILE_NEVER_ASK = [
    'application/force-download',
    'application/pdf',
    'application/x-pdf',
    'application/acrobat',
    'applications/vnd.pdf',
    'text/pdf',
    'text/x-pdf',
    'application/vnd.cups-pdf',
];

function buildFirefoxOptions(opts, browserOptions) {
    const fireFoxPrefs = {
        'pdfjs.disabled': true, //disable pdf viewer. Otherwise, the pdf viewer takes over when we download a pdf.
    };

    if (featureFlags.flags.autoSaveDownloadFileFireFox.isEnabled()) {
        Object.assign(fireFoxPrefs, {
            'browser.helperApps.neverAsk.saveToDisk': FIREFOX_FILE_NEVER_ASK.join(','),
            'browser.helperApps.neverAsk.openFile': FIREFOX_FILE_NEVER_ASK.join(','),
            'browser.helperApps.alwaysAsk.force': false,
            'browser.download.manager.useWindow': false, // A boolean value indicating whether or not to use the Downloads window (true) or display download status in the status bar (false) in the browser window.
            'browser.download.manager.focusWhenStarting': false, // A boolean value that indicates whether or not to focus the Download Manager window when a download begins.
            'browser.download.manager.alertOnEXEOpen': false, // A boolean value that indicates whether the UI Should alert the user about the dangers of opening (executing) an EXE. The user may check a "don't ask" box on the UI to toggle this.
            'browser.download.manager.showWhenStarting': false, // A boolean value that indicates whether or not to show the Downloads window when a download begins.
            'browser.download.manager.closeWhenDone': true, // As boolean value indicating whether or not the Downloads window should close automatically when downloads are completed.
            'browser.download.manager.showAlertOnComplete': false, // A boolean value that indicates whether or not an alert should be shown when downloads complete.
        });
    }

    Object.assign(opts.desiredCapabilities, {
        acceptInsecureCerts: true,
        browserName: 'firefox',
        marionette: true,
        'moz:firefoxOptions': {
            prefs: fireFoxPrefs,
        },
    });

    if (browserOptions.disableCookiesSameSiteNoneRequiresSecure) {
        opts.desiredCapabilities['moz:firefoxOptions'].prefs['network.cookie.sameSite.noneRequiresSecure'] = false;
    }

    if (browserOptions.mode === CLI_MODE.EXTENSION) {
        if (browserOptions.ext) {
            opts.desiredCapabilities.testim_firefox_profile = browserOptions.ext;
        } else {
            const zipFileSuffix = browserOptions.canary ? '-master.zip' : '.zip';
            const filePath = path.join(process.cwd(), `testim-firefox-profile${zipFileSuffix}`);
            opts.desiredCapabilities.firefox_profile = readFileToBase64(filePath);
        }
    }


    // more interesting options
    // https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Headless_mode#Debugging_headless_Firefox
    if (browserOptions.headless) {
        if (!opts.desiredCapabilities['moz:firefoxOptions'].args) {
            opts.desiredCapabilities['moz:firefoxOptions'].args = [];
        }
        opts.desiredCapabilities['moz:firefoxOptions'].args.push('-headless');
    }

    return opts;
}

function buildSaucelabs(browserOptions, testName, testRunConfig) {
    if (browserOptions.saucelabs && browserOptions.saucelabs.username && browserOptions.saucelabs.accessKey) {
        if (testRunConfig) {
            testRunConfig.sl.version = testRunConfig.browserValue === 'safari' ? testRunConfig.sl.safari_version : testRunConfig.sl.version;
            testRunConfig.sl.appiumVersion = browserOptions.saucelabs.appiumVersion || testRunConfig.sl.appiumVersion;
            return Object.assign({}, testRunConfig.sl, browserOptions.saucelabs, { name: testName });
        }
        return Object.assign({}, browserOptions.saucelabs, { name: testName });
    }
    return {};
}

function buildBrowserstack(browserOptions, testName, testRunConfig) {
    if (!_.isEmpty(browserOptions.browserstack)) {
        if (testRunConfig) {
            testRunConfig.bs.browser_version = testRunConfig.browserValue === 'safari' ? testRunConfig.bs.safari_version : testRunConfig.bs.browser_version;
            if (testRunConfig.browserValue === 'safari' && testRunConfig.bs.safari_version === '10') {
                Object.assign(testRunConfig.bs, { 'safari.options': { technologyPreview: true } });
            }
            return Object.assign({}, testRunConfig.bs, browserOptions.browserstack, { name: testName });
        }
        return Object.assign({}, browserOptions.browserstack, { name: testName });
    }
    return {};
}

function buildPerfecto(browserOptions) {
    if (browserOptions.perfecto) {
        return browserOptions.perfecto;
    }
    return {};
}

function buildExperitest(browserOptions, browser, sessionTimeoutSec) {
    if (browserOptions.experitestToken) {
        const isSafari = browser === 'safari';
        return {
            accessKey: browserOptions.experitestToken,
            browserVersion: 'latest',
            platformName: isSafari ? 'MAC' : 'WIN10',
            //Workaround to Experitest bug in take screenshot in Safari browser
            seleniumScreenshot: isSafari,
            newSessionWaitTimeout: sessionTimeoutSec,
        };
    }

    return {};
}

function buildHeaders(browserOptions, gridInfo = {}) {
    const { gridData = {}, gridUsername, gridPassword } = browserOptions;
    const username = gridUsername || gridData.user || gridInfo.user;
    const password = gridPassword || gridData.key || gridInfo.key;

    const headers = {};
    if (username && password) {
        headers.Authorization = utils.buildBasicHeader(username, password);
    }

    return headers;
}

function buildSeleniumOptions(browserOptions, testName, testRunConfig, gridInfo, customExtensionLocalLocation, executionId, testResultId, lambdatestService = null) {
    if (gridInfo.mode === 'local') {
        const extensions = [];
        const args = [...DEFAULT_CHROME_OPTIONS_ARGS];
        const binaryLocation = {};

        if (browserOptions.headless) {
            args.push('--headless');
        }

        if (browserOptions.silentDebuggerExtensionApi) {
            args.push('--silent-debugger-extension-api');
        }

        if (browserOptions.remoteDebuggingPort !== undefined) {
            args.push(`--remote-debugging-port=${browserOptions.remoteDebuggingPort}`);
        }

        if (browserOptions.chromeExtraArgs) {
            browserOptions.chromeExtraArgs.forEach(arg => args.push(`--${arg}`));
        }

        if (browserOptions.chromeBinaryLocation) {
            binaryLocation.binary = browserOptions.chromeBinaryLocation;
        }

        if (browserOptions.mode !== 'selenium') {
            setTestimExtension(browserOptions, extensions, args, null, lambdatestService);
        }
        setCustomExtension(customExtensionLocalLocation, extensions, lambdatestService);

        return {
            logLevel: LOG_LEVEL,
            desiredCapabilities: {
                chromeOptions: {
                    args,
                    extensions,
                    ...binaryLocation,
                },
                browserName: 'chrome',
            },
            host: 'localhost',
            port: 9515, // default chromedriver port
        };
    }

    const { driverRequestTimeout, driverRequestRetries } = browserOptions;
    let opts = {
        host: gridInfo.host,
        port: gridInfo.port || 4444,
        path: gridInfo.path || '/wd/hub',
        protocol: gridInfo.protocol || 'http',
        logLevel: LOG_LEVEL,
        connectionRetryTimeout: driverRequestTimeout,
        connectionRetryCount: driverRequestRetries,
        getSessionTimeout: Math.max(lambdatestService.getSessionTimeout, browserOptions.getSessionTimeout),
        getSessionRetries: lambdatestService.getSessionRetries || browserOptions.getSessionRetries,
        deprecationWarnings: false,
        desiredCapabilities: {
            javascriptEnabled: true,
            locationContextEnabled: true,
            handlesAlerts: true,
            rotatable: true,
            acceptSslCerts: true,
            unexpectedAlertBehaviour: 'accept', // What the browser should do with an unhandled alert before throwing out the UnhandledAlertException - automatically click on accept
            nativeEvents: true,
            testName,
        },
    };

    const headers = buildHeaders(browserOptions, gridInfo);
    if (!_.isEmpty(headers)) {
        opts.headers = headers;
    }

    if (isDFGrid(gridInfo)) {
        browserOptions.oldCapabilities = false;
        browserOptions.w3cCapabilities = true;
        opts.desiredCapabilities = {
            unexpectedAlertBehaviour: 'accept',
        };
    }

    if (browserOptions.proxyForGrid) {
        opts.agent = new global.ProxyAgent(global.proxyUri);
    }

    if (browserOptions.disableNativeEvents) {
        opts.desiredCapabilities.nativeEvents = false;
    }

    if (gridInfo.user && gridInfo.key) {
        if (gridInfo.type === 'saucelabs') {
            browserOptions.saucelabs = browserOptions.saucelabs || {};
            browserOptions.saucelabs.username = browserOptions.saucelabs.username || gridInfo.user;
            browserOptions.saucelabs.accessKey = browserOptions.saucelabs.accessKey || gridInfo.key;
        }

        if (gridInfo.type === 'browserstack') {
            browserOptions.browserstack = browserOptions.browserstack || {};
            browserOptions.browserstack['browserstack.user'] = browserOptions.browserstack['browserstack.user'] || gridInfo.user;
            browserOptions.browserstack['browserstack.key'] = browserOptions.browserstack['browserstack.key'] || gridInfo.key;
        }
    }

    if (gridInfo.key && gridInfo.type === 'perfecto') {
        browserOptions.perfecto.securityToken = gridInfo.key;
    }

    const browserTimeoutSec = Number(browserOptions.browserTimeout / 1000);
    const browser = browserOptions.browser || (testRunConfig && testRunConfig.browserValue);


    _.merge(
        opts.desiredCapabilities,
        buildSaucelabs(browserOptions, testName, testRunConfig),
        buildBrowserstack(browserOptions, testName, testRunConfig),
        buildPerfecto(browserOptions, testName, testRunConfig),
        buildExperitest(browserOptions, browser, browserTimeoutSec),
        lambdatestService && lambdatestService.getCapabilities(browserOptions, browser, executionId, testResultId, testName),
    );

    let predefinedTestimExtension = null;
    if (!browserOptions.ext && !browserOptions.extensionPath && _.endsWith(gridInfo.host, '.testim.io') && !browserOptions.canary && browserOptions.mode === CLI_MODE.EXTENSION) {
        if (browser === 'chrome') {
            predefinedTestimExtension = '/opt/testim-headless';
        } else if (browser === 'edge-chromium') {
            predefinedTestimExtension = 'C:/selenium/testim-headless';
        }
    }

    if (_.endsWith(gridInfo.host, '.testim.io') && browser === 'edge-chromium') {
        opts.desiredCapabilities.version = '83'; // Need to match GGR filter
    }

    switch (browser) {
        case 'chrome':
        case 'edge-chromium':
            opts = buildChromiumOptions(opts, browserOptions, testRunConfig, customExtensionLocalLocation, gridInfo, predefinedTestimExtension, lambdatestService);
            break;
        case 'firefox':
            opts = buildFirefoxOptions(opts, browserOptions);
            break;
        case 'edge':
            opts = buildEdgeOptions(opts);
            break;
        case 'safari':
        case 'safari technology preview':
            opts = buildSafariOptions(opts, browser);
            break;
        case 'ie11':
            opts = buildIEOptions(opts, browserOptions, gridInfo, lambdatestService);
            break;
        default:
            break;
    }

    _.merge(opts.desiredCapabilities, browserOptions.seleniumCapsFileContent);

    try {
        /**
         * Targeted custom capabilities can be added to the desired capabilities object via the addCustomCapabilities FF.
         * No targeting: { selenium_version: '3.141.59' }
         * One level targeting (either grid provider, host, browser name or browser version): { "devicefarm": { selenium_version: '3.141.59' } }
         * Two level targeting: { "internet explorer": { "11": { selenium_version: '3.141.59' } } }
         */
        const hostToProvider = { 'hub.lambdatest.com': 'lambdatest', 'public-grid.testim.io': 'testim', 'testgrid-devicefarm.us-west-2.amazonaws.com': 'devicefarm' };
        const byGrid = (capabilities) => capabilities[gridInfo.provider] || capabilities[opts.host] || capabilities[hostToProvider[opts.host]];
        const getTargetingGroup = (capabilities) => byGrid(capabilities) || capabilities[opts.desiredCapabilities.browserName] || capabilities[opts.desiredCapabilities.version] || capabilities || {};
        const capabilities = JSON.parse(featureFlags.flags.addCustomCapabilities.getValue() || '{}');
        const customCapabilities = getTargetingGroup(getTargetingGroup(capabilities));

        if (Object.keys(customCapabilities).length) {
            logger.info(`Adding custom capabilities: ${JSON.stringify(customCapabilities)}`);
            Object.assign(opts.desiredCapabilities, customCapabilities);
        }
    } catch (e) {
        logger.error(`Failed to load custom capabilities: ${e.message}`, { customCapabilities: featureFlags.flags.addCustomCapabilities.getValue() });
    }

    if (isDFGrid(gridInfo) && opts.desiredCapabilities && !opts.capabilities) {
        convertToNewCapabilitiesFormat(opts.desiredCapabilities);
        opts.capabilities = { alwaysMatch: opts.desiredCapabilities, firstMatch: [{}] };
        delete opts.desiredCapabilities;
    }

    return opts;
}

module.exports = {
    buildSeleniumOptions,
};

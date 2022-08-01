/* eslint-disable camelcase */
// @ts-check

'use strict';

const path = require('path');
const fs = require('fs-extra');
const ms = require('ms');
const WebSocket = require('ws');
const Bluebird = require('bluebird');
const ChromeLauncher = require('chrome-launcher');
const config = require('./commons/config');
const { ArgError } = require('./errors');
const lazyRequire = require('./commons/lazyRequire');
const prepareUtils = require('./commons/prepareRunnerAndTestimStartUtils');
const { downloadAndSave, unzipFile, getCdpAddressForHost, TESTIM_BROWSER_DIR } = require('./utils');
const ora = require('ora');
const { downloadAndInstallChromium, CHROMIUM_VERSION } = require('./chromiumInstaller');


const LOG_LEVEL = config.WEBDRIVER_DEBUG ? 'verbose' : 'silent';
const EXTENSION_CACHE_TIME = ms('1h');
const USER_DATA_DIR = path.join(TESTIM_BROWSER_DIR, 'profile');

// https://github.com/bayandin/chromedriver/blob/5013f2124888c50fff15dc2ff8287288f780b046/chrome_launcher.cc#L105
const CHOMEDRIVER_DEVTOOLS_ACTIVE_PORT_FILENAME = 'DevToolsActivePort';
const CHOMEDRIVER_DEVTOOLS_ACTIVE_PORT_FILE_PATH = path.join(USER_DATA_DIR, CHOMEDRIVER_DEVTOOLS_ACTIVE_PORT_FILENAME);

module.exports = {
    shouldStartAgentMode,
    runAgentMode,
    getStartedWithStart,
};

/**
 * @param {{ agentMode: boolean; }} options
 */
function shouldStartAgentMode(options) {
    return options.agentMode;
}

/**
 *
 * @param {*} options
 */
async function runAgentMode(options) {
    let testimStandaloneBrowser;

    await prepareUtils.preparePlayer(options.playerLocation, options.canary);

    if (options.startTestimBrowser) {
        await getRidOfPossiblyRunningChromeWithOurDataDir();
        try {
            // Consider moving that into the agent server and add endpoint to start browser?
            testimStandaloneBrowser = await startTestimStandaloneBrowser(options);
        } catch (e) {
            if (e && e.message && e.message.includes('user data directory is already in use')) {
                throw new ArgError('Please close all chrome browsers that were opened with "testim start" and try again');
            }
            throw e;
        }
    }

    const agentServer = require('./agent/server');

    if (testimStandaloneBrowser && testimStandaloneBrowser.webdriverApi) {
        // if we're starting the agent here, pre-load the sessionPlayer so it loads faster
        // on first play
        const LOAD_PLAYER_DELAY = 6000;
        setTimeout(async () => {
            setTimeout(() => require('./player/seleniumTestPlayer'));

            const packages = [
                'webpack',
                // We may build/static analyze functions file to do it here
                // silent full-blown build will require additional work,
                // But actually can be valuable as general speedup if we cache the webpack instance
                // "puppeteer",
                // "selenium-webdriver"
                // "playwright"
            ];

            for (const packageToInstall of packages) {
                await lazyRequire(packageToInstall, { silent: true }).catch(() => { });
            }
        }, LOAD_PLAYER_DELAY);
    }

    return agentServer.init(
        options,
        // @ts-ignore
        testimStandaloneBrowser
    );
}

async function hackForCoralogixAndXhr() {
    Promise.resolve().then(() => {
        // @ts-ignore
        global.xhr2 = require('./commons/xhr2'); // this is inside a `then` to not block and let network requests start
    });

    // this gets picked up later in sessionPlayerInit
}

let startedWithStart = false;

function getStartedWithStart() {
    return startedWithStart;
}

function isPidRunning(pid) {
    try {
        return process.kill(pid, 0);
    } catch {
        return false;
    }
}

async function startFixedVersionChromium(options, extensionBase64, downloadedExtensionPathUnzipped) {
    const CHROMIUM_PROCESS_INFO_FILE = path.join(TESTIM_BROWSER_DIR, `chrome-${CHROMIUM_VERSION}-process`);
    const CHECK_CHROMIUM_RUNNING_INTERVAL = 3000;

    const onBrowserClosed = () => {
        fs.removeSync(CHROMIUM_PROCESS_INFO_FILE);
        // eslint-disable-next-line no-console
        console.log('\n\nBrowser session ended');
        process.exit(0);
    };


    if (fs.existsSync(CHROMIUM_PROCESS_INFO_FILE)) {
        const processInfo = fs.readJSONSync(CHROMIUM_PROCESS_INFO_FILE);
        if (isPidRunning(processInfo.pid)) { // if a previous instance of our browser is still running, use it and exit if it does
            const monitorPidForExit = () => (isPidRunning(processInfo.pid) ? setTimeout(monitorPidForExit, CHECK_CHROMIUM_RUNNING_INTERVAL) : onBrowserClosed());
            monitorPidForExit();
            return {
                webdriverApi: processInfo,
            };
        }
    }
    const chromeBinary = await downloadAndInstallChromium();

    if (!(await fs.pathExists(USER_DATA_DIR))) {
        await fs.mkdirp(USER_DATA_DIR);
    }
    const capabilities = buildSeleniumOptions(USER_DATA_DIR, extensionBase64, downloadedExtensionPathUnzipped, chromeBinary);
    const chromeFlags = [
        ...capabilities.desiredCapabilities.chromeOptions.args,
        ...ChromeLauncher.Launcher.defaultFlags().filter(flag => ![
            '--disable-extensions',
            '--disable-component-extensions-with-background-pages', // causes google connect to disallow some accounts (eg gmail accounts get a "This browser or app may not be secure" error)
        ].includes(flag)),
    ];
    // Chromium needs API keys to communicate with google APIs (https://www.chromium.org/developers/how-tos/api-keys/)
    // These are keys are keys that were included in some chrome builds
    const envVars = {
        GOOGLE_API_KEY: 'AIzaSyCkfPOPZXDKNn8hhgu3JrA62wIgC93d44k',
        GOOGLE_DEFAULT_CLIENT_ID: '811574891467.apps.googleusercontent.com',
        GOOGLE_DEFAULT_CLIENT_SECRET: 'kdloedMFGdGla2P1zacGjAQh',
    };
    const appUrl = `${options.extensionPath ? 'http://localhost:3000/app/' : 'https://app.testim.io'}?startMode=true`;
    const chrome = await ChromeLauncher.launch({ chromeFlags, startingUrl: appUrl, ignoreDefaultFlags: true, userDataDir: USER_DATA_DIR, chromePath: chromeBinary, envVars });
    const processInfo = { port: chrome.port, pid: chrome.pid, cdpUrl: await getCdpAddressForHost(`localhost:${chrome.port}`) };
    fs.writeJSONSync(CHROMIUM_PROCESS_INFO_FILE, processInfo);
    chrome.process.once('exit', onBrowserClosed);
    chrome.process.once('close', onBrowserClosed);
    return {
        webdriverApi: processInfo,
    };
}

async function startTestimStandaloneBrowser(options) {
    // After next clickim release we will have also testim-full.zip
    // const fullExtensionUrl = "https://testimstatic.blob.core.windows.net/extension/testim-full-master.zip";
    // CDN url
    const fullExtensionUrl = `${config.EDGE_URL}/extension/testim-full-master.zip`;
    const extensionFilename = path.basename(fullExtensionUrl);

    const downloadedExtensionPath = path.join(TESTIM_BROWSER_DIR, extensionFilename);
    const downloadedExtensionPathUnzipped = path.join(TESTIM_BROWSER_DIR, `${extensionFilename}__unzipped__`);

    let shouldDownloadExtension = !(options.ext || options.extensionPath);

    await hackForCoralogixAndXhr();
    if (shouldDownloadExtension && await fs.pathExists(downloadedExtensionPath)) {
        const stat = await fs.stat(downloadedExtensionPath);
        shouldDownloadExtension = (Date.now() - EXTENSION_CACHE_TIME > stat.mtimeMs);
    }
    await fs.mkdirp(TESTIM_BROWSER_DIR);

    if (shouldDownloadExtension) {
        const spinner = ora('Downloading Testim Editor').start();
        await downloadAndSave(fullExtensionUrl, downloadedExtensionPath);

        try {
            // Ensure the zip is ok
            await unzipFile(downloadedExtensionPath, downloadedExtensionPathUnzipped);
        } catch (e) {
            // The downloaded zip is corrupted, try re download once
            await fs.remove(downloadedExtensionPath);
            await downloadAndSave(fullExtensionUrl, downloadedExtensionPath);
            try {
                await unzipFile(downloadedExtensionPath, downloadedExtensionPathUnzipped);
            } catch (err) {
                // zip is bad again.
                await fs.remove(downloadedExtensionPath);
                spinner.fail('Failed to download Testim Editor');
                throw new Error('Failed to download Testim Editor');
            }
        } finally {
            if (!options.downloadBrowser) {
                await fs.remove(downloadedExtensionPathUnzipped);
            }
        }

        spinner.succeed();
    }

    const extensionBase64 = options.extensionPath ? null : (await fs.readFile(options.ext || downloadedExtensionPath)).toString('base64');
    if (options.downloadBrowser) {
        return await startFixedVersionChromium(options, extensionBase64, downloadedExtensionPathUnzipped);
    }
    await prepareUtils.prepareChromeDriver(
        { projectId: options.project },
        { chromeBinaryLocation: options.chromeBinaryLocations },
    );

    const seleniumOptions = buildSeleniumOptions(USER_DATA_DIR, extensionBase64, options.extensionPath, options.chromeBinaryLocations);

    const WebDriver = require('./player/webdriver');
    const { SeleniumPerfStats } = require('./commons/SeleniumPerfStats');

    const webdriverApi = new WebDriver();
    webdriverApi.seleniumPerfStats = new SeleniumPerfStats();

    // starts chrome via selenium, note this is intentionally initClient and not init to bypass desired capabilities parsing
    const webdriverInitResponse = await webdriverApi.initClient(seleniumOptions);

    // example values from webdriverIntRespons
    // webdriverInitResponse.sessionId
    // webdriverInitResponse.value["goog:chromeOptions"].debuggerAddress
    // webdriverInitResponse.chrome.userDataDir;

    // require user token, so we can't use it for now
    // const { getEditorUrl } = require('./commons/testimServicesApi');

    startedWithStart = true;
    const appUrl = `${options.extensionPath ? 'http://localhost:3000/app/' : 'https://app.testim.io'}?startMode=true`;

    await webdriverApi.url(appUrl);
    // save the initial URL we navigated to so we don't consider it the AuT
    webdriverApi.initialUrl = appUrl;
    try {
        //TODO(Benji) do we want this to be exactly getCdpAddressForHost or should this fail less gracefully indicating the agent did not start correctly?
        webdriverApi.cdpUrl = await getCdpAddressForHost(webdriverInitResponse.value['goog:chromeOptions'].debuggerAddress);
    } catch (e) {
        // ignore error
    }

    return {
        webdriverApi,
    };
}

/**
 * @param {string} userDataDir
 * @param {string} fullExtensionPath
 */
function buildSeleniumOptions(userDataDir, fullExtensionPath, unpackedExtensionPath, chromeBinaryPath) {
    const extensions = fullExtensionPath ? [fullExtensionPath] : [];
    const args = [
        `--user-data-dir=${userDataDir}`, // crashes chromium, re-enable if using chrome
        '--log-level=OFF',
        '--silent-debugger-extension-api',
        '--no-first-run',
    ];
    if (unpackedExtensionPath) {
        args.push(`--load-extension=${unpackedExtensionPath}`);
    }

    return {
        logLevel: LOG_LEVEL,
        desiredCapabilities: {
            chromeOptions: {
                args,
                extensions,
                binary: chromeBinaryPath,
            },
            browserName: 'chrome',
        },
        host: 'localhost',
        port: 9515, // chromedriver port
    };
}

/**
 * Overview of what we do here:
 * we check if CHOMEDRIVER_DEVTOOLS_ACTIVE_PORT_FILE_PATH is exists
 * If we can read the port & CDP url info from that file.
 * If we can read, but we can't send http request to the devtools server we assume it's closed and just delete the file
 * If we can read and send HTTP request, send CDP command of Browser.close to CDP, and delete the file.
 * If any of these fails we assume we couldn't kill the browser, and the user will get the "close the running chromes errors down the line"
 */
async function getRidOfPossiblyRunningChromeWithOurDataDir() {
    if (!await fs.pathExists(CHOMEDRIVER_DEVTOOLS_ACTIVE_PORT_FILE_PATH)) {
        return;
    }

    try {
        const { webSocketDebuggerUrl } = await readAndValidateChromedriverDevToolsActivePortFile();
        await tryToCloseBrowserWithCDPUrl(webSocketDebuggerUrl);
        await fs.unlink(CHOMEDRIVER_DEVTOOLS_ACTIVE_PORT_FILE_PATH);
    } catch (e) {
        // chrome is probably not really running, we are cool
        if (e && e.message === 'unable to connect to devtools http server') {
            await fs.unlink(CHOMEDRIVER_DEVTOOLS_ACTIVE_PORT_FILE_PATH);
        }
    }
}

async function readAndValidateChromedriverDevToolsActivePortFile() {
    /**
     * file content example:

    58938
    /devtools/browser/d4290379-ec08-4d03-a41a-ab9d9d4c36ac

    */

    const fileContent = await fs.readFile(CHOMEDRIVER_DEVTOOLS_ACTIVE_PORT_FILE_PATH, { encoding: 'utf8' });

    const [portLine, browserCDPURLLine] = fileContent.split('\n').map(line => line.trim());

    const port = Number.parseInt(portLine, 10);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('invalid port number');
    }

    if (!browserCDPURLLine.startsWith('/devtools/browser/')) {
        throw new Error('invalid devtools browser url');
    }

    const webSocketDebuggerUrl = await getCdpAddressForHost(`localhost:${port}`, 500);
    // invariant check
    if (!webSocketDebuggerUrl.endsWith(browserCDPURLLine)) {
        throw new Error('invariant webSocketDebuggerUrl miss match');
    }

    return {
        port,
        webSocketDebuggerUrl,
    };
}


/**
 * @param {string | import("url").URL} webSocketDebuggerUrl
 * @param {number?} timeout
 */
async function tryToCloseBrowserWithCDPUrl(webSocketDebuggerUrl, timeout = 100) {
    const websocketConnection = await wsConnectAndOpen(webSocketDebuggerUrl, timeout);

    return Bluebird.fromCallback(cb => {
        websocketConnection.send(JSON.stringify({
            id: 0,
            method: 'Browser.close',
        }), cb);
    });
}

/**
 * @param {string | import("url").URL} webSocketDebuggerUrl
 * @param {number?} timeout
 */
async function wsConnectAndOpen(webSocketDebuggerUrl, timeout = 100) {
    const websocket = new WebSocket(webSocketDebuggerUrl, { timeout });

    const openPromise = Bluebird.fromCallback((cb) => {
        websocket.once('open', cb);
    }).then(() => {
        websocket.removeAllListeners();
    });

    const errorPromise = Bluebird.fromCallback((cb) => {
        websocket.once('error', cb);
    }).catch(() => {
        websocket.close();
        websocket.removeAllListeners();
    });

    return Promise.race([openPromise, errorPromise]).then(() => websocket);
}


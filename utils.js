'use strict';

const moment = require('moment');
const pRetry = require('p-retry');
const _ = require('lodash');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const { W3C_ELEMENT_ID } = require('./player/constants');
const { sessionType, testStatus: testStatusConst } = require('./commons/constants');
const path = require('path');
const httpRequest = require('./commons/httpRequest');
const decompress = require('decompress');
const os = require('os');

const HOMEDIR = os.homedir();
const TESTIM_BROWSER_DIR = path.join(HOMEDIR, '.testim-browser-profile');

const OSS = [
    { osName: 'Linux', bs: { os: 'LINUX' }, sl: { platform: 'Linux' } },
    { osName: 'Windows 10', bs: { os: 'WINDOWS', os_version: '10' }, sl: { platform: 'Windows 10' } },
    { osName: 'Windows 8', bs: { os: 'WINDOWS', os_version: '8' }, sl: { platform: 'Windows 8' } },
    { osName: 'Windows 8.1', bs: { os: 'WINDOWS', os_version: '8.1' }, sl: { platform: 'Windows 8.1' } },
    { osName: 'Windows 7', bs: { os: 'WINDOWS', os_version: '7' }, sl: { platform: 'Windows 7' } },
    { osName: 'Windows XP', bs: { os: 'WINDOWS', os_version: 'XP' }, sl: { platform: 'Windows XP' } },
    { osName: 'macOS Big Sur', bs: { os: 'OS X', os_version: 'Big Sur', safari_version: '14' }, sl: { platform: 'macOS 11', safari_version: '14' } },
    { osName: 'macOS Catalina', bs: { os: 'OS X', os_version: 'Catalina', safari_version: '13' }, sl: { platform: 'macOS 10.15', safari_version: '13' } },
    { osName: 'macOS Mojave', bs: { os: 'OS X', os_version: 'Mojave', safari_version: '12' }, sl: { platform: 'macOS 10.14', safari_version: '12' } },
    { osName: 'macOS High Sierra', bs: { os: 'OS X', os_version: 'High Sierra', safari_version: '11' }, sl: { platform: 'macOS 10.13', safari_version: '11' } },
    { osName: 'macOS Sierra', bs: { os: 'OS X', os_version: 'Sierra', safari_version: '10' }, sl: { platform: 'macOS 10.12', safari_version: '10.0' } },
    { osName: 'OS X El Capitan', bs: { os: 'OS X', os_version: 'El Capitan', safari_version: '9.1' }, sl: { platform: 'OS X 10.11', safari_version: '9.0' } },
    { osName: 'OS X Yosemite', bs: { os: 'OS X', os_version: 'Yosemite', safari_version: '8' }, sl: { platform: 'OS X 10.10', safari_version: '8.0' } },
    { osName: 'OS X Mavericks', bs: { os: 'OS X', os_version: 'Mavericks', safari_version: '7.1' }, sl: { platform: 'OS X 10.9', safari_version: '7.0' } },
    { osName: 'OS X Mountain Lion', bs: { os: 'OS X', os_version: 'Mountain Lion', safari_version: '6.2' }, sl: { platform: 'OS X 10.8', safari_version: '6.0' } },
    { osName: 'OS X Lion', bs: { os: 'OS X', os_version: 'Lion', safari_version: '6' }, sl: {} },
    { osName: 'OS X Snow Leopard', bs: { os: 'OS X', os_version: 'Snow Leopard', safari_version: '5.1' }, sl: {} },

    { osName: 'iOS', bs: { platform: 'MAC' }, sl: { platformName: 'iOS', appiumVersion: '1.6.4' } },
    { osName: 'Android', bs: { platform: 'ANDROID' }, sl: { platformName: 'Android', appiumVersion: '1.6.4' } },
];

const BROWSERS = [
    { browserName: 'Chrome', bs: { browser: 'Chrome', browser_version: '94' }, sl: { browserName: 'chrome', version: '94.0' }, browserValue: 'chrome' },
    { browserName: 'Firefox', bs: { browser: 'Firefox', browser_version: '89' }, sl: { browserName: 'firefox', version: '89.0' }, browserValue: 'firefox' },
    { browserName: 'Safari', bs: { browser: 'Safari' }, sl: { browserName: 'safari' }, browserValue: 'safari' },
    { browserName: 'Edge', bs: { browser: 'Edge', browser_version: '18' }, sl: { browserName: 'MicrosoftEdge', version: '18.17763' }, browserValue: 'edge' },
    { browserName: 'Edge Chromium', bs: { browser: 'Edge', browser_version: '94' }, sl: { browserName: 'MicrosoftEdge', version: '94' }, synonyms: ['edge-chromium'], browserValue: 'edge-chromium', seleniumName: 'MicrosoftEdge' },
    { browserName: 'Internet Explorer 11', bs: { browser: 'IE', browser_version: '11' }, sl: { browserName: 'internet explorer', version: '11.0' }, synonyms: ['ie11'], browserValue: 'ie11' },
    { browserName: 'Browser', bs: {}, sl: { browserName: 'Browser' }, browserValue: 'browser' },
    { browserName: 'Android', bs: { browserName: 'android' }, sl: {}, browserValue: 'android' },
    { browserName: 'iPad', bs: { browserName: 'iPad' }, sl: {}, browserValue: 'ipad' },
    { browserName: 'iPhone', bs: { browserName: 'iPhone' }, sl: {}, browserValue: 'iphone' },
];

function getRunConfigByBrowserName(browser, saucelabs, browserstack) {
    browser = browser.toLowerCase();
    const selectedBrowser = BROWSERS.find(b => b.browserName.toLowerCase() === browser || browser.indexOf(b.synonyms) > -1) || BROWSERS[0];

    // BS and SL do not support Linux for newer browser, so use Windows instead.
    let selectedOS = OSS.find(x => x.osName === 'Windows 10');
    if (saucelabs) {
        if (saucelabs.platform) {
            selectedOS = OSS.find(o => o.sl.platform === saucelabs.platform);
        } else if (saucelabs.platformName) {
            selectedOS = OSS.find(o => o.sl.platformName === saucelabs.platformName);
        }
    }
    if (browserstack) {
        if (browserstack.os_version) {
            selectedOS = OSS.find(o => o.bs.os_version === browserstack.os_version);
        } else if (browserstack.platform) {
            selectedOS = OSS.find(o => o.bs.platform === browserstack.platform);
        }
    }

    return _.merge(selectedBrowser, selectedOS);
}

function getTestUrl(editorUrl, projectId, testId, resultId, branch) {
    let testUrl = '';
    branch = branch ? encodeURIComponent(branch) : 'master';
    if (projectId && testId) {
        testUrl = `${editorUrl}/#/project/${projectId}/branch/${branch}/test/${testId}`;
        if (resultId) {
            testUrl += `?result-id=${resultId}`;
        }
    }
    return testUrl;
}

function isPromise(obj) {
    return !!obj && (typeof obj === 'object' || typeof obj === 'function') && typeof obj.then === 'function' && typeof obj.catch === 'function';
}

function getDuration(ms) {
    const duration = moment.duration(ms);
    return `${duration.hours()}:${duration.minutes()}:${duration.seconds()}.${duration.milliseconds()}`;
}

function getDurationSec(ms) {
    return moment.duration(ms).asSeconds();
}

function getRunnerVersion() {
    try {
        const pack = require(`${__dirname}/package.json`);
        return pack.version;
    } catch (err) {
        return '';
    }
}

function getEnginesVersion() {
    try {
        const pack = require(`${__dirname}/package.json`);
        return pack.engines.node;
    } catch (err) {
        return '';
    }
}

async function getEnginesVersionAsync() {
    try {
        const pack = JSON.parse(await fs.readFileAsync(`${__dirname}/package.json`));
        return pack.engines.node;
    } catch (err) {
        return '';
    }
}

function getEnvironmentGitBranch() {
    return process.env.GIT_BRANCH || process.env.CIRCLE_BRANCH || process.env.TRAVIS_BRANCH || process.env.CI_BRANCH;
}

function getUniqBrowsers(options, testList) {
    if ((options.testConfigNames.length || options.testConfigIds.length || options.testPlan.length || options.testPlanIds.length) && !options.browser) {
        return _.uniq(testList.map(t => t.runConfig.browserValue));
    }
    return [options.browser.toLowerCase()];
}

function randomString(length) {
    const a = 'qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM1234567890';
    const index = (Math.random() * (a.length - 1)).toFixed(0);
    return length > 0 ? a[index] + randomString(length - 1) : '';
}

function blueBirdify(fn) {
    return new Promise((resolve, reject) =>
        fn()
            .then(x => resolve(x))
            .catch(y => reject(y)));
}

function removePropertyFromObject(obj, propName, cmpFunction) {
    for (const prop in obj) {
        if (obj.hasOwnProperty(prop)) {
            if (cmpFunction(prop, propName)) {
                delete obj[prop];
            } else if (typeof obj[prop] === 'object') {
                removePropertyFromObject(obj[prop], propName, cmpFunction);
            }
        }
    }
}

function getCliLocation() {
    let cliLocation;
    if (!require.main) { // we're in a REPL
        return process.cwd(); // fall back on the current working directory
    }
    if (require.main.filename.includes('/src') || require.main.filename.includes('\\src') || process.env.IS_UNIT_TEST) {
        cliLocation = path.resolve(__dirname, '../');
    } else {
        cliLocation = __dirname;
    }

    return cliLocation;
}

function buildBasicHeader(userName, password) {
    const userAndPasswordBase64 = Buffer.from(`${userName}:${password}`).toString('base64');
    return `Basic ${userAndPasswordBase64}`;
}

function extractElementId(element) {
    return element.ELEMENT || element[W3C_ELEMENT_ID];
}

function isURL(path) {
    const legacyPattern = /^(https?:\/\/)/i;

    // https://gist.github.com/dperini/729294 (validator.js based on).
    const pattern = new RegExp(
        '^' +
        // protocol identifier (optional)
        // short syntax // still required
        '(?:(?:(?:https?|ftp):)?\\/\\/)' +
        // user:pass BasicAuth (optional)
        '(?:\\S+(?::\\S*)?@)?' +
        '(?:' +
        // IP address exclusion
        // private & local networks
        '(?!(?:10|127)(?:\\.\\d{1,3}){3})' +
        '(?!(?:169\\.254|192\\.168)(?:\\.\\d{1,3}){2})' +
        '(?!172\\.(?:1[6-9]|2\\d|3[0-1])(?:\\.\\d{1,3}){2})' +
        // IP address dotted notation octets
        // excludes loopback network 0.0.0.0
        // excludes reserved space >= 224.0.0.0
        // excludes network & broadcast addresses
        // (first & last IP address of each class)
        '(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])' +
        '(?:\\.(?:1?\\d{1,2}|2[0-4]\\d|25[0-5])){2}' +
        '(?:\\.(?:[1-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))' +
        '|' +
        // host & domain names, may end with dot
        // can be replaced by a shortest alternative
        // (?![-_])(?:[-\\w\\u00a1-\\uffff]{0,63}[^-_]\\.)+
        '(?:' +
        '(?:' +
        '[a-z0-9\\u00a1-\\uffff]' +
        '[a-z0-9\\u00a1-\\uffff_-]{0,62}' +
        ')?' +
        '[a-z0-9\\u00a1-\\uffff]\\.' +
        ')+' +
        // TLD identifier name, may end with dot
        '(?:[a-z\\u00a1-\\uffff]{2,}\\.?)' +
        ')' +
        // port number (optional)
        '(?::\\d{2,5})?' +
        // resource path (optional)
        '(?:[/?#]\\S*)?' +
        '$', 'i'
    );

    return legacyPattern.test(path) || pattern.test(path);
}

const DOWNLOAD_RETRY = 3;
const download = async (url) => pRetry(() => httpRequest.download(url), { retries: DOWNLOAD_RETRY });

const downloadAndSave = async (url, saveToLocation) => {
    const res = await download(url);
    return fs.writeFileAsync(saveToLocation, res.body);
};

const copy = async (readFile, destFile) => new Promise((resolve, reject) => {
    try {
        const file = fs.createWriteStream(destFile);
        fs.createReadStream(readFile).pipe(file);
        file.on('finish', () => {
            file.close(resolve);
        });
    } catch (err) {
        reject(err);
    }
});
function getSourcePath(location, fileName) {
    if (isURL(location)) {
        return fileName || path.join(process.cwd(), location.replace(/^.*[\\\/]/, ''));
    }

    return fileName || path.basename(location);
}

const getSource = async (location, fileName) => {
    const destFile = getSourcePath(location, fileName);
    if (isURL(location)) {
        return downloadAndSave(location, destFile);
    }

    return copy(location, destFile);
};

const getSourceAsBuffer = async (location) => {
    if (isURL(location)) {
        return download(location);
    }
    return fs.readFileAsync(location);
};

const unzipFile = async (srcZipFile, destZipPath) => await decompress(srcZipFile, destZipPath);

const getLocalFileSizeInMB = (fileLocation) => {
    const stats = fs.statSync(fileLocation);
    const fileSizeInBytes = stats.size;
    return fileSizeInBytes / 1000000;
};

function getSessionType(options) {
    return options.files.length > 0 ? sessionType.CODEFUL : sessionType.CODELESS;
}

function getPlanType(plan) {
    plan = plan || {};
    const now = Date.now();
    const expirationDate = plan.expireAt || plan.expireAT;

    if (plan.plan !== 'free') {
        return 'pro';
    }
    if (expirationDate) {
        return expirationDate < now ? 'free' : 'trial';
    }
    return 'free';
}

/**
 * @param time {number} in ms
 * @returns {Promise}
 */
function delay(time) {
    return new Promise(((resolve) => {
        setTimeout(resolve, time);
    }));
}

const calcPercentile = (arr, percentile) => {
    if (arr.length === 0) return 0;
    if (typeof percentile !== 'number') throw new TypeError('p must be a number');

    arr = [...arr].sort((a, b) => a - b);

    if (percentile <= 0) return arr[0];
    if (percentile >= 100) return arr[arr.length - 1];

    const index = Math.ceil(arr.length * (percentile / 100)) - 1;
    return arr[index];
};

const hasTestPlanFlag = (options) => (options.testPlan && options.testPlan.length) || (options.testPlanIds && options.testPlanIds.length);

const isRemoteRun = (options) => options.resultId && options.source === 'remote-run';

const isQuarantineAndNotRemoteRun = (test, options) => test.testStatus === testStatusConst.QUARANTINE && !isRemoteRun(options) && !options.runQuarantinedTests;

function groupTestsByRetries(testResults = []) { // NOTE: This duplicates a function in services (stream-data/result/resultService.js) since we can't share code between packages.
    return _.chain(testResults)
        .groupBy((tr) => tr.originalTestResultId || tr.resultId)
        .values()
        .reduce((all, current) => {
            if (!current) {
                return all;
            }
            if (current.length === 1) {
                all.push(current[0]);
                return all;
            }
            const sorted = _.orderBy(current, (tr) =>
                (typeof tr.retryCount === 'number' ? tr.retryCount : 1)
            );
            const last = _.chain(sorted).last().cloneDeep().value();
            if (!last) {
                return all;
            }
            last.retryTestResults = sorted;
            all.push(last);
            return all;
        }, [])
        .filter(Boolean)
        .value();
}

async function getCdpAddressForHost(browserInstanceHost, timeout) {
    try {
        /**
            Example response:
            {
                "Browser": "Chrome/81.0.4044.138",
                "Protocol-Version": "1.3",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36",
                "V8-Version": "8.1.307.32",
                "WebKit-Version": "537.36 (@8c6c7ba89cc9453625af54f11fd83179e23450fa)",
                "webSocketDebuggerUrl": "ws://localhost:58938/devtools/browser/d4290379-ec08-4d03-a41a-ab9d9d4c36ac"
            }
        */
        const debuggerAddress = await httpRequest.get(`http://${browserInstanceHost}/json/version`, undefined, undefined, timeout);
        return debuggerAddress.webSocketDebuggerUrl;
    } catch (e) {
        throw new Error('unable to connect to devtools server');
    }
}

function getArgsOnRemoteRunFailure() {
    const { argv: args } = process;
    if (!args.includes('--remoteRunId')) {
        return undefined;
    }
    return {
        remoteRunId: args[args.indexOf('--remoteRunId') + 1],
        projectId: args[args.indexOf('--project') + 1],
        token: args[args.indexOf('--token') + 1],
    };
}


module.exports = {
    TESTIM_BROWSER_DIR,
    removePropertyFromObject,
    getTestUrl,
    getDuration,
    getDurationSec,
    getRunnerVersion,
    getEnginesVersion,
    getEnginesVersionAsync,
    isPromise,
    getEnvironmentGitBranch,
    getUniqBrowsers,
    guid: (n = 16) => randomString(n),
    getRunConfigByBrowserName,
    blueBirdify,
    buildBasicHeader,
    extractElementId,
    getCliLocation,
    isURL,
    download,
    downloadAndSave,
    copy,
    unzipFile,
    getLocalFileSizeInMB,
    getSource,
    getSourceAsBuffer,
    getSessionType,
    getSourcePath,
    calcPercentile,
    hasTestPlanFlag,
    isRemoteRun,
    isQuarantineAndNotRemoteRun,
    groupTestsByRetries,
    getPlanType,
    delay,
    getCdpAddressForHost,
    getArgsOnRemoteRunFailure,
};

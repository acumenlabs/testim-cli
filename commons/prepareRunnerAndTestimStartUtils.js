// @ts-check

// @ts-ignore
const Promise = require('bluebird');
const path = require('path');
const os = require('os');
const fs = Promise.promisifyAll(require('fs'));
const ms = require('ms');
const { serializeError } = require('serialize-error');
const { additionalLogDetails } = require('./logUtils');

const config = require('./config');
const { ArgError, NpmPermissionsError } = require('../errors');
const {
    getCliLocation, isURL, downloadAndSave, getSource, getLocalFileSizeInMB, download, unzipFile, getSourcePath,
} = require('../utils');
const localRunnerCache = require('./runnerFileCache');
const logger = require('./logger').getLogger('prepare runner and testim start');

const MSEC_IN_HALF_DAY = ms('0.5 day');
const MAX_CUSTOM_EXT_SIZE_MB = 16;
const MAX_CUSTOM_SIZE_ERROR_MSG = `The size of the custom extension is more than ${MAX_CUSTOM_EXT_SIZE_MB}MB`;

module.exports = {
    prepareChromeDriver,
    prepareCustomExtension,
    prepareExtension,
    getSessionPlayerFolder,
    preparePlayer,
};

/**
 * @param {string} location
 */
function prepareCustomExtension(location, unlimitedSize = false) {
    if (!location) {
        return Promise.resolve();
    }

    if (isURL(location)) {
        const destFile = path.join(process.cwd(), location.replace(/^.*[\\\/]/, ''));
        return getRemoteFileSizeInMB(location)
            .then(contentLength => {
                if (contentLength > MAX_CUSTOM_EXT_SIZE_MB && !unlimitedSize) {
                    return Promise.reject(new ArgError(MAX_CUSTOM_SIZE_ERROR_MSG));
                }
                return downloadAndSave(location, destFile);
            })
            .then(() => Promise.resolve(destFile));
    }

    const destFile = path.resolve(location);
    if (!fs.existsSync(destFile)) {
        return Promise.reject(new ArgError(`Failed to find custom extension in location: ${destFile}`));
    }
    const fileSize = getLocalFileSizeInMB(destFile);
    if (fileSize > MAX_CUSTOM_EXT_SIZE_MB && !unlimitedSize) {
        return Promise.reject(new ArgError(MAX_CUSTOM_SIZE_ERROR_MSG));
    }
    return Promise.resolve(destFile);
}


/**
 * @param {string} url
 */
function getRemoteFileSizeInMB(url) {
    const httpRequest = require('./httpRequest');
    return httpRequest.head(url)
        .then(res => {
            const contentLengthHeader = res.headers['content-length'];
            const contentLengthBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
            return Promise.resolve(contentLengthBytes / 1000000);
        })
        .catch(err => {
            logger.warn('failed to download custom extension', { err });
            return Promise.reject(new ArgError(`Failed to download custom extension from location: ${url}`));
        });
}

/**
 *
 * @param {string[]} locations
 *
 */
function prepareExtension(locations) {
    logger.info('prepare extension', { locations });

    const fullLocations = locations.map(location => ({ location, path: getSourcePath(location) }));
    return localRunnerCache.memoize(
        () => Promise.map(fullLocations, ({ location, path }) => getSource(location, path)),
        'prepareExtension',
        MSEC_IN_HALF_DAY,
        fullLocations
    )();
}

async function prepareChromeDriver(userDetails = {}, driverOptions = {}, skipIsReadyCheck = false) {
    const ora = require('ora');
    const spinner = ora('Starting Driver').start();
    const chromedriverWrapper = require('./chromedriverWrapper');

    try {
        await chromedriverWrapper.install();
        await chromedriverWrapper.start();
        if (!skipIsReadyCheck) {
            // @ts-ignore
            await chromedriverWrapper.isReady(driverOptions);
        }
        spinner.succeed('Chrome Driver initiated successfully');
    } catch (error) {
        const errorMsg = 'Failed to initiate Chrome Driver';

        if (!(error instanceof NpmPermissionsError)) { //NpmPermissionsError was printed and logged already
            logger.error(errorMsg, {
                ...userDetails,
                ...additionalLogDetails(),
                error: serializeError(error),
            });
            // eslint-disable-next-line no-console
            console.log(`
1. If you don't have Chrome, please install it from https://www.google.com/chrome.
2. If Chrome is installed, please verify it's binary directory:
    - installed where chromedriver expects it (see https://github.com/SeleniumHQ/selenium/wiki/ChromeDriver#requirements).
    - exists in your PATH environment variables.
3. Try adding --chrome-binary-location flag to Testim CLI specifying the exact location of chrome binary in your computer (e.g on Windows "C:/Program Files/Google/Chrome/Application/chrome.exe").
4. You can always use a standalone Selenium grid and providing it's details with the --host and --port flags (see https://www.npmjs.com/package/selenium-standalone)`);
        }

        spinner.fail(errorMsg);
        throw error;
    }
}

function getPlayerVersion() {
    const url = `${config.BLOB_URL}/extension/sessionPlayer_LATEST_RELEASE`;
    return download(url)
        .then(res => Promise.resolve(res.body.toString('utf8')));
}

/**
 * @param {string} location
 * @param {string | undefined} canary
 *
 * @returns {Promise<string>}
 */
function getPlayerLocation(location, canary) {
    if (!isURL(location) || (isURL(location) && canary) || config.IS_ON_PREM) {
        return Promise.resolve(location);
    }

    return getPlayerVersion()
        .then(ver => Promise.resolve(`${location}-${ver}`));
}

function getSessionPlayerFolder() {
    const cliLocation = getCliLocation();

    return path.resolve(cliLocation, 'testim-bin');
}

function getPlayerDestination() {
    const testimAppData = getSessionPlayerFolder();

    const playerDestination = path.resolve(testimAppData, 'sessionPlayer.zip');

    return playerDestination;
}

async function downloadAndUnzip(loc, playerFileName, isRetry = false) {
    try {
        await getSource(loc, playerFileName);
        return await unzipFile(playerFileName, getSessionPlayerFolder());
    } catch (err) {
        if (isRetry) {
            throw err;
        }
        return await downloadAndUnzip(loc, playerFileName, true);
    }
}

function preparePlayer(location, canary) {
    logger.info('prepare player', { location, canary });
    const playerFileName = getPlayerDestination();
    return localRunnerCache.memoize(
        () => getPlayerLocation(location, canary)
            .then(loc => downloadAndUnzip(loc, playerFileName))
            .then(() => ({})),
        'preparePlayer',
        MSEC_IN_HALF_DAY,
        [location, canary, playerFileName]
    )();
}

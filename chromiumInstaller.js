const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { ArgError } = require('./errors');
const { unzipFile } = require('./utils');
const { downloadAndSave, TESTIM_BROWSER_DIR } = require('./utils');
const ora = require('ora');


const CHROMIUM_VERSION = '1000968'; // '973306' = 101.0.4899.0  '1000968' = 103.0.5046.0;
const DOWNLOAD_CHROME_FOLDER = path.join(TESTIM_BROWSER_DIR, `chrome-${CHROMIUM_VERSION}`);

function getCurrentPlatform() {
    const osType = os.type().toLowerCase();
    if (osType === 'darwin') {
        return os.arch() === 'arm' ? 'mac_arm' : 'mac';
    }
    if (osType === 'windows_nt') {
        return os.arch() === 'x64' ? 'win64' : 'win32';
    }
    return 'linux';
}

async function downloadAndInstallChromium() {
    /** Inspired by puppeteer's implementation https://github.com/puppeteer/puppeteer/blob/main/src/node/BrowserFetcher.ts#L45 */
    const platform = getCurrentPlatform();

    // example download url: https://storage.googleapis.com/chromium-browser-snapshots/Mac/1000968/chrome-mac.zip
    const storageBaseUrl = 'https://storage.googleapis.com/chromium-browser-snapshots';
    const platformFolder = {
        linux: 'Linux_x64',
        mac: 'Mac',
        mac_arm: 'Mac_Arm',
        win32: 'Win',
        win64: 'Win_x64',
    };
    if (!(platform in platformFolder)) {
        throw new ArgError(`Unsupported platform: ${platform}`);
    }
    // Windows archive name changed at r591479.
    const winArchiveName = parseInt(CHROMIUM_VERSION, 10) > 591479 ? 'chrome-win' : 'chrome-win32';
    const platformArchiveName = {
        linux: 'chrome-linux',
        mac: 'chrome-mac',
        mac_arm: 'chrome-mac',
        win32: winArchiveName,
        win64: winArchiveName,
    };
    const binaryPaths = {
        linux: 'chrome',
        mac: 'Chromium.app/Contents/MacOS/Chromium',
        mac_arm: 'Chromium.app/Contents/MacOS/Chromium',
        win32: 'chrome.exe',
        win64: 'chrome.exe',
    };
    const downloadUrl = `${storageBaseUrl}/${platformFolder[platform]}/${CHROMIUM_VERSION}/${platformArchiveName[platform]}.zip`;
    const downloadArchivePath = path.join(DOWNLOAD_CHROME_FOLDER, platformArchiveName[platform]);
    const downloadedZipFile = `${downloadArchivePath}.zip`;
    const binaryPath = path.join(downloadArchivePath, binaryPaths[platform]);

    if (await fs.pathExists(binaryPath)) {
        return binaryPath;
    }
    if (!(await fs.pathExists(downloadedZipFile))) {
        const downloadSpinner = ora('Downloading Chromium').start();
        try {
            await fs.mkdirp(DOWNLOAD_CHROME_FOLDER);
            await downloadAndSave(downloadUrl, downloadedZipFile);
            // todo - We can add a failover here if the download fails if we host the file too
        } catch (e) {
            const errorMessage = `Failed to download Chromium: ${e.message}`;
            downloadSpinner.fail(errorMessage);
            throw new Error(errorMessage);
        }
        downloadSpinner.succeed();
    }
    const extractSpinner = ora('Extracting Chromium').start();
    try {
        await unzipFile(downloadedZipFile, DOWNLOAD_CHROME_FOLDER);
    } catch (e) {
        const errorMessage = `Failed to extract Chromium: ${e.message}`;
        extractSpinner.fail(errorMessage);
        throw new Error(errorMessage);
    }
    extractSpinner.succeed();
    return binaryPath;
}

module.exports = {
    CHROMIUM_VERSION,
    downloadAndInstallChromium,
};

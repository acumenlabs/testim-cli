/* eslint-disable no-console */
const Promise = require('bluebird');
const semver = require('semver');
const config = require('./commons/config');
const fs = require('fs');
const logger = require('./commons/logger').getLogger('npm-driver');
const localRunnerCache = require('./commons/runnerFileCache');
const npmWrapper = require('./commons/npmWrapper');
const chalk = require('chalk');

function getNpmVersion(packName) {
    return Promise.resolve(npmWrapper.getLatestPackageVersion(packName));
}

function getPackageVersion() {
    try {
        logger.info('Get package version');
        const path = `${__dirname}/package.json`;
        if (!fs.existsSync(path)) {
            // This usually means that the program runs from a dev environment (in which __dirname
            // is the src/ directory which, obviously, does not contain a package.json file).
            return null;
        }
        const packageJson = require(path);
        return packageJson.version;
    } catch (err) {
        logger.warn('Failed to get package version', { err });
        return null;
    }
}

function checkNpmVersion() {
    if (config.IS_ON_PREM) {
        return Promise.resolve();
    }
    return localRunnerCache.memoize(() => getNpmVersion('@testim/testim-cli')
        .timeout(5000, 'The API call to NPM timed out')
        .then(latestVersion => {
            const packVersion = getPackageVersion();
            if (packVersion && semver.lt(packVersion, latestVersion)) {
                console.log(chalk.yellow(
                    `Warning: You are using version ${packVersion}, a newer version is available. To update please run npm install (npm install -g @testim/testim-cli)`)
                );
            }
        })
        .catch(err => logger.warn('Failed to get NPM version', { err }))
        .then(() => true), 'checkNpmVersion');
}

module.exports = {
    checkNpmVersion,
    getPackageVersion,
};

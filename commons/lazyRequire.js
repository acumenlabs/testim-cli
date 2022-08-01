"use strict";

const Bluebird = require('bluebird');
const npmWrapper = require('./npmWrapper');
const ora = require('ora');
const path = require('path');
const logger = require('./logger').getLogger("lazy-require");
const { getCliLocation } = require('../utils');
const { requireWithFallback } = require("./requireWithFallback")

const packageJson = require(path.resolve(getCliLocation(), 'package.json'));
const ongoingCalls = new Map();

module.exports = async function memoizedLazyRequireApi(dependency, options = {}) {
    const packageLocally = npmWrapper.getPackageIfInstalledLocally(dependency);
    if (packageLocally) {
        return packageLocally;
    }

    let spinner;
    if (!options.silent) {
        spinner = ora(`Installing ${dependency} before first usage...`).start();
    }

    try {
        const requiredModule = await memoizedLazyRequire(dependency);
        if (spinner) {
            spinner.succeed();
        }
        return requiredModule;
    } catch (error) {
        logger.warn("failed to install dependency lazily", {dependency, err: error});
        const depVersionToInstall = getVersionOfLazyDep(dependency);
        const depWithVersions = `${dependency}@${depVersionToInstall}`;

        const removeGlobal = process.argv.includes('npx');
        const globalFlag = removeGlobal ? '' : '-g '
        const errorMessage = `Installation of ${dependency} failed. This typically means you are running an out-of-date version of Node.js or NPM.` +
        `Please manually install by running the following command: npm install ${globalFlag}${depWithVersions}`

        if (spinner) {
            spinner.fail(errorMessage);
        }

        throw error;
    }
};

async function memoizedLazyRequire(identifier, options = {}) {
    if (ongoingCalls.has(identifier)) {
        return ongoingCalls.get(identifier);
    }

    ongoingCalls.set(identifier, lazyRequireImpl(identifier, options));
    ongoingCalls.get(identifier).catch(err => {
        ongoingCalls.delete(identifier);
    });

    return ongoingCalls.get(identifier);
};

async function lazyRequireImpl(dependency) {
    const packageLocally = npmWrapper.getPackageIfInstalledLocally(dependency);

    if (packageLocally) {
        return packageLocally;
    }

    const depVersionToInstall = getVersionOfLazyDep(dependency);

    const depWithVersions = `${dependency}@${depVersionToInstall}`;

    await npmWrapper.installPackageLocally(getCliLocation(), depWithVersions);

    return requireWithFallback(dependency);
}

function installAllLazyDependencies() {
    const allLazyDependencies = Object.keys(packageJson.lazyDependencies);

    return Bluebird.each(allLazyDependencies, dep => lazyRequireImpl(dep));
}

if (require.main === module) {
    installAllLazyDependencies();
}

/**
 *
 * @param {string} dependencyToFind
 */
function getVersionOfLazyDep(dependencyToFind) {
    const depEntry = Object.entries(packageJson.lazyDependencies)
        .find(([dep]) => dep === dependencyToFind);

    if (!depEntry) {
        throw new Error("The given package name is not lazyDependencies");
    }

    return depEntry[1];
}

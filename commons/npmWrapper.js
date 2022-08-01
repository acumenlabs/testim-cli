
const util = require('util');
const { additionalLogDetails } = require('./logUtils');
const exec = util.promisify(require('child_process').exec);
const spawn = require('child_process').spawn;
const path = require('path');
const { NpmPackageError, NpmPermissionsError } = require('../errors');
const Promise = require('bluebird');
const fse = require('fs-extra');
const logger = require('./logger').getLogger('cli-service');
const { requireWithFallback } = require('./requireWithFallback');
const fs = require('fs');

async function getLatestPackageVersion(packageName) {
    const result = await exec(`npm view ${packageName} version`);
    return result.stdout.trim();
}

function getPackageIfInstalledLocally(packageName) {
    try {
        // note: this code fails if require itself throws here
        // rather than an ENOENT - but since lazy dependencies are all controlled
        // by us that's probably fine.
        return requireWithFallback(packageName);
    } catch (err) {
        return false;
    }
}

async function isPackageInstalledInPath(rootPath, packageName) {
    try {
        return await fse.pathExists(path.join(rootPath, `./node_modules/${packageName}/package.json`));
    } catch (error) {
        return false;
    }
}

function getLocallyInstalledPackageVersion(rootPath, packageName) {
    // eslint-disable-next-line import/no-dynamic-require
    return require(path.join(rootPath, `./node_modules/${packageName}/package.json`)).version;
}

// this is not exactly correct, but it's good enough.
async function fileExists(path) {
    try {
        await fs.promises.access(path);
        return true;
    } catch (err) {
        return false;
    }
}

async function installPackageLocally(rootPath, packageName, execOptions) {
    function getPathWithMissingPermissions(error) {
        const pathRegex = /EACCES[^']+'(.+)'/;
        const regexResult = pathRegex.exec(error.stderr);
        if (regexResult === null) {
            return false;
        }
        return regexResult[1];
    }

    // https://github.com/npm/arborist/pull/362
    function npmSevenAndEightMissingPermissions(error) {
        return /The "to" argument must be of type string./.exec(error.stderr);
    }

    // this is here because our shrinkwrap blocks our lazy deps for some reason
    const oldShrinkwrap = path.join(rootPath, 'npm-shrinkwrap.json');
    const newShrinkwrap = path.join(rootPath, 'npm-shrinkwrap-dummy.json');
    let renamed = false;
    try {
        try {
            if (await fileExists(oldShrinkwrap)) {
                await fs.promises.rename(oldShrinkwrap, newShrinkwrap);
                renamed = true;
            }
        } catch (err) {
            // ignore error
        }
        return await exec(`npm i ${packageName} --no-save --no-prune --prefer-offline --no-audit --progress=false`, { ...execOptions, cwd: rootPath }).catch(err => {
            const pathWithMissingPermissions = getPathWithMissingPermissions(err);
            const npmEightMissingPermissions = npmSevenAndEightMissingPermissions(err);
            if (pathWithMissingPermissions || npmEightMissingPermissions) {
                logger.info('Failed to install package due to insufficient write access', {
                    ...additionalLogDetails(),
                    package: packageName,
                    path: pathWithMissingPermissions || rootPath,
                });
                // eslint-disable-next-line no-console
                console.error(`

Testim failed installing the package ${packageName} due to insufficient permissions.
This is probably due to an installation of @testim/testim-cli with sudo, and running it without sudo.
Testim had missing write access to ${pathWithMissingPermissions || rootPath}

`);
                throw new NpmPermissionsError(pathWithMissingPermissions || rootPath);
            }
            throw err;
        });
    } finally {
        if (renamed) {
            try {
                await fs.promises.rename(newShrinkwrap, oldShrinkwrap);
            } catch (err) {
                // ignore error
            }
        }
    }
}

const localNpmLocation = path.resolve(require.resolve('npm').replace('index.js', ''), 'bin', 'npm-cli.js');

function installPackages(prefix, packageNames, proxyUri, timeoutMs) {
    return new Promise((resolve, reject) => {
        const proxyFlag = proxyUri ? ['--proxy', proxyUri] : [];

        const envVars = proxyUri ? { env: Object.assign(process.env, { HTTP_PROXY: proxyUri, HTTPS_PROXY: proxyUri }) } : {};

        let stdout = '';
        let stderr = '';

        const ops = '--no-save --no-package-lock --no-prune --prefer-offline --no-audit --progress=false'.split(' ');
        const npmInstall = spawn('node', [localNpmLocation, 'i', '--prefix', prefix, ...ops, ...packageNames, ...proxyFlag], envVars);
        npmInstall.stderr.pipe(process.stderr);
        npmInstall.stdout.pipe(process.stdout);

        npmInstall.stdout.on('data', (data) => {
            stdout += data;
        });

        npmInstall.stderr.on('data', (data) => {
            stderr += data;
        });

        npmInstall.on('close', (code) => {
            if (code) {
                let errorString;
                try {
                    const packageVersion = /npm ERR! 404 {2}'(.+)' is not in the npm registry/gm.exec(stderr)[1];
                    const packageName = packageVersion.split('@')[0];
                    errorString = `404 Not Found - GET https://registry.npmjs.org/${packageName} - Not found`;
                } catch (err) {
                    errorString = `Npm Install closed with exit code ${code}\n stdout: ${stdout} stderr: ${stderr}`;
                }

                logger.debug(`Npm Install closed with exit code ${code}`, { message: errorString });

                reject(new NpmPackageError(errorString));
            } else {
                resolve(stdout);
            }
        });

        setTimeout(() => {
            try {
                npmInstall.kill();
            } finally {
                reject(new Promise.TimeoutError());
            }
        }, timeoutMs);
    });
}

module.exports = {
    isPackageInstalledInPath,
    getLatestPackageVersion,
    getPackageIfInstalledLocally,
    getLocallyInstalledPackageVersion,
    installPackageLocally,
    installPackages,
    NpmPermissionsError,
};

'use strict';

const path = require('path');
const os = require('os');
const dataUriToBuffer = require('data-uri-to-buffer');
const { spawn: threadSpawn, config } = require('threads');
const Promise = require('bluebird');
const fs = require('fs-extra');
const utils = require('../../../utils');
const logger = require('../../../commons/logger').getLogger('cli-service');
const { getS3Artifact } = require('../../../commons/testimServicesApi');
const npmWrapper = require('../../../commons/npmWrapper');
const featureFlags = require('../../../commons/featureFlags');

let workerThreads;

config.set({
    basepath: {
        node: __dirname,
    },
});

function convertWindowsBackslash(input) {
    const isExtendedLengthPath = /^\\\\\?\\/.test(input);
    const hasNonAscii = /[^\u0000-\u0080]+/.test(input); // eslint-disable-line no-control-regex

    if (isExtendedLengthPath || hasNonAscii) {
        return input;
    }

    return input.replace(/\\/g, '/');
}

function runCode(transactionId, incomingParams, context, code, packageLocalLocations = {}, timeout = undefined, fileDataUrl = undefined) {
    const requireCode = Object.keys(packageLocalLocations).reduce((all, pMember) => {
        all += `
        var ${pMember} = require('${convertWindowsBackslash(packageLocalLocations[pMember])}');
        `;
        return all;
    }, '');

    if (fileDataUrl === 'data:') { // fix chrome/safari bug that creates malformed datauri for empty files
        fileDataUrl = 'data:,';
    }

    const fileDataUrlToFileBuffer = !fileDataUrl ? 'var fileBuffer = null;' :
        `
            ${dataUriToBuffer.toString()}
            var fileBuffer = dataUriToBuffer('${fileDataUrl}');
        `;

    function constructWithArguments(constructor, args) {
        function F() {
            return constructor.apply(this, args);
        }

        F.prototype = constructor.prototype;
        return new F();
    }

    //https://github.com/anseki/console-substitute
    const consoleOverride = `

        const getMessage = arguments => {
            const args = Array.prototype.slice.call(arguments);
            let message = args.shift() + '';
            if (!args.length) {
                return message;
            }
            message = message.replace(/%([odifs])/g, function (s, param) {
                // Formatting is not yet supported.
                var arg;
                if (!args.length) {
                    return '';
                }
                arg = args.shift();
                if (param === 'o') {
                    return arg + '';
                } else if (param === 'd' || param === 'i') {
                    arg = typeof arg === 'boolean' ? (arg ? 1 : 0) : parseInt(arg, 10);
                    return isNaN(arg) ? '0' : arg + '';
                } else if (param === 'f') {
                    arg = typeof arg === 'boolean' ? (arg ? 1 : 0) : parseFloat(arg);
                    return isNaN(arg) ? '0.000000' : arg.toFixed(6) + '';
                } else if (param === 's') {
                    return arg + '';
                }
            });
            if (message) {
                args.unshift(message);
            }
            return args.join(' ').replace(/\\s*$/, ' ');
        };

        const pushNewMessage = (method, consoleArgs) => {
            const message = getMessage(consoleArgs);
            progress({
                method,
                msg: message,
                timestamp: Date.now()
            });
        };

        ["log", "info", "warn", "error", "debug"].forEach(function (method) {
            const nativeMethod = console[method];
            const oldMethod = nativeMethod && nativeMethod.bind(console);
            console[method] = function () {
                pushNewMessage(method, arguments);
                oldMethod && oldMethod.apply(console, arguments);
            };
        });
    `;

    const injectCode = `
        function injectCode(params, args, incomingParams, context, code, done) {
            ${constructWithArguments.toString()}

            var resolve = function (result) {
                done({
                    status: 'done',
                    result: result,
                    success: true
                });
            };
            var reject = function (result) {
                done({
                    status: 'failed',
                    result: result,
                    success: false
                });
            };

            try {
                params.push(code);
                var functionToRun = constructWithArguments(Function, params);

                var result = functionToRun.apply(null, args);
                if (isPromise(result)) {
                    result.then(function (res) {
                        resolve({
                            resultValue: res,
                            exports: exportedData,
                            exportsTest: exportedTestData,
                            exportsGlobal: exportedGlobalData
                        });
                    }).catch(function (err) {
                        reject({
                            resultValue: err && err.toString(),
                            exports: exportedData,
                            exportsTest: exportedTestData,
                            exportsGlobal: exportedGlobalData
                        });
                    });
                } else {
                    resolve({
                        resultValue: result,
                        exports: exportedData,
                        exportsTest: exportedTestData,
                        exportsGlobal: exportedGlobalData
                    });
                }
            } catch (e) {
                reject({
                    resultValue: e && e.toString(),
                    exports: exportedData,
                    exportsTest: exportedTestData,
                    exportsGlobal: exportedGlobalData
                });
            }
        }
    `;

    const runFn = `
        ${requireCode}

        ${fileDataUrlToFileBuffer}

        ${consoleOverride}

        ${utils.isPromise.toString()}

        const {incomingParams, context, code} = input;

        var exportedData = {};
        var exportedTestData = {};
        var exportedGlobalData = {};

        var params = ["context"]
            .concat(incomingParams.as.functionParameters)
            .concat(${JSON.stringify(Object.keys(packageLocalLocations))})
            .concat(['exports', 'exportsTest', 'exportsGlobal']);

        var args = [context]
            .concat(incomingParams.as.functionArguments)
            .concat([${Object.keys(packageLocalLocations).join(',')}])
            .concat([exportedData, exportedTestData, exportedGlobalData]);

        if(fileBuffer) {
            params = params.concat(['fileBuffer']);
            args = args.concat([fileBuffer]);
        }

        ${injectCode}

        injectCode(params, args, incomingParams, context, code, done);
    `;

    const testimConsoleLogDataAggregates = [];
    const thread = threadSpawn(constructWithArguments(Function, ['input', 'done', 'progress', runFn]));
    return new Promise((resolve) => {
        thread
            .send({ incomingParams, context, code })
            .on('message', message => {
                const messageWithLogs = Object.assign({}, message, { tstConsoleLogs: testimConsoleLogDataAggregates });
                logger.debug('Run code worker response', { messageWithLogs, transactionId });
                resolve(messageWithLogs);
            })
            .on('progress', (logMessage) => {
                testimConsoleLogDataAggregates.push(logMessage);
            })
            .on('error', (err) => {
                if (err.message === 'malformed data: URI') {
                    logger.error('Run code worker error', { err, transactionId, fileDataUrl });
                } else {
                    logger.error('Run code worker error', { err, transactionId });
                }

                resolve({
                    tstConsoleLogs: testimConsoleLogDataAggregates,
                    status: 'failed',
                    result: {
                        resultValue: err && err.toString(),
                        exports: {},
                        exportsTest: {},
                        exportsGlobal: {},
                    },
                    success: false,
                });
            })
            .on('exit', () => {
                logger.debug('Run code worker has been terminated', { transactionId });
            });
    }).timeout(timeout)
        .catch(Promise.TimeoutError, err => {
            logger.warn('timeout to run code', { transactionId, err });
            return Promise.resolve({
                tstConsoleLogs: testimConsoleLogDataAggregates,
                status: 'failed',
                result: {
                    resultValue: err && err.toString(),
                    exports: {},
                    exportsTest: {},
                    exportsGlobal: {},
                },
                success: false,
            });
        })
        .finally(() => thread && thread.kill());
}

function requireOrImportMethod(path) {
    try {
        return { sync: true, lib: require(path) };
    } catch (err) {
        if (err.code === 'ERR_REQUIRE_ESM') {
            const fs = require('fs');
            const pathModule = require('path');

            const lib = fs.promises.readFile(`${path}${pathModule.sep}package.json`).then(file => {
                const packageJson = JSON.parse(file);
                const fullPath = pathModule.join(path, packageJson.main || `${pathModule.sep}index.js`);
                return import(fullPath);
            });

            return { sync: false, lib };
        }
        throw err;
    }
}

function runCodeWithWorkerThread(transactionId, incomingParams, context, code, packageLocalLocations = {}, timeout = undefined, fileDataUrl = undefined) {
    // technically shouldn't happen, but better safe than sorry.
    if (!workerThreads) {
        workerThreads = require('worker_threads');
    }
    const { Worker } = workerThreads;
    const requireCode = Object.keys(packageLocalLocations).reduce((all, pMember) => {
        all += `
        var res = requireOrImportMethod('${convertWindowsBackslash(packageLocalLocations[pMember])}');
        if (res.sync) {
            var ${pMember} = res.lib;
        } else {
            var ${pMember} = await res.lib;
        }
        `;
        return all;
    }, '');

    if (fileDataUrl === 'data:') { // fix chrome/safari bug that creates malformed datauri for empty files
        fileDataUrl = 'data:,';
    }

    const fileDataUrlToFileBuffer = !fileDataUrl ? 'var fileBuffer = null;' :
        `
            ${dataUriToBuffer.toString()}
            var fileBuffer = dataUriToBuffer('${fileDataUrl}');
        `;

    function constructWithArguments(constructor, args) {
        function F() {
            return constructor.apply(this, args);
        }

        F.prototype = constructor.prototype;
        return new F();
    }

    //https://github.com/anseki/console-substitute
    // note that this method is a bit different than the one in the non-worker one.
    const consoleOverride = `
        const getMessage = arguments => {
            const args = Array.prototype.slice.call(arguments);
            let message = args.shift() + '';
            if (!args.length) {
                return message;
            }
            message = message.replace(/%([odifs])/g, function (s, param) {
                // Formatting is not yet supported.
                var arg;
                if (!args.length) {
                    return '';
                }
                arg = args.shift();
                if (param === 'o') {
                    return arg + '';
                } else if (param === 'd' || param === 'i') {
                    arg = typeof arg === 'boolean' ? (arg ? 1 : 0) : parseInt(arg, 10);
                    return isNaN(arg) ? '0' : arg + '';
                } else if (param === 'f') {
                    arg = typeof arg === 'boolean' ? (arg ? 1 : 0) : parseFloat(arg);
                    return isNaN(arg) ? '0.000000' : arg.toFixed(6) + '';
                } else if (param === 's') {
                    return arg + '';
                }
            });
            if (message) {
                args.unshift(message);
            }
            return args.join(' ').replace(/\\s*$/, ' ');
        };

        const pushNewMessage = (method, consoleArgs) => {
            const message = getMessage(consoleArgs);
            parentPort.postMessage({
                action: 'progress',
                data: {
                    method,
                    msg: message,
                    timestamp: Date.now(),
                }
            });
        };

        ["log", "info", "warn", "error", "debug"].forEach(function (method) {
            const nativeMethod = console[method];
            const oldMethod = nativeMethod && nativeMethod.bind(console);
            console[method] = function () {
                pushNewMessage(method, arguments);
                oldMethod && oldMethod.apply(console, arguments);
            };
        });
    `;

    const injectCode = `
        function injectCode(params, args, incomingParams, context, code) {
            ${constructWithArguments.toString()}

            var resolve = function (result) {
                parentPort.postMessage({
                    action: 'finish',
                    data: {
                        status: 'done',
                        result: result,
                        success: true,
                    }
                });
            };
            var reject = function (result) {
                parentPort.postMessage({
                    action: 'finish',
                    data: {
                        status: 'failed',
                        result: result,
                        success: false,
                    }
                });
            };

            try {
                params.push(code);
                const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
                var functionToRun = constructWithArguments(AsyncFunction, params);

                var result = functionToRun.apply(null, args);
                if (isPromise(result)) {
                    result.then(function (res) {
                        resolve({
                            resultValue: res,
                            exports: exportedData,
                            exportsTest: exportedTestData,
                            exportsGlobal: exportedGlobalData
                        });
                    }).catch(function (err) {
                        reject({
                            resultValue: err && err.toString(),
                            exports: exportedData,
                            exportsTest: exportedTestData,
                            exportsGlobal: exportedGlobalData
                        });
                    });
                } else {
                    resolve({
                        resultValue: result,
                        exports: exportedData,
                        exportsTest: exportedTestData,
                        exportsGlobal: exportedGlobalData
                    });
                }
            } catch (e) {
                reject({
                    resultValue: e && e.toString(),
                    exports: exportedData,
                    exportsTest: exportedTestData,
                    exportsGlobal: exportedGlobalData
                });
            }
        }
    `;

    const runFn = `
        (async function() {
            const { parentPort } = require('worker_threads');
            ${requireOrImportMethod}

            // requireCode will set async to be true if needed.
            ${requireCode}

            ${fileDataUrlToFileBuffer}

            ${consoleOverride}

            ${utils.isPromise.toString()}

            parentPort.once('message', input => {
                const {incomingParams, context, code} = input;

                var exportedData = {};
                var exportedTestData = {};
                var exportedGlobalData = {};

                var params = ["context"]
                    .concat(incomingParams.as.functionParameters)
                    .concat(${JSON.stringify(Object.keys(packageLocalLocations))})
                    .concat(['exports', 'exportsTest', 'exportsGlobal']);

                var args = [context]
                    .concat(incomingParams.as.functionArguments)
                    .concat([${Object.keys(packageLocalLocations).join(',')}])
                    .concat([exportedData, exportedTestData, exportedGlobalData]);

                if(fileBuffer) {
                    params = params.concat(['fileBuffer']);
                    args = args.concat([fileBuffer]);
                }

                ${injectCode}

                injectCode(params, args, incomingParams, context, code);
            });
        })();
    `;

    const testimConsoleLogDataAggregates = [];
    const thread = new Worker(runFn, {
        eval: true,
    });
    return new Promise((resolve) => {
        thread
            .on('message', message => {
                if (message.action === 'finish') {
                    const { data } = message;
                    const messageWithLogs = Object.assign({}, data, { tstConsoleLogs: testimConsoleLogDataAggregates });
                    logger.debug('Run code worker response', { messageWithLogs, transactionId });
                    resolve(messageWithLogs);
                } else if (message.action === 'progress') {
                    testimConsoleLogDataAggregates.push(message.data);
                }
            })
            .on('error', (err) => {
                if (err.message === 'malformed data: URI') {
                    logger.error('Run code worker error', { err, transactionId, fileDataUrl });
                } else {
                    logger.error('Run code worker error', { err, transactionId });
                }

                resolve({
                    tstConsoleLogs: testimConsoleLogDataAggregates,
                    status: 'failed',
                    result: {
                        resultValue: err && err.toString(),
                        exports: {},
                        exportsTest: {},
                        exportsGlobal: {},
                    },
                    success: false,
                });
            })
            .on('exit', () => {
                logger.debug('Run code worker has been terminated', { transactionId });
            });
        // context can contain methods and proxies which cannot pass.
        thread.postMessage({ incomingParams, context: JSON.parse(JSON.stringify(context)), code });
    }).timeout(timeout)
        .catch(Promise.TimeoutError, err => {
            logger.warn('timeout to run code', { transactionId, err });
            return Promise.resolve({
                tstConsoleLogs: testimConsoleLogDataAggregates,
                status: 'failed',
                result: {
                    resultValue: err && err.toString(),
                    exports: {},
                    exportsTest: {},
                    exportsGlobal: {},
                },
                success: false,
            });
        })
        .finally(() => thread && thread.terminate());
}

function removeFolder(installFolder) {
    return new Promise(resolve => fs.remove(installFolder)
        .then(resolve)
        .catch(err => {
            logger.warn('failed to remove install npm packages folder', { err });
            return resolve();
        }));
}

function getTransactionId(stepResultId, testResultId, stepId, retryIndex) {
    return `${testResultId}_${stepId}_${stepResultId}_${retryIndex}`;
}

function installPackage(stepId, testResultId, retryIndex, packageData, stepResultId, timeout) {
    const transactionId = getTransactionId(stepResultId, testResultId, stepId, retryIndex);
    return runNpmInstall(transactionId, packageData, timeout).then(({ data }) => data);
}

function runCodeWithPackages(code, stepId, incomingParams, context, testResultId, retryIndex, stepResultId, timeout, fileDataUrl, s3filepath) {
    const packageLocalLocations = (incomingParams.nodePackageParams || []).reduce((packages, data) => {
        packages[data.paramName] = data.testimPackageLocalLocation;
        return packages;
    }, {});
    const transactionId = getTransactionId(stepResultId, testResultId, stepId, retryIndex);

    const getS3ArtifactPromise = s3filepath ?
        getS3Artifact(s3filepath) :
        Promise.resolve();

    return getS3ArtifactPromise.then(s3fileDataUrl => {
        if (s3fileDataUrl) {
            fileDataUrl = s3fileDataUrl;
        }
    }).then(() => {
        if (typeof workerThreads === 'undefined') {
            try {
                workerThreads = require('worker_threads');
            } catch (err) {
                workerThreads = false;
            }
        }

        if (workerThreads && featureFlags.flags.enableWorkerThreadsCliCodeExecution.isEnabled()) {
            return runCodeWithWorkerThread(transactionId, incomingParams, context, code, packageLocalLocations, timeout, fileDataUrl);
        }
        return runCode(transactionId, incomingParams, context, code, packageLocalLocations, timeout, fileDataUrl);
    }).then(res => Object.assign({}, res, { nodeVersion: process.version }));
}

function runNpmInstall(transactionId, packageData, timeout) {
    const packages = packageData.map(data => `${data.packageName}@${data.packageVersion}`);
    const localPackageInstallFolder = getLocalPackageInstallFolder();
    const installFolder = path.join(localPackageInstallFolder, `/${transactionId}`);
    const proxyUri = global.proxyUri;

    // while correct, everything is in a try/catch so it should be fine.
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
        let output = '';
        try {
            output = await npmWrapper.installPackages(installFolder, packages, proxyUri, timeout);
            logger.info('npm package install finished', { transactionId, output, timeout });
            if (Number(output.trim().split(' ')[1]) < packages.length) {
                reject('npm package install failed, couldn\'t install all packages');
                return;
            }
            const packageDataWithVersions = packageData.map(pData => {
                const version = npmWrapper.getLocallyInstalledPackageVersion(installFolder, pData.packageName);
                const packageFullName = `${pData.packageName}@${version}`;
                const packageLocalLocation = path.resolve(installFolder, 'node_modules', pData.packageName);
                return Object.assign({}, pData, {
                    packageFullName,
                    packageLocalLocation,
                });
            });

            resolve({ data: packageDataWithVersions, installFolder });
        } catch (err) {
            logger.warn('npm package install failed', { transactionId, err });
            reject(err);
        }
    })
        .timeout(timeout)
        .catch(Promise.TimeoutError, err => {
            logger.warn('timeout to install package', { packages, transactionId, err, timeout });
            throw err;
        });
}

function getLocalPackageInstallFolder() {
    return path.join(os.tmpdir(), '/testim_local_packages');
}

function cleanLocalPackageInstallFolder() {
    const localPackageInstallFolder = getLocalPackageInstallFolder();
    return removeFolder(localPackageInstallFolder);
}

module.exports = {
    runCodeWithPackages,
    installPackage,
    cleanLocalPackageInstallFolder,
};

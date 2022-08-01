#! /usr/bin/env node
/* eslint-disable no-console */

'use strict';

require('./bluebirdConfig.js');
const options = require('./runOptions');
const EventEmitter = require('events');
const logger = require('./commons/logger').getLogger('cli-entry');
const { onExit, ignoreFailingTestsInExitCode } = require('./cli/onExit');
const testRunner = require('./runner');
const prepareRunner = require('./commons/prepareRunner');
const { CLI_MODE } = require('./commons/constants');
const { updateRemoteRunFailure } = require('./commons/testimServicesApi');
const prepareRunnerAndTestimStartUtils = require('./commons/prepareRunnerAndTestimStartUtils');

const {
    NoArgsError,
    SeleniumError,
    ArgError,
} = require('./errors');

const utils = require('./utils');
const semver = require('semver');
const perf = require('./commons/performance-logger');
const agentMode = require('./cliAgentMode');

try {
    require('./fixLocalBuild');
} catch (e) { /* :( */ }

async function checkNodeVersion() {
    const version = await utils.getEnginesVersionAsync();
    if (!semver.satisfies(process.version, version)) {
        throw new ArgError(`Required node version ${version} not satisfied with current version ${process.version}`);
    }

    // const majorVersion = Number(process.version.replace('v', '').split('.')[0]);
    // const dateHasPassed = new Date('2022-08-01T00:00:00.000Z') <= new Date();

    // if (majorVersion < 14 && dateHasPassed) {
    //     throw new ArgError('Testim.io CLI supports Node.js 14 and above, please upgrade to a newer Node.js version');
    // }

    // if (majorVersion < 14) {
    //     console.log('\x1b[33m%s\x1b[0m', 'Testim.io CLI will stop supporting Node.js < 14 on August 1st 2022, please upgrade to a newer Node.js version');
    // }
}

async function main() {
    console.log('Starting Testim.io CLI');
    perf.log('Starting Testim.io CLI');
    require('./processHandler')(onExit);

    checkNodeVersion().catch(err => {
        console.log('Argument Error:', err.message);
        process.exit(1);
    });

    try {
        const processedOptions = await options.process();
        perf.log('in main, after options.process');
        require('./commons/logger').setProxyUri(global.proxyUri);
        if (processedOptions.parallel && processedOptions.parallel > 5) {
            EventEmitter.defaultMaxListeners = processedOptions.parallel * 2;
        }
        require('./commons/logger').setProjectId(processedOptions.project);
        require('./commons/runnerFileCache').setEncryptKey(typeof processedOptions.token === 'string' ? processedOptions.token : 'anonymous_encrypt_key');

        if (processedOptions.initCodimMode) {
            const codimCli = require('./codim/codim-cli');
            return codimCli.init(processedOptions.initTestProject);
        }
        if (processedOptions.loginMode) {
            return undefined;
        }
        if (processedOptions.createPrefechedData) {
            const runnerFileCache = require('./commons/runnerFileCache');
            await runnerFileCache.clear();
            await prepareRunner.initializeUserWithAuth(processedOptions);
            await require('./commons/preloadTests').preloadTests(processedOptions);
            if (!processedOptions.playerRequirePath && processedOptions.mode !== CLI_MODE.EXTENSION) {
                await prepareRunnerAndTestimStartUtils.preparePlayer(processedOptions.playerLocation, processedOptions.canary);
            }
            const res = await runnerFileCache.waitForSave();
            if (res.success) {
                console.log(`created prefeched data at ${runnerFileCache.getCacheFileLocation()}`);
            } else {
                console.error('failed to create prefech data', res.error);
            }
            return undefined;
        }

        if (processedOptions.tunnelOnlyMode) {
            await testRunner.init(processedOptions);
            await require('./commons/testimTunnel').serveTunneling(processedOptions);
            return undefined;
        }

        if (agentMode.shouldStartAgentMode(processedOptions)) {
            return agentMode.runAgentMode(processedOptions);
        }

        if (processedOptions.saveRCALocally) {
            const { port } = await require('./services/localRCASaver').initServer(processedOptions);
            processedOptions.localRCASaver = `http://localhost:${port}`;
        }

        if (processedOptions.exitCodeIgnoreFailingTests) {
            ignoreFailingTestsInExitCode();
        }

        perf.log('right before testRunner.init/prepareRunner.prepare');
        const [customExtensionLocalLocation] = await Promise.all([
            prepareRunner.prepare(processedOptions),
            testRunner.init(processedOptions),
        ]);
        perf.log('right after testRunner.init/prepareRunner.prepare');
        return await testRunner.run(processedOptions, customExtensionLocalLocation);
    } catch (err) {
        if (err instanceof NoArgsError) {
            // display help by default
            return undefined;
        }
        const argsForRemoteRunFailure = utils.getArgsOnRemoteRunFailure();
        if (argsForRemoteRunFailure) {
            await updateRemoteRunFailure({ ...argsForRemoteRunFailure, error: err.message }).catch(() => { /* */ });
        }
        if (err instanceof ArgError) {
            console.log('Argument Error:', err.message);
            return err;
        }
        if (err instanceof SeleniumError) {
            console.log('Selenium Error:', err.message);
            return err;
        }
        console.log('Error:', err.message);
        logger.error('runner ended with unexpected error', { err });
        return err;
    }
}

main().then(result => {
    if (Array.isArray(result) && result.length === 0) {
        console.log('No tests ran');
    }
    onExit(result);
});


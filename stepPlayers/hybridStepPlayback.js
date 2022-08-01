
"use strict";

const { sessionType } = require('../commons/constants');
const perfLogger = require('../commons/performance-logger');
const MemoryFS = require('memory-fs');
const mfs = new MemoryFS();
const AbortController = require("abort-controller");
const logger = require('../commons/logger').getLogger('hybrid-step-playback');

/**
 * @type {Map<string, import("abort-controller")>}
 */
const runningStepsAbortControllersRegistry = new Map();

// TODO(Benji) cache compile between runs with webpack cache plugin or runnerFileCache

let stepsProxy = undefined;

module.exports.run = (driver, remoteStep, projectData, userData) => {
    const { step, context} = remoteStep.data;
    return module.exports.execute(step, context, driver, userData.loginData);
    // (step, context, driver, loginData, frameManager)
}

// this function is exported as a "make sense API", `run` above is teh remote run signature for polymorphic dispatch
module.exports.execute = async function execute(step, context, driver, loginData, frameManager, source = 'cli') {
    const abortController = new AbortController();
    const { signal: abortSignal } = abortController;

    runningStepsAbortControllersRegistry.set(context.stepResultId, abortController);

    try {
        perfLogger.log('before seleniumTestPlayer require');
        const SeleniumTestPlayer = require('../player/seleniumTestPlayer');
        const { compileFunctionsLibrary } = require('../agent/routers/codim/service');

        const { functionName } = step;
        const userParamsData = {}; // no tdk access
        //TODO (benji) read function parameters and arguments from context.incomingParams.as
        const shouldMonitorPerformance = false;
        const player = new SeleniumTestPlayer(
            context.id, // has to be on the same session ID to reuse the same tabs from tabService
            userParamsData,
            shouldMonitorPerformance,
            sessionType.CODEFUL,
            driver
        );

        stepsProxy = player.sessionPlayer.codeSessionPlayer.proxy;
        // reuse the same memory filesystem between runs for cache

        const bypassWebpack = step.bypassWebpack ? { testim: stepsProxy.wrappedSteps() } : false;

        perfLogger.log('before compileFunctionsLibrary', {bypassWebpack: Boolean(step.bypassWebpack) });
        let code;
        try {
            code = await compileFunctionsLibrary({ fileSystem: mfs, bypassWebpack }, abortSignal);
        } catch (e) {
            return { success: false, shouldRetry: false, reason: 'Unable to compile functions library. ' + e.message, extraInfo: e.stack };
        }

        if (typeof globalThis === 'undefined') { // fix for Node 8 and Node 10
            global.globalThis = process;
        }
        let hybridFunction;
        if (!bypassWebpack) {
            global.globalThis.__testim = stepsProxy.wrappedSteps();
            // this evaluates the code while exposing __testim. We manually expose the proxy here since
            // our test-extractor code assumes it's extracting tests and this just needs to "eval" the whole file
            (0, eval)(code);
            hybridFunction = globalThis.tdk[functionName];
        } else {
            hybridFunction = code[functionName];
        }

        perfLogger.log('after hybridFunction obtain and eval');
        if (!hybridFunction) {
            return {
                success: false,
                shouldRetry: false,
                reason: `Could not find function '${functionName}' locally. Please make sure you have a functions.js file with a '${functionName}' function defined`,
                extraInfo: Object.keys(globalThis.tdk) // log available functions to make debugging easier
            };
        }

        if (hybridFunction.type === 'selenium') {
            const seleniumPlayback = require('./seleniumHybridStepPlayback').execute;
            return await seleniumPlayback(player, hybridFunction, step, context, source, abortSignal);
        }
        if (hybridFunction.type === 'puppeteer') {
            if (!player.driver.cdpUrl) {
                return { success: false, shouldRetry: false, reason: 'running puppeteer code requires the remote debugging protocol to be open. Please contact Testim support.'}
            }
            perfLogger.log('before puppeteerPlayback');
            const puppeteerPlayback = require('./puppeteerHybridStepPlayback').execute;
            try {
                return await puppeteerPlayback(player, hybridFunction, step, context, source, abortSignal);
            } finally {
                perfLogger.log('after puppeteerPlayback');
            }
        }

        if (hybridFunction.type === 'playwright') {
            if (!player.driver.cdpUrl) {
                return { success: false, shouldRetry: false, reason: 'running playwright code requires the remote debugging protocol to be open. Please contact Testim support.'}
            }
            const playwrightPlayback = require('./playwrightHybridStepPlayback').execute;
            return await playwrightPlayback(player, hybridFunction, step, context, source, abortSignal);
        }

        if (hybridFunction.type === 'tdk' || !hybridFunction.type) {
            const tdkPlayback = require('./tdkHybridStepPlayback').execute;
            perfLogger.log('before tdkPlayback');
            try {
                return await tdkPlayback(player, hybridFunction, context, loginData, frameManager, step, source, abortSignal);
            } finally {
                perfLogger.log('after tdkPlayback');
            }
        }

        return { success: false, shouldRetry: false, reason: 'unknown hybrid format ' + hybridFunction.type };
    } catch (err) {
        logger.log('error running hybrid step', { err });
    } finally {
        runningStepsAbortControllersRegistry.delete(context.stepResultId);
    }
};

module.exports.abort = function abort(stepResultId) {
    const abortController = runningStepsAbortControllersRegistry.get(stepResultId);

    if (abortController) {
        abortController.abort();
    } else {
        throw new Error("No such stepResultId");
    }
}

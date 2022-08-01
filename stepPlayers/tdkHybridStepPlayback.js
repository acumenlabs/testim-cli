'use strict';

const _ = require('lodash');
const sessionPlayerInit = require('../commons/getSessionPlayerRequire');
const perfLogger = require('../commons/performance-logger');
const { guid } = require('../utils');
const { getArgumentsFromContext } = require('../codim/hybrid-utils');
const { AbortError } = require("../commons/AbortError");

module.exports.execute = async function executeTdkFunction(player, hybridFunction, context, loginData, frameManager, step, source, abortSignal) {
    function onAbort() {
        player.sessionPlayer.stopPlaying();
    }

    abortSignal.addEventListener("abort", onAbort);

    function getLocator(arg) {
        if (step.parameterValues) { // tdk is all grown up and can run real locators
            const locateStep = step.parameterValues.find(param => param.type === 'locate' && param.id === arg.locatorId);
            return { elementLocator: locateStep.elementLocator , id: locateStep.id, name: 'Hybrid Step Locator' };
        }
        if (!arg.locatedElement.shadowPath) {
            return arg; // wat
        }
        // fallback to selector, this should never happen in practice except when there was
        // no locator to begin with (like if we expose reverse-hybrid to TDK)
        return arg.locatedElement.shadowPath[0];
    }
    const args = await getArgumentsFromContext(step, context, getLocator);
    const fn = hybridFunction.bind(null, ...args);

    // assign same framemanager
    const testId = guid();
    const executionId = guid(); // we don't use the same execution ID to not associate the run with the suite and trigger bugs in features like "rerun by failed run id"
    const resultId = context.testResultId; // this isn't the TDK result id - it's the _parent_ result ID tdk nests under.
    const baseUrl = context.config.baseUrl;
    const userData = _.cloneDeep(context); // the context contains everything needed as userData except login data
    userData.loginData = loginData;
    const version = sessionPlayerInit.manifestVersion || 'runner';
    const isLocalRun = false;
    const overrideTestConfigId = null;
    const branch = 'master'; // With TDK - branches are meaningless
    const testName = `Execute TDK Function '${step.functionName}'`;
    const ignoreNavigation = true;


    const codeTest = {
        fn,
        bypassSetup: true, // don't setup and resize according to the TestConfig when starting
        isBeforeOrAfterTest: true, // not a full test - don't perform "must contain assertions" validation
        name: testName,
        sourceCode: fn.toString(),
        sourceName: fn.name,
        testId,
        resultId: guid() // we don't want to reuse the resultId of the parent for the child - we need a new resultId
    };
    const onlyLocalReporting = typeof hybridFunction.results === 'boolean' && !hybridFunction.results;
    try {
        perfLogger.log('tdkHybridStepPlayback before addAllTabs');
        if (frameManager) { // we have a frameManager we can reuse
            player.sessionPlayer.playbackAutUtils.frameManager = player.sessionPlayer.frameManager = frameManager;
        } else {
            // otherwise, we have to tell the session player about them tabs
            //TODO(benji) call getEditorUrl?
            await player.addAllTabs(null, { loadInfo: true, checkForMainTab: true, takeScreenshots: !onlyLocalReporting }, [player.driver.initialUrl]);
        }
        player.sessionPlayer.playbackManager.dontAssociateChildResult = true; // don't associate child result to this test result.
        player.sessionPlayer.playbackManager.onlyLocalReporting = onlyLocalReporting;
        perfLogger.log('tdkHybridStepPlayback before playTestByCode');
        const testResult = await new Promise((resolve, reject) => {
            if (source === 'agent') {
                resolveOnTestResultAndNotAssetsUploaded(player, resolve);
            }
            function onAbort() {
                reject(new AbortError());
                abortSignal.removeEventListener("abort", onAbort);
            }

            abortSignal.addEventListener("abort", onAbort);

            player.sessionPlayer.playTestByCode(testId, executionId, resultId, baseUrl, userData, version, resolve, isLocalRun, overrideTestConfigId, branch, [codeTest], testName, ignoreNavigation).catch(reject);
            
        });
        perfLogger.log('tdkHybridStepPlayback after playTestByCode');
        // testResult.status?
        return { success: testResult.success, shouldRetry: false, resultInfo: { testId, executionId, resultId: codeTest.resultId } };
    } catch (e) {
        return { success: false, error: e, shouldRetry: false }
    } finally {
        abortSignal.removeEventListener("abort", onAbort);
    }
};

function resolveOnTestResultAndNotAssetsUploaded(player, resolve) {
    const { commonConstants } = require('../commons/getSessionPlayerRequire');
    player.sessionPlayer.playbackManager.on(commonConstants.playback.START, ({testResult}) => {
        let runnerStatus = testResult.runnerStatus;
        Object.defineProperty(testResult, 'runnerStatus', {
            get() { return runnerStatus },
            set(value) { 
                runnerStatus = value;
                if (value === 'FINISHED') {
                    // resolve as soon as the runner is finished, before assets are uploaded
                    resolve(testResult);
                }
            }
        });
    });
}

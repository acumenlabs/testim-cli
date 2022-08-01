
const perf = require('./performance-logger');
const localRunnerCache = require('./runnerFileCache');
const servicesApi = require('./testimServicesApi.js');
const testimCustomToken = require('./testimCustomToken');


const FIVE_MINUTES_MS = 1000 * 60 * 5;
const TEN_HOURS_MS = 1000 * 60 * 60 * 10;

function preloadSlowRequires(mode) {
    process.nextTick(() => {
        // heuristic to pay the cost of loading the sessionPlayer here while we are waiting for the backend
        if (mode === 'selenium') {
            try {
                require('./getSessionPlayerRequire');
                // jsdom for the same reason, we don't require workerSelenium here since it actually takes longer to load
                // then it takes for the backend to return 🤯
                require('jsdom');
            } catch (e) {
                //silent catch
            }
        }
    });
}

async function initializeUserWithAuth(options) {
    const { project, token, lightweightMode, useLocalChromeDriver, useChromeLauncher, mode } = options;

    const lightweightModeGenral = Boolean(lightweightMode && lightweightMode.general);
    const localGrid = Boolean(useLocalChromeDriver || useChromeLauncher);
    const memoizationTTL = lightweightModeGenral ? TEN_HOURS_MS : FIVE_MINUTES_MS;

    perf.log('before initializeUserWithAuth');
    const result = await localRunnerCache.memoize(async () => {
        preloadSlowRequires(mode);
        return await servicesApi.initializeUserWithAuth({
            projectId: project,
            token,
            branchName: options.branch,
            lightweightMode,
            localGrid,
        });
    }, 'initializeUserWithAuth', memoizationTTL, { project, token, branchName: options.branch, lightweightModeGenral, localGrid })();
    perf.log('after initializeUserWithAuth');

    testimCustomToken.initFromData(result.authData, options.project, options.token);
    return result;
}

module.exports = {
    initializeUserWithAuth,
};

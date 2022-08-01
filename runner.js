'use strict';

/* eslint-disable no-console */
const { CLI_MODE } = require('./commons/constants');
const _ = require('lodash');
const { EDITOR_URL } = require('./commons/config');
const tunnel = require('./commons/testimTunnel');
const utils = require('./utils');
const reporter = require('./reports/reporter');
const testimCustomToken = require('./commons/testimCustomToken');
const socketService = require('./commons/socket/socketService');
const servicesApi = require('./commons/testimServicesApi.js');
const npmDriver = require('./testimNpmDriver.js');
const analytics = require('./commons/testimAnalytics');
const branchService = require('./services/branchService');
const gridService = require('./services/gridService');
const { ArgError, QuotaDepletedError } = require('./errors');
const featureFlags = require('./commons/featureFlags');
const perf = require('./commons/performance-logger');
const { prepareMockNetwork, initializeUserWithAuth } = require('./commons/prepareRunner');

const FREE_PLAN_MINIMUM_BROWSER_TIMEOUT = 30 * 60 * 1000;

const TestPlanRunner = require('./runners/TestPlanRunner');
const labFeaturesService = require('./services/labFeaturesService');
const featureAvailabilityService = require('./commons/featureAvailabilityService');

const logger = require('./commons/logger').getLogger('runner');

function validateCLIRunsAreAllowed(options) {
    const hasCliAccess = _.get(options, 'company.activePlan.premiumFeatures.allowCLI');

    if (!hasCliAccess) {
        const projectId = options.project;
        analytics.track(options.authData.uid, 'cli-not-supported', { projectId });
        console.warn('Testim CLI is not supported in this plan');
    }
}

async function validateProjectQuotaNotDepleted(options) {
    const projectId = options.project;

    const usage = await servicesApi.getUsageForCurrentBillingPeriod(projectId);
    const isExecutionBlocked = usage && usage.isExecutionBlocked;
    if (!isExecutionBlocked) {
        return;
    }

    console.error('You have reached the limit of runs for the billing month, please upgrade your plan at https://www.testim.io/upgrade-contact-us?source=cli');
    analytics.track(options.authData.uid, 'execution-quota-surpassed', { projectId });
    throw new QuotaDepletedError();
}

function validateOptionsForCompany(options, company) {
    const optionsRetention = options.retentionDays;
    if (!optionsRetention) {
        return;
    }

    const companyRetention = _.get(company, 'activePlan.premiumFeatures.resultRetention');
    if (optionsRetention > companyRetention) {
        throw new ArgError(`Retention days (${optionsRetention}) cannot be greater than the company's retention days (${companyRetention}). Run aborted`);
    }
}

async function validateCliAccount(options) {
    if (options.lightweightMode && options.lightweightMode.disableQuotaBlocking) {
        return;
    }
    try {
        await Promise.all([
            validateProjectQuotaNotDepleted(options),
            validateCLIRunsAreAllowed(options),
        ]);
    } catch (err) {
        if (err instanceof ArgError || err instanceof QuotaDepletedError) {
            throw err;
        }
        logger.error('could not validate cli account', { err });
    }
}

function analyticsIdentify(projectId) {
    const authData = testimCustomToken.getTokenV3UserData();
    return analytics.identify({
        userId: authData.uid,
        name: authData.uid,
        traits: {
            projectId,
            company: {
                id: projectId,
                lastCIRun: Math.floor(Date.now() / 1000), // unix timestamp
            },
        },
    });
}

function initSocketServices(projectId, { disableResults = false, disableRemoteStep = false }) {
    if (featureFlags.flags.useNewWSCLI.isEnabled() && !disableResults && !disableRemoteStep) {
        return socketService.connect(projectId);
    }
    if (!disableRemoteStep) {
        const remoteStepService = require('./commons/socket/remoteStepService');
        remoteStepService.init(projectId);
    }
    if (!disableResults) {
        const testResultService = require('./commons/socket/testResultService');
        testResultService.init(projectId);
    }
    return undefined;
}

function setBranch(options, branchInfoFromServer) {
    const { branch, autoDetect } = options;
    branchService.setCurrentBranch(branchInfoFromServer, autoDetect);
    if (!branchInfoFromServer && !autoDetect) {
        throw new ArgError(`branch ${branch} does not exist, run aborted.`);
    }
}

function setCompany(options, company) {
    const { onprem, id, storageBaseUrl, storageType, name, activePlan = {} } = company;
    if (onprem) {
        const { mode, extensionPath, ext, playerPath } = options;
        if ([CLI_MODE.SELENIUM].includes(mode) && !playerPath) {
            throw new ArgError('in selenium on prem mode --player-path must be provided');
        }
        if (mode === 'extension' && !extensionPath && !ext) {
            throw new ArgError('In extension on prem mode --ext or --extension-path must be provided');
        }
    }
    const isPOC = Boolean(activePlan.isPoc);
    const isStartUp = Boolean(activePlan.isStartUp);
    const planType = utils.getPlanType(activePlan);
    if (planType === 'free') {
        options.newBrowserWaitTimeout = options.newBrowserWaitTimeout < FREE_PLAN_MINIMUM_BROWSER_TIMEOUT ? FREE_PLAN_MINIMUM_BROWSER_TIMEOUT : options.newBrowserWaitTimeout;
    }
    featureFlags.setCompanyId(id);
    featureFlags.setIsPOC(isPOC);
    featureFlags.setIsStartUp(isStartUp);
    featureFlags.setPlanType(planType);
    featureAvailabilityService.setPlanType(planType);
    options.company = {
        companyId: id,
        onprem,
        storageBaseUrl,
        storageType,
        name,
        planType,
        isPOC,
        isStartUp,
        activePlan,
    };
}

function setSystemInfo(options, editorConfig) {
    if (EDITOR_URL) {
        options.editorUrl = EDITOR_URL;
        return;
    }
    options.editorUrl = editorConfig.editorUrl;
}

function setAllGrids(options, allGrids) {
    options.allGrids = allGrids;
}

function setAuthData(options, authData) {
    options.authData = authData;
}

function setProject(options, project) {
    const { id, name, type, defaults } = project;
    featureFlags.setProjectId(id);
    options.projectData = {
        projectId: id,
        type,
        name,
        defaults,
    };
}

async function setGrid(options) {
    options.gridData = await gridService.getGridData(options);
}

async function setMockNetworkRules(options) {
    const { project } = options;
    const props = { projectId: project };

    if (options.overrideMappingFile) {
        analytics.trackWithCIUser('user-override-file', props);
        options.mockNetworkRules = await prepareMockNetwork(options.overrideMappingFile);
    }
}

async function runRunner(options, customExtensionLocalLocation) {
    perf.log('in runner.js runRunner');

    const { project, remoteRunId, useLocalChromeDriver, useChromeLauncher } = options;

    if (!remoteRunId) {
        options.source = (useLocalChromeDriver || useChromeLauncher) ? 'cli-local' : 'cli';
    }

    npmDriver.checkNpmVersion();
    perf.log('in runner.js after checkNpmVersion');

    await validateCliAccount(options);

    perf.log('in runRunner before tunnel.connect');
    await tunnel.connect(options);
    perf.log('in runRunner after tunnel.connect');

    const testPlanRunner = new TestPlanRunner(customExtensionLocalLocation);
    const results = await testPlanRunner.run(options);

    perf.log('before tunnel.disconnect');
    await tunnel.disconnect(options);
    await gridService.keepAlive.end(project);
    perf.log('after tunnel.disconnect and gridService.keepAlive.end');

    return results;
}

function showFreeGridRunWarningIfNeeded(options) {
    if (featureAvailabilityService.shouldShowFreeGridRunWarning(options.gridData && options.gridData.type)) {
        const CYAN = '\x1b[36m';
        const UNDERSCORE = '\x1b[4m';
        const RESET = '\x1b[0m';
        const MESSAGE = 'Our Free grid offers basic service performance.\nIf you need faster results, contact us to upgrade your plan and dramatically improve your tests’ run times.';
        console.log(`\n${UNDERSCORE}${CYAN}${MESSAGE}${RESET}\n`);
    }
}

/**
 * This method initializes the Testim CLI with all the information it needs to start executing, it takes care of:
 *
 * - Reporting the user to analytics
 * - Authenticating the user and exchanging their token for a jwt
 * - Sets the grids for the company and validates the user has permission to run the CLI
 * @param {Object} options - the run options passed to the CLI, namely the project and token
 */
async function init(options) {
    perf.log('start runner init');
    const { project, lightweightMode, useChromeLauncher, mode, disableSockets } = options;
    const featureFlagsReady = featureFlags.fetch();
    const socketConnected = initSocketServices(project, {
        disableResults: disableSockets || Boolean(lightweightMode && lightweightMode.disableResults && (useChromeLauncher || mode !== 'extension')),
        disableRemoteStep: disableSockets || Boolean(lightweightMode && lightweightMode.disableRemoteStep),
    });

    featureFlagsReady.catch(() => {}); // suppress unhandled rejection
    Promise.resolve(socketConnected).catch(() => {}); // only sometimes a promise

    const { authData, editorConfig, companyByProjectId, projectById, branchName, allGrids } = await initializeUserWithAuth(options);

    validateOptionsForCompany(options, companyByProjectId);
    await Promise.all([featureFlagsReady, socketConnected]);

    perf.log('after featureFlagsReady and socketConnected');
    setSystemInfo(options, editorConfig);
    setCompany(options, companyByProjectId);
    setProject(options, projectById);
    setBranch(options, branchName);
    setAllGrids(options, allGrids);
    setAuthData(options, authData);

    if (!(options.lightweightMode && options.lightweightMode.disableLabs)) {
        await labFeaturesService.loadLabFeatures(projectById.id, companyByProjectId.activePlan);
    }

    if (options.lightweightMode && options.lightweightMode.type === 'turboMode' && (featureFlags.flags.highSpeedMode.getValue() === 'disabled' || options.company.planType === 'free')) {
        delete options.lightweightMode;
    }

    if (options.lightweightMode && options.lightweightMode.type === 'turboMode') {
        // eslint-disable-next-line max-len
        console.log('\nTurbo mode will ignore step delays. Test artifacts like screenshots and logs will only be saved for failed runs. For more information see our docs: https://help.testim.io/docs/turbo-mode');
    }

    gridService.keepAlive.start(project);
    analyticsIdentify(project);
    await setMockNetworkRules(options);
    await setGrid(options);
    showFreeGridRunWarningIfNeeded(options);

    const branchToUse = branchService.getCurrentBranch();
    reporter.setOptions(options, branchToUse);
}

module.exports = {
    run: runRunner,
    init,
};

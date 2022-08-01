'use strict';

const { ROLLOUT_KEY, IS_ON_PREM, GATEWAY_URL } = require('./config');
const logger = require('./logger').getLogger('FeatureFlagsService');
const Promise = require('bluebird');
const Rox = require('rox-node');

// IS_UNIT_TEST = disable rollout if code run in unit test mode to ignore mocha process stuck on running
const USE_FEATURE_FLAGS = !IS_ON_PREM && !process.env.IS_UNIT_TEST && !GATEWAY_URL;

const FORCE_FETCH_TIMEOUT_MS = 20000; // rollout sometimes takes up to 15 seconds to load
const SEC_IN_DAY = 60 * 60 * 24;

const LAB_FEATURE_FLAG_VALUES = ['labs', 'disabled', 'enabled'];

class LabFeatureFlag extends Rox.Variant {
    constructor(initialValue = 'disabled') {
        super(initialValue, LAB_FEATURE_FLAG_VALUES);
    }

    getValue() {
        const value = super.getValue();
        if (!LAB_FEATURE_FLAG_VALUES.includes(value)) {
            logger.warn('unexpected value for lab feature flag. Falling back to value "labs"', { featureFlagName: this.name, value });
            return 'labs';
        }

        return value;
    }
}

class FeatureFlagsService {
    constructor() {
        this.flags = {
            useNewWSCLI: new Rox.Flag(),
            disableEdgeVisibilityChecks: new Rox.Flag(),
            useSafariWebdriverVisibilityChecks: new Rox.Flag(),
            useClickimVisibilityChecks: new Rox.Flag(),
            useIEWebdriverVisibilityChecks: new Rox.Flag(),
            runGetElementCodeInAut: new Rox.Flag(),
            enableFrameSwitchOptimization: new Rox.Flag(),
            maximumJsResultSize: new Rox.Configuration(2000 * 1024),
            skipFileInputClicks: new Rox.Flag(),
            errorMessageOnBadNetwork: new Rox.Flag(true),
            warnOnBadNetwork: new Rox.Flag(false),
            overrideAzureStorageUrl: new Rox.Flag(),
            useJsInputCodeInSafari: new Rox.Flag(),
            useJsInputCodeInFirefox: new Rox.Flag(),
            autoSaveDownloadFileFireFox: new Rox.Flag(true),
            safariSelectOptionDispatchEventOnSelectElement: new Rox.Flag(true),
            experimentalPreCodeCompilation: new Rox.Flag(true),
            /** Enables using top level await inside custom actions for non-IE browsers */
            experimentalAsyncCustomCode: new Rox.Flag(),
            useSameBrowserForMultiTests: new LabFeatureFlag('labs'),
            highSpeedMode: new LabFeatureFlag(),
            usePortedHtml5DragDrop: new Rox.Flag(),
            testNamesToBeforeSuiteHook: new Rox.Flag(),
            addCustomCapabilities: new Rox.Variant('{}'),
            enableWorkerThreadsCliCodeExecution: new Rox.Flag(true),
            LTNetworkCapabilities: new Rox.Flag(),
            downloadToBase64: new Rox.Flag(),
        };
        Rox.register('default', this.flags);
    }

    setProjectId(projectId) {
        Rox.setCustomStringProperty('projectId', projectId);
    }

    setCompanyId(companyId) {
        Rox.setCustomStringProperty('companyId', companyId);
    }

    setPlanType(planType) {
        Rox.setCustomStringProperty('planType', planType);
    }

    setIsPOC(isPOC) {
        Rox.setCustomBooleanProperty('isPOC', isPOC);
    }
    setIsStartUp(isStartUp) {
        Rox.setCustomBooleanProperty('isStartUp', isStartUp);
    }

    setRunnerMode(mode) {
        Rox.setCustomStringProperty('runnerMode', mode);
    }

    fetch() {
        if (!USE_FEATURE_FLAGS) {
            return Promise.resolve();
        }
        const opts = {
            fetchIntervalInSec: SEC_IN_DAY, // we don't actually want to refresh feature flags in the CLI,
            disableNetworkFetch: false,
        };


        if (global.ProxyAgent) {
            const agent = new global.ProxyAgent(global.proxyUri);
            opts.httpsAgent = agent;
            opts.httpAgent = agent;
        }

        return Promise.resolve(Rox.setup(ROLLOUT_KEY, opts))
            .timeout(FORCE_FETCH_TIMEOUT_MS).catch(err => logger.error('failed to get feature flag status', err));
    }
}

module.exports = new FeatureFlagsService();

'use strict';

module.exports = {
    timeoutMessages: {
        GET_BROWSER_TIMEOUT_MSG: 'get-browser-timeout',
        TEST_START_TIMEOUT_MSG: 'test-start-timeout',
        TEST_COMPLETE_TIMEOUT_MSG: 'test-complete-timeout',
    },
    testRunStatus: {
        COMPLETED: 'completed',
        RUNNING: 'running',
    },
    runnerTestStatus: {
        PASSED: 'PASSED',
        FAILED: 'FAILED',
        ABORTED: 'ABORTED',
        SKIPPED: 'SKIPPED',
        QUEUED: 'QUEUED',
    },
    testStatus: {
        DRAFT: 'draft',
        EVALUATING: 'evaluating',
        ACTIVE: 'active',
        QUARANTINE: 'quarantine',
    },
    gridMessages: {
        NOT_FOUND: 'The specified grid is not available',
        UNKNOWN: "Test couldn't get browser - unknown error",
    },
    mobileWeb: {
        MOBILE_WEB_REMOTE_RUN_HEADER_SPACING: 50,
    },
    test: {
        HIDDEN_PARAM: 'TST_HIDDEN_PARAM',
    },
    socketEventTypes: {
        TEST_RESULT_CREATED: 'test-result-created',
        TEST_RESULT_UPDATED: 'test-result-updated',
        REMOTE_STEP_SAVED: 'remote-step-saved',
    },
    CLI_MODE: {
        EXTENSION: 'extension',
        SELENIUM: 'selenium',
    },
    sessionType: {
        CODELESS: 'codeless',
        CODEFUL: 'codeful',
    },
    gridTypes: {
        TESTIM_ENTERPRISE: 'testimEnterprise',
        TESTIM: 'testim',
        LAMBDATEST: 'testimLambdaTest',
        DEVICE_FARM: 'testimDF',
        HYBRID: 'testimHybrid',
        BROWSERSTACK: 'browserstack',
        SAUCELABS: 'saucelabs',
    },
    stepResult: {
        SETUP_TIMEOUT: 'setup-timeout',
        NETWORK_ERROR: 'network-error',
        GRID_ERROR: 'grid-error',
        SELENIUM_ERROR: 'selenium-error',
        BROWSER_CLOSED: 'browser-closed',
    },
};

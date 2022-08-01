'user strict';

const constants = require('../commons/constants');
const logger = require('../commons/logger').getLogger('debug-reporter');

const MASK_OPTIONS = {
    token: undefined,
    userParamsData: undefined,
    projectData: undefined,
    allGrids: undefined,
    gridData: undefined,
    awsAccessKeyId: undefined,
    awsSecretAccessKey: undefined,
    runParams: undefined,
    perfecto: undefined,
    testobjectSauce: undefined,
};

const DebugReporter = function (options) {
    this.options = options;
};

DebugReporter.prototype.onTestStarted = function (test, workerId) {
    logger.info('Test Started', { testId: test.testId, testName: test.name, resultId: test.resultId, workerId });
};

DebugReporter.prototype.onTestFinished = function (test, workerId) {
    const gridData = this.options.gridData || {};
    const provider = gridData.provider;
    const host = gridData.host;
    const gridId = gridData.gridId;
    const gridType = gridData.type;
    const failedGetBrowserAttempts = gridData.failedGetBrowserAttempts;
    logger.info('Test Finished', {
        testId: test.testId,
        testName: test.name,
        resultId: test.resultId,
        success: test.success,
        duration: test.duration,
        browser: this.options.browser,
        companyId: this.options.company.companyId,
        grid: { provider, host, failedGetBrowserAttempts, id: gridId, type: gridType },
        workerId,
    });
};

function stripTokenFromConsoleArguments(args) {
    let indexOfTokenFlag = args.indexOf('--token');
    if (indexOfTokenFlag === -1) {
        indexOfTokenFlag = args.indexOf('--t');
    }

    if (indexOfTokenFlag !== -1) {
        try {
            const newArgs = args.slice();
            newArgs.splice(indexOfTokenFlag, 2);

            return newArgs;
        } catch (e) {

        }
    }

    return args;
}

DebugReporter.prototype.onTestPlanStarted = function (beforeTests, tests, afterTests, testPlanName, executionId, isAnonymous, configName) {
    const args = stripTokenFromConsoleArguments(process.argv);

    logger.info('Test Plan Started', { executionId, testPlanName, isAnonymous, configName, options: Object.assign({}, this.options, MASK_OPTIONS), args });
};

DebugReporter.prototype.onTestPlanFinished = function (testResults, testPlanName, duration, executionId, isAnonymous) {
    const passed = Object.keys(testResults).filter(resultId => testResults[resultId].status === constants.runnerTestStatus.PASSED).length;
    const failed = Object.keys(testResults).length - passed;

    logger.info('Test Plan Finished', { isAnonymous, passed, failed, testPlanName, options: Object.assign({}, this.options, MASK_OPTIONS), duration, executionId });
};

module.exports = DebugReporter;

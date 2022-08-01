'use strict';

const utils = require('../utils');
const constants = require('../commons/constants');

const isFailedTest = (testResult) => {
    const { status, sessionType, success } = testResult;
    return status === constants.runnerTestStatus.FAILED || (sessionType === constants.sessionType.CODEFUL && success === false);
};

const isAbortedTest = (testResult) => {
    const { status } = testResult;
    return status === constants.runnerTestStatus.ABORTED;
};

const isPassedTest = (testResult) => {
    const { status, sessionType, success } = testResult;
    return status === constants.runnerTestStatus.PASSED || (sessionType === constants.sessionType.CODEFUL && success === true);
};

const isSkippedTest = (testResult) => testResult.runnerStatus === constants.runnerTestStatus.SKIPPED;

const isContainer = (testResult, isCodeMode) => {
    if (!isCodeMode) {
        return false;
    }
    return !testResult.runConfig;
};

const isEvaluatingTest = (testResult) => testResult.testStatus === constants.testStatus.EVALUATING;

const getSkippedCount = (testResults, options) => Object.values(testResults).filter(testResult => isSkippedTest(testResult) && utils.isQuarantineAndNotRemoteRun(testResult, options)).length;

const getFailureEvaluatingCount = (testResults) => Object.values(testResults).filter(testResult => isFailedTest(testResult) && isEvaluatingTest(testResult)).length;

const getFailedTests = (testResults, isCodeMode) => Object.values(testResults).filter(testResult => isFailedTest(testResult) && !isContainer(testResult, isCodeMode));

const getPassedTests = (testResults, isCodeMode) => Object.values(testResults).filter(testResult => isPassedTest(testResult) && !isContainer(testResult, isCodeMode));

const getAbortedTests = (testResults, isCodeMode) => Object.values(testResults).filter(testResult => isAbortedTest(testResult) && !isContainer(testResult, isCodeMode));

module.exports = {
    isFailedTest,
    isAbortedTest,
    isPassedTest,
    isEvaluatingTest,
    isSkippedTest,

    getFailedTests,
    getPassedTests,
    getAbortedTests,
    getSkippedCount,
    getFailureEvaluatingCount,
};

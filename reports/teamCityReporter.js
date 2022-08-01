/* eslint-disable no-console */
const logger = require('../commons/logger').getLogger('team-city-reporter');

function tidy(text) {
    if (!text) {
        return '';
    }
    return text
        .replace(/\|/g, '||')
        .replace(/'/g, "|'")
        .replace(/\n/g, '|n')
        .replace(/\r/g, '|r')
        .replace(/\u0085/g, '|x')
        .replace(/\u2028/g, '|l')
        .replace(/\u2029/g, '|p')
        .replace(/\[/g, '|[')
        .replace(/\]/g, '|]');
}

class TeamCityReporter {
    constructor(options) {
        this.options = options;
    }

    getPrintName(test) {
        const testConfig = test.config || {};
        const testDataNumber = typeof testConfig.testDataTotal === 'number' ? ` - ${testConfig.testDataIndex} / ${testConfig.testDataTotal} Data set` : '';
        const teamCityName = `${test.name} (${test.testId})${testDataNumber}`;
        return tidy(teamCityName);
    }

    onTestStarted(test, workerId, isRerun, isCodeMode, resultId) {
        if (isRerun) {
            logger.debug('skip report test started because is rerun');
            return;
        }
        const name = this.getPrintName(test);
        console.log(`##teamcity[testStarted name='${name}' captureStandardOutput='true' flowId='${resultId}']`);
    }

    onTestFailed(test, failureReason, testurl, testId, isRerun, resultId) {
        if (isRerun) {
            logger.debug('skip report test failed because is rerun');
            return;
        }
        const name = this.getPrintName(test);
        console.log(`##teamcity[testFailed name='${name}' message='${tidy(failureReason)}' details='${tidy(testurl)}' flowId='${resultId}']`);
    }

    onTestFinished(test, workerId, isRerun) {
        if (isRerun) {
            logger.debug('skip report test finished because is rerun');
            return;
        }
        const name = this.getPrintName(test);
        console.log(`##teamcity[testFinished name='${name}' duration='${test.duration}' flowId='${test.resultId}']`);
    }

    onTestIgnored(workerId, test, message = 'ignore') {
        const name = this.getPrintName(test);
        console.log(`##teamcity[testIgnored name='${name}' message='${tidy(message)}']`);
    }

    onTestPlanStarted(beforeTests, tests, afterTests, testPlanName) {
        console.log(`##teamcity[testSuiteStarted name='${tidy(testPlanName)}']`);
    }

    onTestPlanFinished(testResults, testPlanName) {
        console.log(`##teamcity[testSuiteFinished name='${tidy(testPlanName)}']`);
    }
}

module.exports = TeamCityReporter;

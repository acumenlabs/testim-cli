/* eslint-disable no-console */
const chalk = require('chalk');
const _ = require('lodash');

const utils = require('../utils.js');
const constants = require('../commons/constants');
const featureAvailabilityService = require('../commons/featureAvailabilityService');
const { getAbortedTests, getFailedTests, getPassedTests, getFailureEvaluatingCount, getSkippedCount } = require('./reporterUtils');

const colorize = { success: chalk.green, warn: chalk.yellow, error: chalk.red };

class ConsoleReporter {
    constructor(options, branchToUse) {
        this.options = options;
        this.config = {
            showWorkerNames: options.parallel > 1, // we show worker names when there is more than one worker
        };
        this.branchToUse = branchToUse;
    }

    toWorkerIdPrefix(workerId) {
        return this.config.showWorkerNames ? `W:${workerId}` : '';
    }

    printWorkerDivider() {
        console.log('-'.repeat(process.stdout.columns || 83));
    }

    onTestStarted(test, workerId, isRerun, isCodeMode) {
        const type = isCodeMode ? 'File' : 'Test';
        const testIdLabel = test.isTestsContainer ? '' : `(${test.testId})`;
        const testUrlLabel = test.isTestsContainer ? '' : `url: ${chalk.underline(utils.getTestUrl(this.options.editorUrl, this.options.project, test.testId, test.resultId, this.branchToUse))}`;
        console.log(this.toWorkerIdPrefix(workerId), `${type} "${test.name}" started ${testIdLabel} ${testUrlLabel}`.trim());
    }

    onTestFinished(test, workerId, isRerun, isCodeMode) {
        if (isCodeMode) {
            // ignore print of file run done
            return;
        }
        const testStatus = test.success ? constants.runnerTestStatus.PASSED : constants.runnerTestStatus.FAILED;
        const testIdLabel = test.isTestsContainer ? ' ' : `(${test.testId})`;
        const color = colorize[test.success ? 'success' : 'error'];

        console.log(color(this.toWorkerIdPrefix(workerId), `Test "${test.name}" finished status: ${testStatus} ${testIdLabel} duration: ${utils.getDuration(test.duration)}`));
    }

    printAllFailedTests(failedTests) {
        if (failedTests.length > 0) {
            const failedTestStrings = failedTests.map(failedTest => {
                const testUrl = utils.getTestUrl(this.options.editorUrl, this.options.project, failedTest.testId, failedTest.resultId, this.branchToUse);
                if (failedTest.isTestsContainer) {
                    return failedTest.name; // no working url
                }
                return `${failedTest.name} : ${testUrl}`;
            });
            console.log(colorize.error('Failed runs are:'));
            console.log(colorize.error(failedTestStrings.join('\n\r')));
        }
    }

    onTestPlanFinished(testResults, testPlanName, duration, executionId, isAnonymous, isCodeMode) {
        const failedTests = getFailedTests(testResults, isCodeMode);
        const passedTests = getPassedTests(testResults, isCodeMode);
        const abortedTests = getAbortedTests(testResults, isCodeMode);

        const passed = passedTests.length;
        const aborted = abortedTests.length;
        let failed = failedTests.length;
        let failedEvaluatingString = '';
        let skippedString = '';
        if (featureAvailabilityService.isTestStatusEnabled) {
            const failureEvaluatingCount = getFailureEvaluatingCount(testResults);
            failedEvaluatingString = ` FAILED-EVALUATING: ${failureEvaluatingCount}`;
            failed -= failureEvaluatingCount;

            const skippedCount = getSkippedCount(testResults, this.options);
            skippedString = ` SKIPPED: ${skippedCount}`;
        }

        const planName = this.buildTestPlanName(isAnonymous, testPlanName, isCodeMode);

        let message;
        const color = colorize[failed ? 'error' : 'success'];

        if (isCodeMode || planName.trim() === '' || planName.trim() === 'Anonymous') {
            message = `Tests completed. PASSED: ${passed} FAILED: ${failed}${failedEvaluatingString} ABORTED: ${aborted}${skippedString} Duration: ${utils.getDuration(duration)} (Execution ID: ${executionId})`;
        } else {
            message = `Test plan${planName} completed PASSED: ${passed} FAILED: ${failed}${failedEvaluatingString} ABORTED: ${aborted}${skippedString} Duration: ${utils.getDuration(duration)} (${executionId})`;
        }

        this.printWorkerDivider();
        console.log(color(message));
        this.printWorkerDivider();

        this.printAllFailedTests(failedTests);
    }

    buildTestPlanName(isAnonymous, testPlanName, isCodeMode) {
        if (isCodeMode) {
            return '';
        }
        const suitesString = _.isEmpty(this.options.suites) ? '' : `Suite: ${this.options.suites}`;
        const labelsString = _.isEmpty(this.options.label) ? '' : `Label: ${this.options.label}`;
        const namesString = _.isEmpty(this.options.name) ? '' : `Name: ${this.options.name}`;
        const testIdString = _.isEmpty(this.options.testId) ? '' : `Test Id: ${this.options.testId}`;
        return isAnonymous ? ` anonymous (${namesString}${namesString && labelsString ? ', ' : ''}${labelsString}${suitesString && labelsString ? ', ' : ''}${suitesString}${testIdString && suitesString ? ', ' : ''}${testIdString})` : ` '${testPlanName}'`;
    }

    onTestPlanStarted(beforeTests, tests, afterTests, testPlanName, executionId, isAnonymous, configName, isCodeMode) {
        const writeTestList = (testList) => {
            testList.forEach((test, index) => {
                const ds = test.testData && test.testData.index ? `- ${test.testData.index} / ${test.testData.total} Data set` : '';
                const testIdLabel = isCodeMode ? '' : `(${test.testId})`;
                console.log('\t', index + 1, ':', `${test.name}${utils.isQuarantineAndNotRemoteRun(test, this.options) ? '-quarantine' : ''}`, testIdLabel, ds);
            });
        };
        const configString = configName ? `config '${configName}'` : 'default configs';

        if (isCodeMode) {
            console.log(`Run test plan, Project: ${this.options.project} (Execution ID: ${executionId}):`);
        } else {
            console.log(`Run${this.buildTestPlanName(isAnonymous, testPlanName)} test plan with ${configString}, Project: ${this.options.project}, Branch: ${this.branchToUse} (${executionId})`);
        }
        this.printWorkerDivider();

        if (beforeTests.length > 0) {
            console.log('Before all:');
            writeTestList(beforeTests);
        }

        const listName = isCodeMode ? 'File list:' : 'Test list:';
        console.log(listName);
        writeTestList(tests);

        if (afterTests.length > 0) {
            console.log('After all:');
            writeTestList(afterTests);
        }
        this.printWorkerDivider();
    }

    onGetSlot(workerId, browser) {
        const gridNameOrId = this.options.grid || this.options.gridId;
        if (gridNameOrId) {
            console.log(this.toWorkerIdPrefix(workerId), `Get ${chalk.underline(browser)} slot from ${chalk.underline(gridNameOrId)}`);
        }
    }

    onGetSession(workerId, testName, mode) {
        console.log(this.toWorkerIdPrefix(workerId), `Get browser to run ${chalk.underline(testName)}`);
    }

    onWaitToTestStart(workerId) {
        console.log(this.toWorkerIdPrefix(workerId), 'Wait for test start');
    }

    onWaitToTestComplete(workerId, isCodeMode, debuggerAddress) {
        const type = isCodeMode ? 'file' : 'test';
        console.log(this.toWorkerIdPrefix(workerId), `Wait for ${type} complete`);
        if (debuggerAddress && isCodeMode) {
            // TODO(Benji) decide with Amitai what we want to do with this
            console.log(this.toWorkerIdPrefix(workerId), `Chrome Debugger available at ${debuggerAddress}`);
        }
    }

    onGetBrowserFailure(workerId, projectId, attempt) {
        if (attempt !== 2) {
            return; // we want to try 2 times before showing the message once
        }
        // heuristic, show the message on the same attempt
        const gridNameOrId = this.options.grid || this.options.gridId;
        if (gridNameOrId) { // if the user passes a grid or a gridId - show those
            console.log(colorize.warn(this.toWorkerIdPrefix(workerId), `It is taking us some time to get a browser from the grid ${gridNameOrId}`));
        } else if (this.options.usingLocalChromeDriver) {
            console.log(colorize.warn(this.toWorkerIdPrefix(workerId), 'We are having issues starting ChromeDriver for you locally'));
        } else if (this.options.host) {
            console.log(colorize.warn(this.toWorkerIdPrefix(workerId), `We are having issues reaching your Selenium grid at ${this.options.host}:${this.options.port || 4444}`));
        } else {
            // in other cases - print nothing
        }
    }
}

module.exports = ConsoleReporter;

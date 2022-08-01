/* eslint-disable no-console */

'use strict';

const xml2js = require('xml2js');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const utils = require('../utils.js');
const {
    isAbortedTest, isSkippedTest, getFailedTests, isFailedTest, getFailureEvaluatingCount, getSkippedCount, getAbortedTests,
} = require('./reporterUtils');
const featureFlags = require('../commons/featureFlags.js');
const featureAvailabilityService = require('../commons/featureAvailabilityService');

class JunitReporter {
    constructor(options, branchToUse) {
        this.options = options;
        this.classname = 'testim.io.test';
        if (options.reportFileClassname) {
            this.classname = options.reportFileClassname;
        }
        if (options.reportFileClassname === true) {
            this.classname = ''; // specific case for passing empty string which makes junit-viewer display test name
        }

        this.branchToUse = branchToUse;
    }

    async createResultsReport(testResults) {
        const reportFile = this.options.reportFile;
        const projectId = this.options.project;

        const reportText = await report(this.options.editorUrl, testResults, projectId, this.branchToUse, this.classname, this.options);
        if (!reportFile) {
            return undefined;
        }
        try {
            await fs.writeFileAsync(reportFile, reportText);
            console.log('JUnit XML file saved to', reportFile);
            return testResults;
        } catch (err) {
            console.error('could not save report file', reportFile, err);
            return testResults;
        }
    }

    onAllTestPlansFinished(testPlanResults) {
        return this.createResultsReport(testPlanResults);
    }
}

function getPrintName(testResult) {
    const testData = testResult.testData || {};
    const testDataNumber = typeof testData.total === 'number' ? ` - ${testData.index} / ${testData.total} Data set` : '';
    return `${testResult.name}${testDataNumber}`;
}

async function report(editorUrl, testPlanResults, projectId, branch, classname, options) {
    function createTestCaseObject(testResult, projectId) {
        const testResultUrl = utils.getTestUrl(editorUrl, projectId, testResult.testId, testResult.resultId, branch);
        const testResultObject = {
            $: {
                name: getPrintName(testResult),
                classname,
                time: utils.getDurationSec(testResult.duration),
            },
        };

        testResultObject.$.ownedBy = testResult.testOwnerName;
        testResultObject.$.ownerEmail = testResult.testOwnerEmail;

        if (isFailedTest(testResult) || isAbortedTest(testResult)) {
            const prefixMessage = `Step Failed: ${testResult.failureReason || testResult.reason}`;
            const message = isFailedTest(testResult) ? `${prefixMessage} More info at: ${testResultUrl}` : prefixMessage;
            testResultObject.failure = {
                $: {
                    message,
                },
            };
        }
        if (isSkippedTest(testResult) && utils.isQuarantineAndNotRemoteRun(testResult, options) && featureAvailabilityService.isTestStatusEnabled) {
            testResultObject.skipped = {};
        }
        testResultObject['system-out'] = testResultUrl;
        return testResultObject;
    }

    function createTestSuiteObject(testPlanResult) {
        const { results, testPlanName, configName } = testPlanResult;
        const testResults = results || {};
        const suiteName = configName && testPlanName ? `${testPlanName} with config '${configName}'` : testPlanName;
        const testSuiteAttributes = {
            name: suiteName || 'selenium run',
            tests: getTestCount(testResults),
            failure: getFailedCount(testResults),
            timestamp: getSuiteTimestamp(testPlanResults),
        };
        if (featureAvailabilityService.isTestStatusEnabled) {
            testSuiteAttributes.skipped = getSkippedCount(testResults, options);
            const failureEvaluatingCount = getFailureEvaluatingCount(testResults);
            testSuiteAttributes.failure -= failureEvaluatingCount;
            testSuiteAttributes['failure-evaluating'] = failureEvaluatingCount;
        }
        return {
            $: testSuiteAttributes,
            testcase: Object.keys(testResults).map(resultId => createTestCaseObject(testResults[resultId], projectId)),
        };
    }

    function getSuiteTimestamp(testResults) {
        const startTimeArr = Object.keys(testResults).map(resultId => testResults[resultId].startTime);
        const minTestStartTime = Math.min.apply(null, startTimeArr);
        return minTestStartTime ? new Date(minTestStartTime).toISOString() : new Date().toISOString();
    }

    function getTestCount(testResults) {
        return Object.keys(testResults).length;
    }

    function getFailedCount(testResults) {
        return getFailedTests(testResults).length + getAbortedTests(testResults).length;
    }

    const testResultObject = {
        testsuites: {
            testsuite: testPlanResults.map(testPlanResult => createTestSuiteObject(testPlanResult)),
        },
    };


    try {
        const builder = new xml2js.Builder();
        const jUnitXmlReporter = builder.buildObject(testResultObject);
        return Promise.resolve(jUnitXmlReporter);
    } catch (err) {
        return Promise.resolve(createErrorjUnitReporter(err));
    }
}

function createErrorjUnitReporter(err) {
    const builder = new xml2js.Builder();
    const errorJunitObject = {
        testsuites: {
            testsuite: {
                $: {
                    name: 'selenium run',
                    tests: 1,
                    failure: 1,
                    timestamp: Date.now(),
                },
                testcase: {
                    $: {
                        name: 'junit reporter generator failed',
                        classname: 'testim.io.jUnitXmlReporter',
                    },
                    error: {
                        $: {
                            message: err.message,
                        },
                    },
                },
            },
        },
    };
    return builder.buildObject(errorJunitObject);
}

module.exports = JunitReporter;

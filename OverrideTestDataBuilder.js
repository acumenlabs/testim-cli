/* eslint-disable no-console */

'use strict';

const utils = require('./utils.js');
const _ = require('lodash');
const logger = require('./commons/logger').getLogger('override-test-data-builder');

class OverrideTestDataBuilder {
    constructor(params, testInfoList, projectId) {
        this.params = params;
        this.testInfoList = testInfoList;
        this.projectId = projectId;
    }

    isObjectNotArray(param) {
        return _.isObject(param) && !Array.isArray(param);
    }

    isArrayOfObjects(params) {
        return Array.isArray(params) && params.filter(param => !this.isObjectNotArray(param)).length === 0;
    }

    overrideTestData() {
        const { params, projectId } = this;
        if (this.isObjectNotArray(params) && typeof params.overrideTestData !== 'undefined') {
            if (this.isObjectNotArray(params.overrideTestData) && !_.isEmpty(params.overrideTestData)) {
                Object.keys(params.overrideTestData).forEach(testName => this.overrideSingeTest(testName, params.overrideTestData[testName]));
                delete params.overrideTestData;
            } else {
                logger.error('invalid overrideTestData', { overrideTestData: params.overrideTestData, projectId });
            }
        }
        if (this.isObjectNotArray(params) && typeof params.overrideAllTestsData !== 'undefined') {
            if (_.isObject(params.overrideAllTestsData) && !_.isEmpty(params.overrideAllTestsData)) {
                const testNames = this.testInfoList.map(test => test.name);
                testNames.forEach(testName => this.overrideSingeTest(testName, params.overrideAllTestsData));
                delete params.overrideAllTestsData;
            } else {
                logger.error('invalid overrideAllTestsData', { overrideAllTestsData: params.overrideAllTestsData, projectId });
            }
        }

        return this.testInfoList;
    }

    overrideSingeTest(testName, testOverrideTestData) {
        const { projectId } = this;
        if (this.isObjectNotArray(testOverrideTestData) || this.isArrayOfObjects(testOverrideTestData)) {
            this.replaceAndCreateOverrideTestData(testName, testOverrideTestData);
            return;
        }
        logger.error('skip override test data to test name', { testName, projectId });
        console.error(`Invalid override test data provided to test '${testName}'`);
    }

    replaceAndCreateOverrideTestData(testName, testOverrideTestData) {
        const uniqueMatchIds = this.mapTestListToUniqueId(testName);
        if (uniqueMatchIds.length === 0) {
            return undefined;
        }
        return this.createNewTestPerOverrideTestData(uniqueMatchIds, testOverrideTestData);
    }

    mapTestListToUniqueId(testName) {
        const { testInfoList } = this;
        return _(testInfoList).map(test => {
            if (test.name.toLowerCase() === testName.toLowerCase()) {
                return this.generateTestUniqId(test);
            }
            return undefined;
        }).filter(Boolean).uniq()
            .value();
    }

    createNewTestPerOverrideTestData(uniqueMatchIds, testOverrideTestData) {
        const { testInfoList } = this;
        return _.uniq(uniqueMatchIds).map(uniqTestId => {
            const testUniqIds = testInfoList.map(test => this.generateTestUniqId(test));
            const firstIndex = _.findIndex(testUniqIds, id => id === uniqTestId);
            const lastIndex = _.findLastIndex(testUniqIds, id => id === uniqTestId);
            const currentTest = testInfoList[firstIndex];
            const newTestDataItems = this.createNewTestItems(currentTest, testOverrideTestData);
            return testInfoList.splice(firstIndex, (lastIndex - firstIndex) + 1, ...newTestDataItems);
        });
    }

    createNewTestItems(currentTest, testOverrideTestData) {
        return ([].concat(testOverrideTestData)).map((newTestData, index) => {
            const testResultId = utils.guid();
            return Object.assign({}, currentTest, {
                resultId: testResultId,
                testData: {
                    value: newTestData,
                    index: index + 1,
                    total: testOverrideTestData.length || 1,
                },
            });
        });
    }

    getTestType(test) {
        if (test.isBeforeTestPlan) {
            return 'before';
        }
        if (test.isAfterTestPlan) {
            return 'after';
        }
        return 'test';
    }

    generateTestUniqId(test) {
        return `${test.testId}:${test.testConfig.id}:${this.getTestType(test)}`;
    }
}

module.exports = OverrideTestDataBuilder;

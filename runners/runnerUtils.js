'use strict';

const _ = require('lodash');
const path = require('path');
const utils = require('../utils.js');
const analytics = require('../commons/testimAnalytics');
const { ArgError } = require('../errors');


async function getSuite(options, branchToUse) {
    if (options.lightweightMode && options.lightweightMode.onlyTestIdsNoSuite && options.testId) {
        return { tests: [options.testId.map(testId => ({ testId, testConfig: { }, resultId: utils.guid() }))] };
    }
    // local code test
    if (options.files.length > 0) {
        const { buildCodeTests } = require('./buildCodeTests');
        let webpackConfig = {};
        if (options.webpackConfig) {
            const webpackConfigPath = path.join(process.cwd(), options.webpackConfig);
            webpackConfig = require(webpackConfigPath);
        }

        return buildCodeTests(options.files, webpackConfig, { baseUrl: options.baseUrl });
    }
    // regular test
    const servicesApi = require('../commons/testimServicesApi');
    return await servicesApi.getSuiteTestList({
        projectId: options.project,
        labels: options.label,
        testIds: options.testId,
        testNames: options.name,
        testConfigNames: options.testConfigNames,
        suiteNames: options.suites,
        suiteIds: options.suiteIds,
        branch: branchToUse,
        rerunFailedByRunId: options.rerunFailedByRunId,
        testConfigIds: options.testConfigIds,
        intersections: options.intersections,
    });
}


function calcTestResultStatus(tests) {
    const total = Object.keys(tests).length;
    const passed = Object.keys(tests).reduce((count, resultId) => count + (tests[resultId].success === true ? 1 : 0), 0);
    return total === passed;
}



async function validateConfig(options, testList) {
    const supportedBrowsers = options.mode === 'extension' ? [
        'edge-chromium', 'chrome',
    ] : [
        'ie11', 'firefox', 'chrome', 'edge', 'edge-chromium', 'safari', 'safari technology preview', 'browser', 'android', 'ios', 'iphone', 'ipad',
    ];
    const diff = _.difference(utils.getUniqBrowsers(options, testList), supportedBrowsers);

    if (diff.length > 0) {
        analytics.trackWithCIUser('invalid-config-run', {
            browser: diff.join(', '),
            mode: 'runner',
        });
        throw new ArgError(`browser type <${diff}> is not supported in ${options.mode} mode.`);
    }

    return testList;
}

module.exports = {
    getSuite,
    calcTestResultStatus,
    validateConfig,
};

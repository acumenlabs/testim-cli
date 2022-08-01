const Promise = require('bluebird');
const _ = require('lodash');
const localRunnerCache = require('./runnerFileCache');
const servicesApi = require('./testimServicesApi.js');


const TEN_HOURS = 1000 * 60 * 60 * 10;

async function preloadTests(options) {
    if (!Array.isArray(options.testId) || !options.testId.length) {
        return {};
    }
    const opts = {
        branch: options.branch,
        projectId: options.project,
    };
    return await localRunnerCache.memoize(async () => {
        const results = await Promise.map(options.testId, testId => servicesApi.loadTest({ ...opts, testId }), { concurrency: 2 });
        return _.keyBy(results, 'testData.id');
    }, 'loadTests', TEN_HOURS, [opts, options.testId])();
}


module.exports = {
    preloadTests,
};

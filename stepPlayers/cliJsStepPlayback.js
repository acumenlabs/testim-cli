"use strict";

const service = require('../agent/routers/cliJsCode/service');
const Promise = require('bluebird');
const featureFlags = require('../commons/featureFlags');
const logger = require('../commons/logger').getLogger('cli-js-step-playback');

function isExceedingMaxResultSize(data, project) {
    try {
        const shouldEnforceMaxSize = project.defaults.enforceMaximumJsResultSize;
        const maximumJsResultSize = featureFlags.flags.maximumJsResultSize.getValue();
        const dataSizeExceeded = JSON.stringify(data).length > maximumJsResultSize;
        if(!shouldEnforceMaxSize) {
            return false;
        }
        return dataSizeExceeded;
    } catch (e) {
        return false;
    }
}

module.exports.run = (browser, step, projectData) => {
    const {code, stepId, incomingParams, context, testResultId, retryIndex, stepResultId, runTimeout, fileDataUrl, s3filepath} = step.data;
    return service.runCodeWithPackages(code, stepId, incomingParams, context, testResultId, retryIndex, stepResultId, runTimeout, fileDataUrl, s3filepath)
        .then(data => {
            if (data && isExceedingMaxResultSize({result: data.result, tstConsoleLogs: data.tstConsoleLogs}, projectData)) {
                return {
                    code: 'js-result-max-size-exceeded',
                    success: false,
                };
            }
            return {data, success: true};
        })
        .catch(Promise.TimeoutError, () => Promise.reject(new Error("Timeout while running action")));
};

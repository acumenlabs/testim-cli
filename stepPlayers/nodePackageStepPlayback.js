"use strict";

const service = require('../agent/routers/cliJsCode/service');
const Promise = require('bluebird');
const {NpmPackageError} = require('../errors');

module.exports.run = (browser, step) => {
    const {stepId, testResultId, retryIndex, stepResultId, packageData, timeout} = step.data;
    return service.installPackage(stepId, testResultId, retryIndex, packageData, stepResultId, timeout)
        .then(data => ({data, success: true}))
        .catch(NpmPackageError, err => {
            return {
                success: false,
                code: "invalid-node-package",
                message: err.message
            };
        })
        .catch(Promise.TimeoutError, () => {
            return {
                success: false,
                code: "timeout"
            };
        });
};

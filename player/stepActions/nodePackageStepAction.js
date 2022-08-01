"use strict";

const StepAction = require('./stepAction');
const Promise = require('bluebird');
const {NpmPackageError} = require('../../errors');

const service = require('../../agent/routers/cliJsCode/service');

class NodePackageStepAction extends StepAction {

    performAction() {
        const {context} = this;
        const {
            stepId,
            packageData,
            resultId,
            retryIndex,
            stepResultId,
            timeToPlayBeforeExec
        } = context;

        return service.installPackage(stepId, resultId, retryIndex, packageData, stepResultId, timeToPlayBeforeExec)
            .then(data => ({data, success: true}))
            .catch(NpmPackageError, err => {
                return Promise.resolve({
                    success: false,
                    code: "invalid-node-package",
                    message: err.message
                })
            })
            .catch(Promise.TimeoutError, () => {
                return Promise.resolve({
                    success: false,
                    code: "timeout"
                });
            })
            .catch(err =>
                Promise.resolve({
                    success: false,
                    reason: err.message,
                    exception: err
                })
            );

    }
}

module.exports = NodePackageStepAction;

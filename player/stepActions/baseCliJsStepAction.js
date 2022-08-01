'use strict';

const BaseJsStepAction = require('./baseJsStepAction');
const Promise = require('bluebird');
const service = require('../../agent/routers/cliJsCode/service');
const sessionPlayer = require('../../commons/getSessionPlayerRequire');
const _ = require('lodash');

const constants = sessionPlayer.commonConstants.stepResult;

class BaseCliJsStepAction extends BaseJsStepAction {
    executeCliCode() {
        const { step, context } = this;
        const isMobile = this.stepActionUtils.driver.isMobile;
        const hasCliAction = _(context).get('company.activePlan.premiumFeatures.cliAction');

        if (!hasCliAction && !isMobile) {
            return Promise.resolve({
                success: 'skipped',
                reason: 'CLI action is not enabled in your current plan',
            });
        }

        const { code, id } = step;
        const { incomingParams, testResultId, retryIndex, stepResultId } = context;
        const contextData = {
            config: context.config,
            data: context.data,
        };
        const runTimeout = context.data.timeToPlayStep;
        return service.runCodeWithPackages(code, id, incomingParams, contextData, testResultId, retryIndex, stepResultId, runTimeout)
            .then(data => this.checkCodeResponse(data));
    }

    performAction() {
        return this.executeCliCode()
            .catch(Promise.TimeoutError, () => Promise.resolve({
                success: false,
                errorType: constants.ACTION_TIMEOUT,
            }))
            .catch(err => Promise.resolve({
                success: false,
                reason: err.message,
                exception: err,
            }));
    }
}

module.exports = BaseCliJsStepAction;

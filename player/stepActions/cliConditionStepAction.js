"use strict";

const BaseCliJsStepAction = require('./baseCliJsStepAction');

class CliConditionStepAction extends BaseCliJsStepAction {
    isFailedResult(resultValue) {
        return !resultValue;
    }
}

module.exports = CliConditionStepAction;

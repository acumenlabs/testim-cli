"use strict";

const BaseCliJsStepAction = require('./baseCliJsStepAction');

class CliJsStepAction extends BaseCliJsStepAction {
    isFailedResult(resultValue) {
        return resultValue === false;
    }
}

module.exports = CliJsStepAction;

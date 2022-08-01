"use strict";

const BaseJsStepAction = require('./baseJsStepAction');

class JsConditionStepAction extends BaseJsStepAction {
    isFailedResult(resultValue) {
        return !resultValue;
    }
}

module.exports = JsConditionStepAction;


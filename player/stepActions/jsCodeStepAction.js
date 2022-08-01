"use strict";

const BaseJsStepAction = require('./baseJsStepAction');

class JsCodeStepAction extends BaseJsStepAction {
    isFailedResult(resultValue) {
        return resultValue === false;
    }
}

module.exports = JsCodeStepAction;


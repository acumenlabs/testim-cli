"use strict";

const StepAction = require('./stepAction');
const Promise = require('bluebird');

class ExtractTextStepAction extends StepAction {

    performAction() {
        const paramName = this.step.extractTextParamName;

        return this.stepActionUtils.extractTargetText(this.getTarget())
            .then(extractedText => {
                this.context.data.exports = this.context.data.exports || {};
                this.context.data.exports[paramName] = extractedText;
                return Promise.resolve({
                    success: true,
                    data: this.context.data
                });
            });
    }

}

module.exports = ExtractTextStepAction;

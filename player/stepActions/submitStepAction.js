"use strict";

const StepAction = require('./stepAction');

class SubmitStepAction extends StepAction {

    performAction() {
        return this.driver.submitForm(this.getTarget().seleniumElement)
            .then(() => {});
    }
}

module.exports = SubmitStepAction;


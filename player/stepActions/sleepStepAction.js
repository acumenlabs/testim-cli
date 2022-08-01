"use strict";

const StepAction = require('./stepAction');
const Promise = require("bluebird");

class SleepStepAction extends StepAction {

    performAction() {
        return Promise.delay(this.step.durationMS).then(() => Promise.resolve());
    }
}

module.exports = SleepStepAction;

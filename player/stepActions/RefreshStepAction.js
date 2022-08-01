'use strict';

const StepAction = require('./stepAction');
require('bluebird');

class RefreshStepAction extends StepAction {
    execute() {
        return this.driver.reloadTab()
            .then(() => ({ success: true }))
            .catch(error => ({ success: false, reason: error.message }));
    }
}

module.exports = RefreshStepAction;

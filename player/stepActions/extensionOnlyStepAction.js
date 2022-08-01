const StepAction = require('./stepAction');
const Promise = require('bluebird');

class ExtensionOnlyStepAction extends StepAction {
    performAction() {
        return Promise.resolve({
            success: 'skipped',
            reason: "This step can run only on Chrome"
        });
    }
}

module.exports = ExtensionOnlyStepAction;

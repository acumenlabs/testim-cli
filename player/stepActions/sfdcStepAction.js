const StepAction = require('./stepAction');
const { sfdc } = require('../../commons/getSessionPlayerRequire');

class SfdcStepAction extends StepAction {
    async performAction() {
        const page = sfdc.sfdcNewSePage(this.driver);
        try {
            const actions = this.context.sfdcTestActions;
            if (actions === undefined) {
                throw new Error('No test actions were compiled');
            }
            await sfdc.sfdcExecute(page, actions);
            return { success: true };
        } catch (err) {
            return {
                success: false,
                reason: err.reason || err.message,
                exception: err,
                shouldRetry: false, // TODO - check this.  Our (bFormat) steps are probably not retryable?
            };
        } finally {
            page.releaseObjects();
        }
    }
}

module.exports = SfdcStepAction;

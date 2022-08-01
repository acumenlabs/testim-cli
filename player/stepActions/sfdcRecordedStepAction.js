const StepAction = require('./stepAction');
const { sfdc } = require('../../commons/getSessionPlayerRequire');

class SfdcRecordedStepAction extends StepAction {
    async performAction() {
        const page = sfdc.sfdcNewSePage(this.driver);
        try {
            await sfdc.sfdcExecuteRecordedStep(page, this.step.recordedData);
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

module.exports = SfdcRecordedStepAction;

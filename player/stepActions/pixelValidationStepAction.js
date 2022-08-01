'use strict';

const _ = require('lodash');
const StepAction = require('./stepAction');
const { eyeSdkService } = require('../utils/eyeSdkService');
const logger = require('../../commons/logger').getLogger('pixel-validation-step-action');


class PixelValidationStepAction extends StepAction {
    async performAction() {
        const { shouldUseVisualGrid, applitoolsSdkConfig: config, testResultId } = this.context;
        this.runContext = this.context.getRunContext(undefined);
        const finalParams = (this.runContext.incomingParams && this.runContext.incomingParams.final) || {};
        const batchId = (config.batch && config.batch.id) || testResultId;
        const eyeManager = await eyeSdkService.getManager(shouldUseVisualGrid, this.context.config.applitoolsConcurrency || 5, batchId, this.runContext.applitoolsIntegrationData);
        const targetElementData = this.getTarget() || {};
        let result;
        try {
            const openedEye = await eyeManager.openEyes({ driver: this.driver.client, config });
            const region = (this.step.action === 'element' && targetElementData.seleniumElement) || undefined;
            const settings = { region, fully: this.step.action === 'stitched' };
            if (finalParams.applitoolsStepSettings && _.isPlainObject(finalParams.applitoolsStepSettings)) {
                Object.assign(settings, finalParams.applitoolsStepSettings);
                logger.info('Applitools SDK step executed with applitoolsStepSettings parameter', { applitoolsStepSettings: finalParams.applitoolsStepSettings });
            }
            await openedEye.check({ settings });
            const eyesResults = await openedEye.close();

            result = { isApplitoolsSdkResult: true, success: true, eyesResults };
        } catch (err) {
            logger.error('Applitools SDK step failed', { err, info: err.info });
            result = { isApplitoolsSdkResult: true, success: false, err };
        }
        return await eyeSdkService.handleApplitoolsSdkResult(this.context, result, this.step);
    }
}

module.exports = PixelValidationStepAction;

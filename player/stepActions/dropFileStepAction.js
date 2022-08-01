'use strict';

const Promise = require('bluebird');
const StepAction = require('./stepAction');
const logger = require('../../commons/logger').getLogger('drop-file-step-action');
const downloadFileAndFireDropEvent = require('./scripts/dropEvent');
const createDropEventLegacy = require('./scripts/createDropEventLegacy');
const { codeSnippets, utils } = require('../../commons/getSessionPlayerRequire');
const featureFlagService = require('../../commons/featureFlags');

class DropFileStepAction extends StepAction {
    performAction() {
        const target = this.context.data[this.step.targetId || 'targetId'];
        const overrideAzureStorageUrl = featureFlagService.flags.overrideAzureStorageUrl.isEnabled();
        //TODO remove if after release session player
        return (utils.addTokenToFileUrl ? utils.addTokenToFileUrl(
            this.context.project.id,
            this.step.fileUrls,
            this.stepActionUtils.testimServicesApi,
            overrideAzureStorageUrl,
            logger,
        ) : Promise.resolve(this.step.fileUrls)).then((fileUrls) => {
            const dropFileCode = `
            var getLocatedElement = ${codeSnippets.getLocatedElementCode};
            var createDropEvent = ${(codeSnippets.createDropEvent ? codeSnippets.createDropEvent : createDropEventLegacy).toString()};
            var downloadFileAndFireDropEvent = ${downloadFileAndFireDropEvent.toString()};
            return downloadFileAndFireDropEvent.apply(null, arguments)
        `;

            return this.driver.executeJSWithArray(dropFileCode, [target.locatedElement, fileUrls])
                .then(() => Promise.resolve());
        });
    }
}

module.exports = DropFileStepAction;

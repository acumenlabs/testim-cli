'use strict';

const { commonConstants } = require('../../commons/getSessionPlayerRequire');
const Promise = require('bluebird');

class StepAction {
    constructor(step, context, frameHandler, exportsGlobal = {}, stepActionUtils, locateElementPlayer, exportsTest = {}) {
        this.step = step;
        this.context = context;
        this.frameHandler = frameHandler;
        this.frameId = 0;
        this.stepActionUtils = stepActionUtils;
        this.locateElementPlayer = locateElementPlayer;
        this.exportsGlobal = exportsGlobal;
        this.exportsTest = exportsTest;
    }

    get driver() {
        return this.stepActionUtils.driver;
    }

    performAction() {
        throw new Error('not implemented');
    }

    getTarget() {
        const targetId = this.step.targetId || 'targetId';
        return this.context.data[targetId];
    }

    execute(stepActionFactory, step) {
        return Promise.resolve(this.performAction(stepActionFactory, step))
            .then(res => Promise.resolve(Object.assign({}, { success: true }, res)))
            .catch(err => {
                const errorMsg = (err || {}).message || (err && err.seleniumStack && err.seleniumStack.message);
                const displayMsg = (err || {}).displayMessage;
                return Promise.resolve({
                    success: false,
                    reason: errorMsg,
                    exception: err,
                    errorType: commonConstants.stepResult.ACTION_EXCEPTION,
                    resultInfo: {
                        exception: `selenium exception: ${errorMsg}`,
                        // clickim -> playbackStepResultHandler.js -> FAILURE_REASON_MAPPING -> ACTION_EXCEPTION
                        // expects resultInfo.error or resultInfo.reason
                        error: displayMsg || errorMsg,
                    },
                });
            });
    }
}

module.exports = StepAction;

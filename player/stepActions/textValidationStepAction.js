"use strict";


const sessionPlayer = require('../../commons/getSessionPlayerRequire');

const StepAction = require('./stepAction');
const constants = sessionPlayer.commonConstants.stepResult;
const paramEvaluator = sessionPlayer.stepParamExpressionEvaluator;
const utils = sessionPlayer.utils;


const Promise = require('bluebird');

class TextValidationStepAction extends StepAction {
    performAction(stepActionFactory) {
        var step = this.step;
        var context = this.context;
        var target = this.getTarget();
        var frameHandler = this.frameHandler;
        

        return new Promise(resolve => {
            var onFail = resultInfo => {
                resolve({ errorType: constants.TEXT_COMPARE_FAILURE, resultInfo: resultInfo, success: false });
            };
            this.stepActionUtils.extractTargetText(target)
                .then(text => {
                    if (paramEvaluator) {
                        const expected = paramEvaluator.computeExpression(step.expression2, context, this.exportsGlobal, this.exportsTest);
                        return {
                            actual: text,
                            expected: expected.evaluatedText
                        };
                    }
                    return stepActionFactory.executeStep(step.expression2, context, frameHandler, this.exportsGlobal, this.locateElementPlayer, this.exportsTest)
                        .then(res => ({
                            actual: text,
                            expected: res.evaluatedText
                        }));
                })
                .then(({ actual, expected }) => {
                    try {
                        const compareResult = utils.compareOrMatch(expected, actual);
                        return compareResult ?
                            resolve({ success: true }) :
                            onFail({ expected: String(expected), actual: actual });
                    } catch (err) {
                        return onFail({ expected: expected.toString(), actual: actual });
                    }
                })
                .catch(err => resolve({
                    success: false,
                    reason: err.message,
                    exception: err,
                    shouldRetry: true
                }));
        });
    }
}

module.exports = TextValidationStepAction;


'use strict';

const Promise = require('bluebird');
const sessionPlayer = require('../../commons/getSessionPlayerRequire');
const StepAction = require('./stepAction');

const constants = sessionPlayer.commonConstants.stepResult;
const { stepParamBuilder } = sessionPlayer;
const logger = require('../../commons/logger').getLogger('evaluate-expression-step-action');
const _ = require('lodash');

class EvaluateExpressionStepAction extends StepAction {
    execute() {
        const step = this.step;
        const context = this.context;
        const exportsGlobal = this.exportsGlobal;
        const exportsTest = this.exportsTest;

        return new Promise((resolve, reject) => {
            try {
                logger.info('runner running incoming params evaluation');
                let incomingParams = context.incomingParams || {};
                if (_.isEmpty(incomingParams)) {
                    incomingParams = stepParamBuilder.getStepInputs(step, context, exportsGlobal, exportsTest);
                }

                const params = ['context', ...incomingParams.as.functionParameters];
                const args = [context, ...incomingParams.as.functionArguments];
                const expressionToEvaluate = step.subType === 'text' ? `'${step.expression.replace(/'/g, "\\\'")}'` : step.expression;
                const code = (`return ${expressionToEvaluate}`).replace(/\n/g, '\\n');
                const textEvaluateFunction = Function.apply(Function, params.concat([code]));
                const evaluatedText = textEvaluateFunction.apply(null, args);

                context.data[step.targetName] = evaluatedText;
                context.data[step.targetId] = evaluatedText;
                if (context.internalParams) {
                    context.internalParams.add(step.targetId);
                }

                const result = {
                    success: true,
                    evaluatedText,
                    data: context.data,
                };

                resolve(result);
            } catch (e) {
                reject({ errorType: constants.EVALUATE_EXPRESSION_EXCEPTION, resultInfo: { exception: e.toString() }, success: false });
            }
        });
    }
}

module.exports = EvaluateExpressionStepAction;

/* eslint-disable prefer-template */

'use strict';

const Promise = require('bluebird');
const sessionPlayer = require('../../commons/getSessionPlayerRequire');

const featureFlags = require('../../commons/featureFlags');
const runnerUtils = require('../../utils');
const StepAction = require('./stepAction');
const runCodeScript = require('./scripts/runCode');

const { codeSnippets, commonConstants } = sessionPlayer;
const constants = commonConstants.stepResult;
const logger = require('../../commons/logger').getLogger('base-js-step-action');

const _ = require('lodash');

function constructWithArguments(constructor, args) {
    function F() {
        return constructor.apply(this, args);
    }

    F.prototype = constructor.prototype;
    return new F();
}

class BaseJsStepAction extends StepAction {
    isExceedingMaxResultSize(data, context) {
        try {
            const shouldEnforceMaxSize = context.project.defaults.enforceMaximumJsResultSize;
            const maximumJsResultSize = featureFlags.flags.maximumJsResultSize.getValue();
            const dataSizeExceeded = JSON.stringify(data).length > maximumJsResultSize;
            if (!shouldEnforceMaxSize) {
                if (dataSizeExceeded) {
                    logger.warn(`js result size exceeded ${maximumJsResultSize}, stepId: ${this.step.id}`);
                }
                return false;
            }
            return dataSizeExceeded;
        } catch (e) {
            return false;
        }
    }

    executeGetStatus(transactionId) {
        // eslint-disable-next-line prefer-arrow-callback
        return this.driver.executeJS(function (transactionId) {
            const sessionItem = 'data-testim-' + transactionId;
            try {
                return window.sessionStorage.getItem(sessionItem);
            } catch (err) {
                if (err.message.indexOf('sessionStorage') > -1 || // Chrome + Firefox
                    err.message.indexOf('The operation is insecure') > -1 || // Safari
                    err.message.indexOf('SecurityError') > -1) { // edge
                    const storage = document.head.querySelector('#testim-storage-backup');
                    if (!storage) {
                        return '{}';
                    }
                    return storage.getAttribute(sessionItem);
                }
                throw err;
            }
        }, transactionId);
    }

    constructJSFunParams(eventData) {
        const incomingParams = eventData.incomingParams;

        const params = [
            ...['context', ...incomingParams.as.functionParameters],
            ...['exports', 'exportsTest', 'exportsGlobal'],
        ];

        const args = [eventData.context, ...incomingParams.as.functionArguments];

        params.push(eventData.code);
        args.forEach(arg => {
            if (_.isObject(arg)) {
                runnerUtils.removePropertyFromObject(arg, 'seleniumElement', _.isEqual);
            }
        });
        return {
            function: {
                params,
                args,
            },
            transactionId: eventData.transactionId,
            browser: eventData.browser,
            browserMajor: eventData.browserMajor,
        };
    }


    checkStatus(transactionId) {
        const that = this;
        const retryInterval = that.context.config.retryTimeout;
        let timeToPlayStep = that.context.data.timeToPlayStep - retryInterval;
        return new Promise(resolve => {
            function checkScriptStatus() {
                return that.executeGetStatus(transactionId)
                    .catch(err => {
                        logger.warn('failed to get js status', { err });
                        return { value: { status: 'exception' } };
                    })
                    .then(selRes => {
                        let res;
                        try {
                            res = JSON.parse(selRes ? selRes.value : '{}');
                        } catch (e) {
                            logger.warn('non object value', { selRes });
                            res = { status: 'exception' };
                        }
                        const abortReason = that.stepActionUtils.abortedSteps.find(abortedStep => abortedStep.id === that.step.id);
                        if (abortReason) {
                            return resolve(abortReason);
                        }
                        if (!res) {
                            return resolve({ success: true });
                        }
                        if (res.status && res.status === 'done') {
                            return resolve(res);
                        }
                        if (res.status && res.status === 'failed') {
                            return resolve({ success: false, shouldRetry: true, result: res.result });
                        }
                        if (timeToPlayStep - retryInterval > 0) {
                            timeToPlayStep -= retryInterval;
                            setTimeout(checkScriptStatus, retryInterval);
                        } else {
                            return resolve(Object.assign({}, res, { success: false, shouldRetry: true }));
                        }
                        return undefined;
                    });
            }

            checkScriptStatus();
        });
    }

    executeInAut(eventMessage) {
        const useExperimentalPreCompilation = featureFlags.flags.experimentalPreCodeCompilation.isEnabled();
        const experimentalAsyncCustomCode = featureFlags.flags.experimentalAsyncCustomCode.isEnabled();
        const rawParams = this.constructJSFunParams(eventMessage);
        const hasLocateParams = rawParams.function.args.some(x => Boolean(x && x.locatedElement));
        let funcToRunString = 'undefined';
        if (useExperimentalPreCompilation) {
            const paramNames = rawParams.function.params.slice(0, -1);
            funcToRunString = (experimentalAsyncCustomCode && !this.driver.isIE()) ? `async function(${paramNames.join(',')}) {
                ${eventMessage.code}
            };` : `function(${paramNames.join(',')}) {
                ${eventMessage.code}
            };`;
            // remove code from call.
            rawParams.function.params.pop();
        }

        const runCode = `
            ${hasLocateParams ? `var getLocatedElement = ${codeSnippets.getLocatedElementCode};` : ';'}
            var runCode = ${runCodeScript.toString()};
            var eventData = ${this.driver.isEdge() ? 'JSON.parse(arguments[0])' : 'arguments[0]'};
            var funcToRun = ${funcToRunString};
            return runCode.call(null, eventData, funcToRun);
        `;
        const params = this.driver.isEdge() ? JSON.stringify(rawParams) : rawParams;
        if (!useExperimentalPreCompilation) {
            return this.driver.executeJS(runCode, params);
        }

        return this.driver.executeJS(runCode, params).catch(err => this.handleExecutionError(err));
    }

    codeExecDone(resp) {
        const { context } = this;
        const {
            result = {}, tstConsoleLogs, nodeVersion, navigateToDifferentDomain,
        } = resp;
        if (result.exports) {
            context.data.exports = result.exports;
        }

        const resultObj = {
            nodeVersion,
            tstConsoleLogs,
            data: context.data,
        };

        if (this.isFailedResult(result.resultValue)) {
            Object.assign(resultObj, {
                success: false,
                errorType: constants.JS_ASSERTION_FAILED,
            });
        } else if (this.isExceedingMaxResultSize({ result, tstConsoleLogs }, context)) {
            Object.assign(resultObj, {
                success: false,
                errorType: constants.JS_RESULT_MAX_SIZE_EXCEEDED,
            });
        } else {
            Object.assign(resultObj, {
                success: true,
                exportsTest: result.exportsTest,
                exportsGlobal: result.exportsGlobal,
            });
            if (navigateToDifferentDomain) {
                resultObj.navigateToDifferentDomain = navigateToDifferentDomain;
            }
        }
        return Promise.resolve(resultObj);
    }

    codeExecFailed(resp) {
        const { context } = this;
        if (resp.type === 'promise') {
            return Promise.resolve({
                data: context.data,
                success: false,
                shouldRetry: true,
                isPendingPromise: true,
                errorType: constants.JS_ASSERTION_FAILED,
            });
        }
        if (resp.reason === 'stopped') {
            return Promise.resolve(Object.assign({}, resp, { errorType: constants.STOPPED }));
        }
        const { result = {}, tstConsoleLogs } = resp;
        const message = {
            tstConsoleLogs,
            data: context.data,
            exportsGlobal: result.exportsGlobal,
            exportsTest: result.exportsTest,
            success: false,
            errorType: constants.UNWRAPPED_AUT_REJECT,
            resultInfo: { error: result.resultValue },
        };
        return Promise.resolve(message);
    }

    checkCodeResponse(resp) {
        return resp && resp.success ? this.codeExecDone(resp) : this.codeExecFailed(resp);
    }

    performAction() {
        const step = this.step;
        const context = this.context;

        this.startTimestamp = Date.now();

        const eventMessage = {
            transactionId: `${context.testResultId}:${step.id}`,
            id: step.id,
            eventType: step.type,
            code: step.code,
            incomingParams: context.incomingParams,
            exportsGlobal: this.exportsGlobal,
            exportsTest: this.exportsTest,
            context: {
                config: context.config,
                data: context.data,
            },
            testResultId: context.testResultId,
        };


        return this.driver.getBrowserAndOS()
            .then(browserAndOS => {
                Object.assign(eventMessage, { browser: browserAndOS.browser, browserMajor: browserAndOS.browserMajor });
                return Promise.resolve();
            })
            .then(() => (this.context.isPendingPromise ? Promise.resolve() : this.executeInAut(eventMessage)))
            .then(() => this.checkStatus(eventMessage.transactionId))
            .then(resp => this.checkCodeResponse(resp));
    }

    handleExecutionError(err) {
        const canExtractError = err && err.seleniumStack && err.seleniumStack.type === 'JavaScriptError' &&
            err.seleniumStack.orgStatusMessage;

        if (canExtractError) {
            if (!this.driver.isIE()) {
                const endOfMessage = err.seleniumStack.orgStatusMessage.indexOf('\nBuild info');
                const reason = err.seleniumStack.orgStatusMessage.slice(0, endOfMessage === -1 ? undefined : endOfMessage);
                throw new Error(reason);
            }

            // IE has unhelpful messages
            try {
                constructWithArguments(Function, rawParams.function.params.concat([eventMessage.code]));
            } catch (err) {
                if (err instanceof SyntaxError) {
                    throw new Error(err.message);
                }
            }
        }

        throw err;
    }
}

module.exports = BaseJsStepAction;

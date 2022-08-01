'use strict';

const Promise = require('bluebird');
const StepAction = require('./stepAction');

const sessionPlayer = require('../../commons/getSessionPlayerRequire');

const constants = sessionPlayer.commonConstants.stepResult;
const apiCall = sessionPlayer.apiCall;

class ApiStepAction extends StepAction {
    runApiInAut(eventData) {
        eventData.withCredentials = true;
        const timeout = this.context.data.timeToPlayStep + 3000;
        return this.driver.executeCodeAsync(apiCall, timeout, eventData)
            .then(autRes => {
                const resp = autRes && autRes.value;
                return resp || {};
            }).catch(err => err && err.message && err.message.includes('Javascript execution context no longer exists'), err => {
                throw new Error('The page refreshed or changed while executing this step. Please consider unchecking "Send via web page" if this is expected.');
            });
    }

    runApiInBg(eventData) {
        return new Promise(resolve => apiCall(eventData, resolve));
    }

    performAction() {
        const step = this.step;
        const context = this.context;

        const eventData = {
            id: step.id,
            url: context.apiUrl,
            method: step.method,
            headers: context.apiHeaders,
            body: context.apiBody,
            timeout: context.data.maxTotalStepTime,
            omitCookies: step.omitCookies,
            formData: step.formData,
            fileUrls: context.fileUrls,
        };

        return (step.sendViaWebApp ? this.runApiInAut(eventData) : this.runApiInBg(eventData))
            .then(resp => {
                const result = resp.result || {};

                const resultInfo = {
                    method: step.method,
                    status: result.status,
                    url: step.url,
                };

                if (resp.success) {
                    if (result.status === 0) {
                        return {
                            result,
                            resultInfo,
                            shouldRetry: false,
                            success: false,
                            reason: 'Connection problem',
                            errorType: constants.API_REQUEST_NETWORK_ERROR,
                        };
                    }
                    return {
                        result,
                        resultInfo,
                        shouldRetry: false,
                        success: true,
                    };
                }

                return {
                    result,
                    resultInfo,
                    shouldRetry: false,
                    success: false,
                    reason: result.error || sessionPlayer.commonConstants.error.REQUEST_TIMED_OUT,
                    errorType: result.error ? constants.API_FAILURE : constants.API_REQUEST_NETWORK_ERROR,
                };
            });
    }
}

module.exports = ApiStepAction;

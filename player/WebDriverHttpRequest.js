//https://github.com/webdriverio-boneyard/v4/blob/master/LICENSE-MIT

const _ = require('lodash');
const httpRequest = require('../commons/httpRequest');
const utils = require('../utils');
const SeleniumProtocolError = require('./SeleniumProtocolError');
const { SELENIUM_STATUS_CODES } = require('./constants');
const logger = require('../commons/logger').getLogger('WebDriverHttpRequest');

function isSuccessfulResponse(body, statusCode) {
    /**
     * response contains a body
     */
    if (!body) {
        return false;
    }

    /**
     * if it has a status property, it should be 0
     * (just here to stay backwards compatible to the jsonwire protocol)
     */
    if (body.status && body.status !== 0) {
        return false;
    }

    /**
     * the body contains an actual result
     */
    if (typeof body.value === 'undefined') {
        return false;
    }

    /**
     * check status code
     */
    if (statusCode === 200) {
        return true;
    }

    /**
     * that has no error property (Appium only)
     */
    if (body.value && (body.value.error || body.value.stackTrace || body.value.stacktrace)) {
        return false;
    }

    return true;
}

class WebDriverHttpRequest {
    constructor(gridUrl, headers, connectionRetryTimeout, testResultId) {
        this.gridUrl = gridUrl;
        this.headers = headers;
        this.connectionRetryTimeout = connectionRetryTimeout;
        this.testResultId = testResultId;
    }

    handleFailedStatus(requestId, response, err = {}) {
        const { body, statusCode, headers, text } = response;
        const resBody = _.isEmpty(body) && text ? text : body;
        /**
         * in Appium you find sometimes more exact error messages in origValue
         */
        if (resBody && resBody.value && typeof resBody.value.origValue === 'string' && typeof resBody.value.message === 'string') {
            resBody.value.message += ` ${resBody.value.origValue}`;
        }

        if (resBody && typeof resBody === 'string') {
            throw new SeleniumProtocolError(resBody, { requestId });
        }

        if (resBody && resBody.value) {
            const errorCode = SELENIUM_STATUS_CODES[resBody.status] || (resBody.value && SELENIUM_STATUS_CODES[resBody.value.error]) || SELENIUM_STATUS_CODES[-1];
            const error = {
                type: errorCode ? errorCode.id : 'unknown',
                message: errorCode ? errorCode.message : 'unknown',
                orgStatusMessage: resBody.value ? resBody.value.message : '',
            };

            throw new SeleniumProtocolError(error, { requestId });
        }

        // IEServer webdriver bug where the error is put into the Allow header
        // https://github.com/SeleniumHQ/selenium/issues/6828
        if (statusCode === 405) {
            const allowHeader = headers && headers.allow;
            const _err = new SeleniumProtocolError(allowHeader, { requestId });
            if (_err.message.match(/Command not found/)) {
                throw _err;
            }
        }

        throw new SeleniumProtocolError({
            status: -1,
            type: err.code || 'ECONNREFUSED',
            orgStatusMessage: err.rawResponse || err.message,
            message: err.rawResponse || "Couldn't connect to selenium server",
        }, { requestId });
    }

    processHttpOnSuccess(response, requestId) {
        const { body, statusCode } = response;
        if (isSuccessfulResponse(body, statusCode)) {
            return body;
        }

        return this.handleFailedStatus(requestId, response);
    }

    processHttpOnError(err, requestId) {
        const response = (err && err.response) || {};
        return this.handleFailedStatus(requestId, response, err);
    }

    httpPostRequest(path, body = {}) {
        const requestId = utils.guid();
        if (path === '/session') {
            logger.info('POST REQUEST', { requestId, path, testResultId: this.testResultId });
        } else {
            logger.info('POST REQUEST', { requestId, path, body, testResultId: this.testResultId });
        }

        return httpRequest.postFullRes(`${this.gridUrl}${path}`, body, this.headers, this.connectionRetryTimeout)
            .then(response => {
                logger.info('POST RESPONSE', {
                    requestId,
                    path,
                    res: JSON.stringify(response.body),
                    testResultId: this.testResultId,
                });
                return response;
            })
            .catch(err => this.processHttpOnError(err, requestId))
            .then((response) => this.processHttpOnSuccess(response, requestId));
    }

    httpGetRequest(path) {
        const requestId = utils.guid();
        logger.info('GET REQUEST', { requestId, path, testResultId: this.testResultId });
        const query = {};
        return httpRequest.getFullRes(`${this.gridUrl}${path}`, query, this.headers, this.connectionRetryTimeout)
            .then(response => {
                if (_.endsWith(path, '/screenshot')) {
                    logger.info('GET RESPONSE', { requestId, path, testResultId: this.testResultId });
                    return response;
                }
                logger.info('GET RESPONSE', {
                    requestId,
                    path,
                    res: JSON.stringify(response.body),
                    testResultId: this.testResultId,
                });
                return response;
            })
            .catch(err => this.processHttpOnError(err, requestId))
            .then((response) => this.processHttpOnSuccess(response, requestId));
    }

    httpDeleteRequest(path) {
        const requestId = utils.guid();
        logger.info('DELETE REQUEST', { requestId, path, testResultId: this.testResultId });
        return httpRequest.deleteFullRes(`${this.gridUrl}${path}`, undefined, this.headers, this.connectionRetryTimeout)
            .then(response => {
                logger.info('DELETE RESPONSE', {
                    requestId,
                    path,
                    res: JSON.stringify(response.body),
                    testResultId: this.testResultId,
                });
                return response;
            })
            .catch(err => this.processHttpOnError(err, requestId))
            .then((response) => this.processHttpOnSuccess(response, requestId));
    }
}

module.exports = WebDriverHttpRequest;

'use strict';

const logger = require('./logger').getLogger('http-request');
const superagent = require('superagent');
const Promise = require('bluebird');
const { makeCounters } = require('./httpRequestCounters');

const wrapWithMonitoring = makeCounters();

const DEFAULT_REQUEST_TIMEOUT = process.env.DEFAULT_REQUEST_TIMEOUT || 30000; //30sec timeout
const DOWNLOAD_REQUEST_TIMEOUT = 60000; //1min timeout

function getCaFile() {
    return global.caFileContent;
}

function binaryParser(res, fn) {
    const data = [];

    res.on('data', (chunk) => {
        data.push(chunk); // Append Buffer object
    });
    res.on('end', () => {
        fn(null, Buffer.concat(data)); // Merge the chunks and return
    });
}

function getProxy() {
    if (!superagent.Request.prototype.proxy && global.SuperagentProxy) {
        global.SuperagentProxy(superagent);
    }
    return global.proxyUri;
}

const logErrorAndRethrow = (logMsg, data) => err => {
    logger.error(logMsg, { ...data, error: err });
    throw err;
};

function deleteMethod(url, body, headers, timeout) {
    return deleteFullRes(url, body, headers, timeout)
        .then(res => {
            if (res.type === 'text/plain') {
                return res.text;
            }
            return res.body;
        })
        .catch(logErrorAndRethrow('failed to delete request', { url }));
}

function deleteFullRes(url, body = {}, headers = {}, timeout = DEFAULT_REQUEST_TIMEOUT) {
    const request = superagent
        .delete(url)
        .send(body)
        .timeout(timeout)
        .set(headers);

    if (getCaFile()) {
        request.ca(getCaFile());
    }

    if (getProxy()) {
        request.proxy(getProxy());
    }

    return Promise.fromCallback((callback) => request.end(callback));
}

function post({
    url, body, headers, timeout, retry,
}) {
    return postFullRes(url, body, headers, timeout, retry)
        .then(res => {
            if (res.type === 'text/plain') {
                return res.text;
            }
            return res.body;
        })
        .catch(logErrorAndRethrow('failed to post request', { url }));
}

function postFullRes(url, body, headers = {}, timeout = DEFAULT_REQUEST_TIMEOUT, retry) {
    const request = superagent
        .post(url)
        .send(body)
        .timeout(timeout)
        .set(headers);

    if (getCaFile()) {
        request.ca(getCaFile());
    }

    if (getProxy()) {
        request.proxy(getProxy());
    }

    if (retry) {
        request.retry(retry);
    }

    return Promise.fromCallback((callback) => request.end(callback)).catch(e => e, e => {
        e.url = url;
        e.originalRequestTimeout = timeout;
        e.additionalSetHeaders = headers;
        throw e;
    });
}

function postForm(url, fields, files, headers = {}, timeout = DEFAULT_REQUEST_TIMEOUT) {
    const request = superagent
        .post(url)
        .type('form')
        .timeout(timeout)
        .set(headers);

    request.field(fields);

    Object.keys(files).forEach(file => {
        request.attach(file, files[file].buffer, files[file].fileName);
    });

    if (getCaFile()) {
        request.ca(getCaFile());
    }

    if (getProxy()) {
        request.proxy(getProxy());
    }

    return Promise.fromCallback((callback) => request.end(callback))
        .then((res) => {
            if (res.type === 'text/plain') {
                return res.text;
            }
            return res.body;
        })
        .catch(logErrorAndRethrow('failed to post request', { url }));
}

function _get(url, query, headers = {}, timeout = DEFAULT_REQUEST_TIMEOUT, { isBinary = false, skipProxy = false } = {}) {
    const request = superagent
        .get(url)
        .query(query)
        .timeout(timeout)
        .set(headers);

    if (isBinary) {
        request.buffer(true);
    }

    if (getCaFile()) {
        request.ca(getCaFile());
    }

    if (!skipProxy && getProxy()) {
        request.proxy(getProxy());
    }

    return Promise.fromCallback((callback) => request.end(callback));
}

function getText(url, query, headers) {
    return _get(url, query, headers)
        .then((res) => res.text)
        .catch(logErrorAndRethrow('failed to getText request', { url, query }));
}

function get(url, query, headers, timeout, options) {
    return _get(url, query, headers, timeout, options)
        .then((res) => res.body)
        .catch(err => {
            logger.warn('failed to get request', { url, query, error: err });
            throw err;
        });
}

function getFullRes(url, query, headers, timeout) {
    return _get(url, query, headers, timeout);
}

function head(url) {
    const request = superagent
        .head(url)
        .timeout(DEFAULT_REQUEST_TIMEOUT);

    if (getCaFile()) {
        request.ca(getCaFile());
    }

    if (getProxy()) {
        request.proxy(getProxy());
    }

    return Promise.fromCallback((callback) => request.end(callback))
        .catch(logErrorAndRethrow('failed to head request', { url }));
}

function put(url, body, headers = {}, timeout = DEFAULT_REQUEST_TIMEOUT) {
    const request = superagent
        .put(url)
        .send(body)
        .timeout(timeout)
        .set(headers);

    if (getCaFile()) {
        request.ca(getCaFile());
    }

    if (getProxy()) {
        request.proxy(getProxy());
    }

    return Promise.fromCallback((callback) => request.end(callback))
        .then((res) => res.body)
        .catch(logErrorAndRethrow('failed to put request', { url }));
}

function download(url) {
    logger.info('start to download', { url });

    const request = superagent
        .get(url)
        .timeout(DOWNLOAD_REQUEST_TIMEOUT)
        .buffer(true)
        .parse(binaryParser);

    if (getCaFile()) {
        request.ca(getCaFile());
    }

    if (getProxy()) {
        request.proxy(getProxy());
    }

    return Promise.fromCallback((callback) => request.end(callback))
        .then(response => {
            logger.info('finished to download', { url });
            return response;
        })
        .catch(logErrorAndRethrow('failed to download', { url }));
}

module.exports = {
    delete: wrapWithMonitoring(deleteMethod),
    deleteFullRes: wrapWithMonitoring(deleteFullRes),
    put: wrapWithMonitoring(put),
    get: wrapWithMonitoring(get),
    getText: wrapWithMonitoring(getText),
    post: wrapWithMonitoring(post),
    postFullRes: wrapWithMonitoring(postFullRes),
    getFullRes: wrapWithMonitoring(getFullRes),
    postForm: wrapWithMonitoring(postForm),
    head: wrapWithMonitoring(head),
    download: wrapWithMonitoring(download),
    isNetworkHealthy: wrapWithMonitoring.isNetworkHealthy,
    didNetworkConnectivityTestFail: wrapWithMonitoring.didNetworkConnectivityTestFail,
};

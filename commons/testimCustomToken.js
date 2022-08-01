'use strict';

const Promise = require('bluebird');
const httpRequest = require('./httpRequest');
const config = require('./config');
const ArgError = require('../errors').ArgError;
const logger = require('./logger').getLogger('testim-custom-token');
const localRunnerCache = require('./runnerFileCache');

let _serverToken;
let _serverTokenExp;
let _refreshToken;
let _ngrokToken;
let _isNgrokWhitelisted;

let _projectId = null;
let _token = null;

const FIVE_MIN_IN_MS = 5 * 60 * 1000;


async function init(projectId, token) {
    _projectId = projectId;
    _token = token;
    const tokenValue = await generateToken();
    return tokenValue;
}


function initFromData(authData, projectId, token) {
    _serverToken = authData.token;
    _projectId = projectId;
    _token = token;
    _serverTokenExp = getTokenExp(_serverToken);
    _refreshToken = authData.refreshToken;
    _ngrokToken = authData.ngrokToken;
    _isNgrokWhitelisted = authData.isNgrokWhitelisted;
}

function getTokenV3(projectId = _projectId, token = _token) {
    return localRunnerCache.memoize(() => {
        logger.info('request to get cli token from server');
        return httpRequest.post({
            url: `${config.SERVICES_HOST}/auth/token`,
            body: { projectId, token },
        });
    }, 'getTokenV3', FIVE_MIN_IN_MS * 10, { projectId, token })();
}

async function refreshToken() {
    logger.info('request to refresh JWT cli token from server');
    const customToken = await httpRequest.post({
        url: `${config.SERVICES_HOST}/auth/refreshToken`,
        body: { token: _serverToken, refreshToken: _refreshToken },
    });
    _serverToken = customToken.token;
    _serverTokenExp = getTokenExp(_serverToken);
    return _serverToken;
}

function generateToken() {
    return getTokenV3()
        .then(customToken => {
            logger.info('successfully get cli token from server');
            _serverToken = customToken.token;
            _serverTokenExp = getTokenExp(_serverToken);
            _refreshToken = customToken.refreshToken;
            _ngrokToken = customToken.ngrokToken;
            _isNgrokWhitelisted = customToken.isNgrokWhitelisted;
            return _serverToken;
        })
        .catch(error => error.message.includes('Unauthorized'), () => {
            throw new ArgError(
                'Error trying to retrieve CLI token. ' +
                'Your CLI token and project might not match. ' +
                'Please make sure to pass `--project` and `--token` that' +
                ' match to each other or make sure they match in your ~/.testim file.');
        })
        .catch(error => {
            logger.error(`While trying to retrieve CLI token. caught error: ${error}`, { projectId: _projectId });
            throw new ArgError(`While trying to retrieve CLI token, caught error: ${error}`);
        });
}

function getTokenExp(token) {
    const jwtLib = require('jsonwebtoken');
    const jwt = jwtLib.decode(token);
    return jwt.exp * 1000;
}

function getCustomTokenV3() {
    if (!_serverTokenExp) {
        return generateToken();
    }

    // Refresh the token earlier than needed, to give
    // clickim a chance to have more time to run, as
    // it can't refresh it itself.
    if (_serverTokenExp < (Date.now() + (4 * FIVE_MIN_IN_MS))) {
        return refreshToken().catch(err => {
            logger.error('failed to refresh token, executing fallback', err);
            return generateToken();
        });
    }
    return Promise.resolve(_serverToken);
}

function getRefreshToken() {
    return _refreshToken;
}

function getTokenV3UserData() {
    if (_serverToken) {
        const jwtLib = require('jsonwebtoken');
        const data = jwtLib.decode(_serverToken);
        return { uid: data.id, ngrokToken: _ngrokToken, isNgrokWhitelisted: _isNgrokWhitelisted };
    }
    return {};
}

module.exports = {
    init: Promise.method(init),
    initFromData,
    getCustomTokenV3,
    getTokenV3UserData,
    getRefreshToken,
};

'use strict';

const path = require('path');
const Promise = require('bluebird');
const debounce = require('lodash/debounce');
const fs = Promise.promisifyAll(require('fs'));
const { getCliLocation } = require('../utils');

const logger = require('./logger').getLogger('local cache');
const crypto = require('crypto');

let cacheLocation = path.resolve(getCliLocation(), 'testim-cache');

let encryptKeyResolve;
let encryptAndSaveResolve;
let cacheEnabled = true;
let cacheMissAllowed = true;
let waitingForSave = false;

let _encryptAndSavePromise = new Promise(resolve => { encryptAndSaveResolve = resolve; });
const _encryptKeyPromise = new Promise(resolve => { encryptKeyResolve = resolve; });


const THREE_HOURS = 1000 * 60 * 60 * 3;

const getCacheFileLocation = () => path.resolve(path.resolve(cacheLocation, 'testim.cache'));

const getLocalRunnerCache = () => fs.readFileAsync(getCacheFileLocation()).then(async buffer => {
    const key = await _encryptKeyPromise;
    return decrypt(key, buffer);
}).timeout(30000).catch(() => ({}));

let localRunnerCache = getLocalRunnerCache();

async function doesPathExist(dirPath) {
    try {
        await fs.promises.access(dirPath, fs.constants.F_OK);
        return true;
    } catch (err) {
        if (err.code === 'ENOENT') {
            return false;
        }

        // no permissions to check
        throw err;
    }
}

const encryptAndSave = debounce(async (object) => {
    let error;
    try {
        const key = await _encryptKeyPromise;
        const iv = crypto.randomBytes(16);
        const objStr = JSON.stringify(object);
        const keyBuffer = Buffer.from(key);
        const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.concat([keyBuffer, Buffer.alloc(32)], 32), iv);
        const result = Buffer.concat([iv, cipher.update(objStr), cipher.final()]);
        const pathExists = await doesPathExist(cacheLocation);
        if (!pathExists) {
            await fs.promises.mkdir(cacheLocation, { recursive: true });
        }
        await fs.writeFileAsync(getCacheFileLocation(), result);
    } catch (err) {
        logger.error('failed saving cache', { err });
        error = err;
    }
    if (error) {
        encryptAndSaveResolve({ success: false, error });
    } else {
        encryptAndSaveResolve({ success: true });
    }
}, 200);

function decrypt(key, buffer) {
    const iv = buffer.slice(0, 16);
    const encryptedText = buffer.slice(16);
    const keyBuffer = Buffer.from(key);
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.concat([keyBuffer, Buffer.alloc(32)], 32), iv);
    const decrypted = decipher.update(encryptedText);
    return JSON.parse(Buffer.concat([decrypted, decipher.final()]));
}
// argument less memoize for functions with a global cache name
function memoize(fn, fnName, duration = THREE_HOURS, parameters = undefined) {
    return Promise.method(async () => {
        if (!cacheEnabled) {
            return await fn();
        }
        const originalFnName = fnName;
        if (parameters) {
            fnName += JSON.stringify(parameters);
        }
        const cached = await get(fnName);
        if (cached) {
            logger.debug('cache hit:', { fnName });
            return cached;
        }
        logger.debug('cache miss:', { fnName });
        if (!cacheMissAllowed) {
            throw new Error(`Attemped to rebuild cache for ${originalFnName}. cache miss is not allowed with current run configuration`);
        }
        const value = await fn();
        if (value) {
            await set(fnName, value, duration);
        }
        return value;
    });
}
async function get(key) {
    const obj = await localRunnerCache;
    const valueExpiry = obj[key];
    if (!valueExpiry) {
        return undefined; // not in cache
    }
    const { value, expiry } = valueExpiry;
    if (expiry < Date.now()) {
        return undefined;
    }
    if (!value) {
        return undefined;
    }
    return value;
}

async function set(key, value, ttl) {
    if (waitingForSave) {
        logger.error('calling set after waitForSave is not allowed', { key, ttl });
        throw new Error('calling set after waitForSave is not allowed');
    }
    try {
        const obj = await localRunnerCache;
        obj[key] = { value, expiry: Date.now() + ttl };
        _encryptAndSavePromise = new Promise(resolve => { encryptAndSaveResolve = resolve; });
        encryptAndSave(obj);
    } catch (e) {
        logger.error('failed updating cache');
    }
}

async function clear() {
    const obj = await localRunnerCache;
    Object.keys(obj).forEach(key => {
        delete obj[key];
    });
}

function setEnabled(enabled) {
    cacheEnabled = enabled;
}


function enableCacheMiss(enabled) {
    cacheMissAllowed = enabled;
}

async function waitForSave() {
    try {
        waitingForSave = true;
        return await _encryptAndSavePromise;
    } finally {
        waitingForSave = false;
    }
}

function setCacheLocation(location) {
    cacheLocation = location;
    localRunnerCache = getLocalRunnerCache();
}

module.exports.setEncryptKey = encryptKeyResolve;
module.exports.memoize = memoize;
module.exports.get = get;

module.exports.set = set;
module.exports.clear = clear;
module.exports.disable = setEnabled.bind(this, false);
module.exports.enable = setEnabled.bind(this, true);
module.exports.isEnabled = function () { return cacheEnabled; };
module.exports.disableCacheMiss = enableCacheMiss.bind(this, false);
module.exports.enableCacheMiss = enableCacheMiss.bind(this, true);
module.exports.isEnabled = function () { return cacheEnabled; };
module.exports.setCacheLocation = setCacheLocation;
module.exports.waitForSave = waitForSave;
module.exports.getCacheFileLocation = getCacheFileLocation;

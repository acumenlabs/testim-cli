"use strict";

const express = require('express');
const router = express.Router();
const logger = require('../../../commons/logger').getLogger('playground-router');
const {ClientError, PlaygroundCodeError} = require('../../../errors');
const {runPlaygroundTest, stopPlaygroundTest, CODE_TYPES} = require('./service');
const {DISABLE_AGENT_ORIGIN_CHECK} = require('../../../commons/config');

const VALID_HOSTS = ['localhost', 'app.testim.io', 'playground.testim.io', 'staging.testim.io', 'app.staging.testim.cc'];

const parseUrl = (url) => {
    if(!url) {
        return {};
    }
    try {
        return new URL(url);
    } catch (e) {
        return {};
    }
};

const checkReferer = (req, res, next) => {
    if(DISABLE_AGENT_ORIGIN_CHECK) {
        return next();
    }
    const referer = req.headers.referer;
    const origin = req.headers.origin;
    if(!referer && !origin) {
        return res.status(400).send();
    }
    const refererUrl = parseUrl(referer);
    const originUrl = parseUrl(origin);
    if(!VALID_HOSTS.includes(refererUrl.hostname) && !VALID_HOSTS.includes(originUrl.hostname)) {
        return res.status(400).send();
    }
    return next();
};

router.post('/run', [checkReferer], async (req, res) => {
    const body = req.body || {};
    const { code, type } = body;

    if (!code || !CODE_TYPES.includes(type)) {
        res.status(400).send({ success: false, reason: 'missing arguments' });
        return;
    }

    try {
        await runPlaygroundTest(body);
        res.send({ success: true });
    } catch (e) {
        if(e instanceof ClientError) {
            res.status(404).send({ success: false });
            return undefined;
        }
        if(e instanceof PlaygroundCodeError) {
            res.json({ success: false, type: 'playground-error', stack: e.innerStack });
            return undefined;
        }
        res.json({ success: false, reason: e.message });
        logger.error(e);
    }
});

router.post('/stop', (req, res) => {
    try {
        stopPlaygroundTest();
        res.send({ success: true });
    } catch (e) {
        res.json({ success: false, reason: e.message });
        logger.error(e);
    }
});

module.exports.router = router;

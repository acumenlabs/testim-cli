"use strict";

const express = require('express');
const router = express.Router();
const logger = require('../../../commons/logger').getLogger("codim-router");

const {
    findTests,
    getLocalLocators,
    getLocalLocatorContents,
    saveTest,
    saveLocators,
    compileFunctionsLibrary
} = require('./service');


router.get('/tests', async (req, res) => {
    const tests = await findTests();
    res.json({tests, success: true });
});
router.get('/locators', async (req, res) => {
    const locators = await getLocalLocators();
    const contents = await getLocalLocatorContents(locators, req.query.full);
    res.json({locators, contents, success: true });
});
router.post('/locators', async (req, res) => {

    if (!req.body) {
        res.status(400).send({success: false, reason: 'missing body' });
        return;
    }
    if (!req.body.locators) {
        res.status(400).send({success: false, reason: 'missing locators' });
        return;
    }

    const { locators, mergeIntoExisting } = req.body;

    await saveLocators(locators, { mergeIntoExisting: mergeIntoExisting || false });
    res.status(200).send({ success: true })
});

router.get('/compile', async (req, res) => {
    try {
        const code = await compileFunctionsLibrary(req.body.name);
        res.send({ success: true, code })
    } catch (e) {
        logger.error(e);
        res.json({ success: false, reason: e.message });
    }
});

router.post('/saveTest', async (req, res) => {

    if (!req.body) {
        res.status(400).send({success: false, reason: 'missing body' });
        return;
    }
    try {
       await saveTest(req.body);
       res.send({ success: true });
    } catch (e) {
        res.json({success: false, reason: e.message });
        logger.error(e);
        return;
    }

});



module.exports.router = router;

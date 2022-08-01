"use strict";

const Promise = require('bluebird');
const express = require('express');
const service = require('./service');
const {NpmPackageError} = require('../../../errors');
const logger = require('../../../commons/logger').getLogger("cli-router");
const chalk = require('chalk');

const router = express.Router();

router.post('/run', (req, res) => {
    const {code, stepId, incomingParams, context, testResultId, retryIndex, stepResultId, timeout, fileDataUrl} = req.body;

    if (typeof code !== "string" || !stepId || !incomingParams || !context || !testResultId || typeof retryIndex !== "number" || !stepResultId || typeof timeout !== "number") {
        return res.status(400).json({success: false, code: "invalid-params"});
    }

    return service.runCodeWithPackages(code, stepId, incomingParams, context, testResultId, retryIndex, stepResultId, timeout, fileDataUrl)
        .then(data => {
            if(!data.success) {
                console.log(chalk.red(data.result.resultValue));
                logger.error('CLI Action Failure', {message: data.result.resultValue });
            }
            res.status(200).json({success: true, data});
        })
        .catch(err => {
            logger.error("failed to run cli code", {err});
            console.log(chalk.red("failed to run cli code", err));
            res.status(500).json({success: false, code: "internal-error"});
        });
});

router.post('/install', (req, res) => {
    const {stepId, testResultId, retryIndex, packageData, stepResultId, timeout} = req.body;

    if (!stepId || typeof packageData !== "object" || !testResultId || typeof retryIndex !== "number" || !stepResultId || typeof timeout !== "number") {
        return res.status(400).json({success: false, code: "invalid-params"});
    }

    return service.installPackage(stepId, testResultId, retryIndex, packageData, stepResultId, timeout)
        .then(data => {
            logger.info("installed packages successfully");
            res.status(200).json({success: true, data});
        })
        .catch(NpmPackageError, err => {
            logger.error("failed to install node packages", {err});
            res.status(200).json({success: false, code: "invalid-node-package", message: err.message});
        })
        .catch(Promise.TimeoutError, () => {
            logger.error("timeout installing node package");
            return res.status(200).json({success: false, code: "timeout"});
        })
        .catch(err => {
            logger.error("failed to install node packages", {err});
            res.status(500).json({success: false, code: "internal-error"});
        });
});

module.exports = router;

'use strict';

const service = require('../../../stepPlayers/hybridStepPlayback');
const express = require('express');
const lazyRequire = require('../../../commons/lazyRequire');
const logger = require('../../../commons/logger').getLogger("hybrid-router");

/**
 * @param {{
    webdriverApi: import("../../../player/WebdriverioWebDriverApi")
}} [testimStandaloneBrowser]
 */
module.exports.hybridRoutes = function hybridRoutes(testimStandaloneBrowser) {
    const router = express.Router();

    router.post('/run', (req, res) => {
        if (!req.body || !req.body.step) {
            res.status(400).send({
                error: "Missing step"
            });
            return;
        }

        const {
            step,
            context,
            loginData // is this safe to pass here?
        } = req.body;
        if (!testimStandaloneBrowser.webdriverApi) {
            res.status(503).send({success: false, reason: 'Testim Agent was not started with Testim Start.' });
        }

        // The step run might take very long time, and it will still be valid
        // so we set here unlimited timeout
        req.setTimeout(0)

        service.execute(
            step,
            context,
            testimStandaloneBrowser.webdriverApi,
            loginData,
            undefined, // don't pass frameManager,
            'agent'
            ).then((result) => {
                res.status(200).send(result);
            }).catch(e => {
                logger.error("failed to run hybrid code", { e });
                res.status(500).send(Object.assign({success: false, error: e }));
            });
    });

    router.post('/abort', (req, res) => {
        if (!req.body || !req.body.stepResultId) {
            res.status(400).send({
                error: `missing stepResultId`
            });

            return;
        }

        try {
            service.abort(req.body.stepResultId);
            res.status(204).end();
        } catch (e) {
            if (e && e.message === "No such stepResultId") {
                res.status(400).send({
                    error: `No such stepResultId`
                });
                return;
            }

            logger.error("hybrid code abort unexpected error", { e });
            res.status(500).send({
                error: "unexpected error",
                info: `${e ? e.message : "N/A"}`
            });
        }
    });

    return router;
}

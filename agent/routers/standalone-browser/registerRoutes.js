// @ts-check
"use strict";

const express = require('express');

module.exports = {
    standaloneBrowserRoutes
}

/**
 * @param {{
    webdriverApi: import("../../../player/WebdriverioWebDriverApi")
}} [testimStandaloneBrowser]
 */
function standaloneBrowserRoutes(testimStandaloneBrowser) {

    const router = express.Router();

    router.get("/cdp-url", (req, res) => {
        if (!testimStandaloneBrowser) {
            res.status(503).send({
                error: "Testim standalone browser is not running"
            });

            return;
        }

        res.status(200).send({
            url: testimStandaloneBrowser.webdriverApi.cdpUrl
        });
    });

    router.get("/status", (req, res) => {
        if (!testimStandaloneBrowser) {
            res.status(503).send({
                ok: false
            });
            return;
        }

        res.status(200).send({
            ok: true
        });
    });

    return router;
}

"use strict";

const compression = require('compression');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { IS_ON_PREM, DISABLE_AGENT_ORIGIN_CHECK } = require('../../commons/config');


module.exports = function(beforeMiddleware, standaloneBrowserInfo) {
    const app = express();
    beforeMiddleware(app);

    // view engine setup
    app.use(bodyParser.urlencoded({extended: false, limit: '50mb'}));
    app.use(compression());
    app.use(bodyParser.json({limit: '50mb'}));

    /**
     * set cors options
     */

    const whitelist = ['http://localhost:3000', 'https://app.testim.io', 'https://staging.testim.io', 'https://playground.testim.io', 'https://app.staging.testim.cc', 'chrome-extension://pebeiooilphfmbohdbhbomomkkoghoia'];
    const corsOptions = {
        methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
        maxAge: 86400,
        origin: (IS_ON_PREM || DISABLE_AGENT_ORIGIN_CHECK) ? '*' : whitelist
    }
    app.use('*', cors(corsOptions));

    // Routes
    require('./general')(app);

    app.use('/files', require('./codim/router').router);

    app.use('/playground', require('./playground/router').router);

    const cliJsCode = require('./cliJsCode');
    app.use('/cliJs', cliJsCode.router);

    app.use('/standalone-browser',
        require("./standalone-browser/registerRoutes").standaloneBrowserRoutes(standaloneBrowserInfo)
    );

    app.use('/hybrid', require('./hybrid/registerRoutes').hybridRoutes(standaloneBrowserInfo));

    // catch 404
    app.use((req, res) => {
        res.status(404).send('Endpoint Not Found');
    });

    return app;
};

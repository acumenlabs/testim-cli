'use strict';

const Promise = require('bluebird');
const { ArgError } = require('../errors');
const testimCustomToken = require('../commons/testimCustomToken');
const lazyRequire = require('../commons/lazyRequire');
const { prepareChromeDriver } = require('../commons/prepareRunnerAndTestimStartUtils');

module.exports = {
    init,
};

/**
 *
 * @param {*} param0
 * @param {{
    webdriverApi: import("../player/WebdriverioWebDriverApi")
}} [testimStandaloneBrowser]
*/
async function init({
    agentPort,
    agentBind,
    project,
    token,
    installPlaygroundPlaywrightDeps,
    installPlaygroundPuppeteerDeps,
    installPlaygroundSeleniumDeps,
}, testimStandaloneBrowser) {
    await installExternalPackages({
        installPlaygroundPlaywrightDeps,
        installPlaygroundPuppeteerDeps,
        installPlaygroundSeleniumDeps,
        project,
    });
    await initServer({
        agentPort,
        agentBind,
        project,
        token,
    }, testimStandaloneBrowser);
}

/**
 *
 * @param {*} param0
 * @param {{
        webdriverApi: import("../player/WebdriverioWebDriverApi")
    }} [testimStandaloneBrowser]
 */
function initServer({
    agentPort, agentBind, project, token,
}, testimStandaloneBrowser) {
    return new Promise((resolve, reject) => {
        /**
         * Init testim auth for making services request.
         */
        let initFn = () => { };
        if (project) {
            testimCustomToken.init(project, token);
            initFn = (app) => {
                app.use((req, res, next) => {
                    req.project = project;
                    next();
                });
            };
        }

        const app = require('./routers')(initFn, testimStandaloneBrowser);
        const http = require('http');

        /**
         * Create HTTP server.
         */

        const server = http.createServer(app);

        /**
         * Listen on provided port, on all network interfaces.
         */
        server.listen(agentPort, agentBind);

        // logger.info('Node Version', process.version);

        server.on('error', onError);
        server.on('listening', onListening);

        /**
         * Event listener for HTTP server "error" event.
         */

        function onError(error) {
            if (error.syscall !== 'listen') {
                return reject(error);
            }

            // handle specific listen errors with friendly messages
            switch (error.code) {
                case 'EACCES':
                case 'EPERM':
                    return reject(new ArgError(`Port ${agentPort} requires elevated privileges`));
                case 'EADDRINUSE':
                    return reject(new ArgError(`Port ${agentPort} is already in use, is another Testim instance running?`));
                default:
                    return reject(error);
            }
        }

        /**
         * Event listener for HTTP server "listening" event.
         */

        function onListening() {
            const { port } = server.address();
            console.log(`Running on port: ${port}`);
            showStartStopOptions();
        }
    });
}

function installExternalPackages({ installPlaygroundPlaywrightDeps, installPlaygroundPuppeteerDeps, installPlaygroundSeleniumDeps, project }) {
    const all = [];
    if (installPlaygroundPlaywrightDeps) {
        all.push(lazyRequire('playwright'));
    }

    if (installPlaygroundPuppeteerDeps) {
        all.push(lazyRequire('puppeteer'));
    }

    if (installPlaygroundSeleniumDeps) {
        all.push(lazyRequire('selenium-webdriver'));
        all.push(prepareChromeDriver({ projectId: project }));
    }

    return Promise.all(all);
}


async function showStartStopOptions() {
    const prompts = require('prompts');
    const isMac = process.platform === 'darwin';
    const sigint = 'Ctrl + C';
    await prompts({
        type: 'text',
        message: `Type the word "stop" or Press ${sigint}.`,
        validate: x => x.toUpperCase().trim() === 'STOP',
    });
    console.log('Exiting Testim CLI');
    process.exit(0);
}

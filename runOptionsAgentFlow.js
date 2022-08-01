// @ts-check

'use strict';

const { ArgError } = require('./errors');
const _ = require('lodash');
const runOptionsUtils = require('./runOptionsUtils');
const analytics = require('./commons/testimAnalytics');

/**
 *
 * @param {import("commander").CommanderStatic} program
 */
function isAgentFlow(program) {
    if (program.start) {
        analytics.track(null, 'cli-start-command', { downloadBrowser: Boolean(program.downloadBrowser) });
    }
    if (program.startV2 || program.start || program.agent) {
        return true;
    }

    return false;
}

/**
 *
 * @param {Readonly<import("commander").CommanderStatic>} program
 */
async function runAgentFlow(program) {
    const agentModes = ['playground-playwright', 'playground-puppeteer', 'playground-selenium'];
    let installPlaygroundPlaywrightDeps = false;
    let installPlaygroundPuppeteerDeps = false;
    let installPlaygroundSeleniumDeps = false;

    let startTestimBrowser = false;

    if (program.start) {
        startTestimBrowser = true;
    }

    if (_.isNaN(program.agentPort)) {
        return Promise.reject(new ArgError('Agent port is not number'));
    }

    if (typeof program.agent === 'string' && agentModes.some(mode => program.agent.includes(mode))) {
        const selectedModes = program.agent.split(',').map(mode => mode.trim());
        if (selectedModes.includes('playground-playwright')) {
            installPlaygroundPlaywrightDeps = true;
        }

        if (selectedModes.includes('playground-puppeteer')) {
            installPlaygroundPuppeteerDeps = true;
        }

        if (selectedModes.includes('playground-selenium')) {
            installPlaygroundSeleniumDeps = true;
        }
    }

    const playerUrl = runOptionsUtils.getPlayerUrl(program);

    console.log('Start Testim CLI on Agent mode');
    return {
        project: program.project,
        token: program.token,
        agentMode: true,
        agentPort: program.agentPort,
        agentBind: program.agentBind,
        openEditor: program.openEditor,
        installPlaygroundPlaywrightDeps,
        installPlaygroundPuppeteerDeps,
        installPlaygroundSeleniumDeps,
        startTestimBrowser,
        ext: program.ext,
        extensionPath: program.extensionPath,
        playerLocation: program.playerPath || playerUrl,
        canary: program.canary,
        playerPath: program.playerPath,
        playerRequirePath: program.playerRequirePath,
        downloadBrowser: Boolean(program.downloadBrowser),
    };
}

module.exports = {
    isAgentFlow,
    runAgentFlow,
};

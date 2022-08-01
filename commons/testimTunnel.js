'use strict';

const ora = require('ora');

const LambdatestService = require('../services/lambdatestService');
const processHandler = require('../processHandler');
const testimCustomToken = require('./testimCustomToken');
const { gridTypes } = require('./constants');
const testimNgrok = require('./testimNgrok');
const testimCloudflare = require('./testimCloudflare');
const logger = require('./logger').getLogger('tunnel');

const shouldUseLambdatestTunnel = options => [gridTypes.LAMBDATEST, gridTypes.HYBRID].includes(options.gridData && options.gridData.type) && options.gridData.tunnel === 'lambdatest';
const shouldUseCloudflareTunnel = options => options.tunnelRoutes || (options.gridData && options.gridData.type === gridTypes.HYBRID && options.gridData.tunnel === 'cloudflare');

const connect = async (options) => {
    if (!options.tunnel) {
        return;
    }

    const authData = testimCustomToken.getTokenV3UserData();
    let spinner;
    try {
        if (shouldUseLambdatestTunnel(options)) {
            spinner = ora('Starting testim lambdatest tunnel...').start();
            await LambdatestService.connectTunnel(options);
        } else if (shouldUseCloudflareTunnel(options)) {
            spinner = ora('Starting testim cloudflare tunnel...').start();
            await testimCloudflare.connectTunnel(options);
        } else {
            spinner = ora('Starting testim ngrok tunnel...').start();
            await testimNgrok.connectTunnel(options, authData);
        }
        spinner.succeed();
    } catch (err) {
        const msg = 'Failed to start tunnel. Please contact support@testim.io';
        logger.error('Failed to open tunnel', { err });
        spinner.fail(msg);
        throw new Error(msg);
    }
};

const disconnect = async (options) => {
    if (!options.tunnel) {
        return;
    }

    try {
        if (shouldUseLambdatestTunnel(options)) {
            await LambdatestService.disconnectTunnel(options);
        } else if (options.tunnelRoutes) {
            await testimCloudflare.disconnectTunnel(options);
        } else {
            await testimNgrok.disconnectTunnel(options);
        }
    } catch (err) {
        const msg = 'catch error - failed to close tunnel';
        logger.error(msg, { err });
        throw new Error(msg);
    }
};

const serveTunneling = async (options, waitFor = new Promise(() => { /* avoid exiting process */ })) => {
    await module.exports.connect(options);
    processHandler.registerExitHook(() => module.exports.disconnect(options));
    return await waitFor;
};

module.exports = {
    connect,
    disconnect,
    serveTunneling,
};

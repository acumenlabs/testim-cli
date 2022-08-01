'use strict';

const { ArgError } = require('../errors.js');
const utils = require('../utils.js');
const lazyRequire = require('./lazyRequire');
const logger = require('./logger').getLogger('testimNgrok');

const WHITELISTED_TUNNEL_DOMAIN_SUFFIX = '.whitelisted-ngrok.testim.io';

let ngrokTunnelUrl = '';
let statsTimeout;

const connectTunnel = async (options, authData = {}) => {
    if (!authData.ngrokToken) {
        throw new ArgError('tunnel feature is not enabled, please contact support - info@testim.io.');
    }

    let hostname;
    if (authData.isNgrokWhitelisted) {
        hostname = `${utils.guid()}-${options.projectData.projectId}${WHITELISTED_TUNNEL_DOMAIN_SUFFIX}`;
    }

    const connectOpt = {
        proto: 'http',
        addr: options.tunnelPort || 80,
        authtoken: authData.ngrokToken,
        hostname,
    };
    if (options.tunnelHostHeader) {
        // eslint-disable-next-line camelcase
        connectOpt.host_header = options.tunnelHostHeader;
    }
    if (options.tunnelRegion) {
        connectOpt.region = options.tunnelRegion;
    }

    const ngrok = await lazyRequire('ngrok');
    const url = await ngrok.connect(connectOpt);

    if (options.tunnelUseHttpAddress && url.startsWith('https://')) {
        logger.info('replace https to http');
        const newUrl = url.replace('https://', 'http://');

        ngrokTunnelUrl = newUrl;
    } else {
        ngrokTunnelUrl = url;
    }

    if (options.tunnelDiagnostics) {
        module.exports.collectNgrokStats();
    }
    options.baseUrl = ngrokTunnelUrl;
};

const collectNgrokStats = async (rerun = true) => {
    try {
        const ngrok = await lazyRequire('ngrok');
        const api = ngrok.getApi();
        const { tunnels } = await api.get({ url: 'api/tunnels', json: true });
        const tunnel = tunnels.find(t => t.public_url === ngrokTunnelUrl);

        // eslint-disable-next-line no-console
        console.log('ngrok stats', tunnel);
        logger.info('ngrok stats', { tunnel });
    } catch (err) {
        logger.error('error collecting ngrok stats', { err });
    }
    if (rerun) {
        statsTimeout = setTimeout(() => module.exports.collectNgrokStats(), 10000);
    }
};

const disconnectTunnel = async (options) => {
    if (!ngrokTunnelUrl) {
        return;
    }

    clearTimeout(statsTimeout);
    if (options.tunnelDiagnostics) {
        await module.exports.collectNgrokStats(false);
    }
    const ngrok = await lazyRequire('ngrok');
    await ngrok.disconnect(ngrokTunnelUrl);
};

module.exports = {
    connectTunnel,
    disconnectTunnel,
    collectNgrokStats,
};

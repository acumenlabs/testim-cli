'use strict';

const os = require('os');
const childProcess = require('child_process');
const fse = require('fs-extra');
const utils = require('../utils');
const servicesApi = require('./testimServicesApi.js');

const TUNNEL_BINARY_ORIGIN = 'https://github.com/cloudflare/cloudflared/releases/download/2022.4.1/';
const TUNNEL_BINARY_PATHNAME = {
    win32ia32: { path: 'cloudflared-windows-386.exe' },
    win32x64: { path: 'cloudflared-windows-amd64.exe' },
    darwinx64: { path: 'cloudflared-darwin-amd64.tgz', extract: true },
    linuxia32: { path: 'cloudflared-linux-386' },
    linuxx64: { path: 'cloudflared-linux-amd64' },
};
const TUNNEL_BINARY_DIRECTORY = os.tmpdir();
const TUNNEL_BINARY_LOCATION = `${TUNNEL_BINARY_DIRECTORY}/cloudflared`;


let tunnelId = null;
let tunnelProcess = null;

async function prepareTunnel() {
    const isBinaryExist = await fse.pathExists(TUNNEL_BINARY_LOCATION);
    if (isBinaryExist) {
        return;
    }

    const downloadUrl = TUNNEL_BINARY_PATHNAME[os.platform() + os.arch()];
    if (!downloadUrl) {
        throw new Error(`tunnel on ${os.platform() + os.arch()} platform is not supported.`);
    }
    const destination = downloadUrl.extract ? TUNNEL_BINARY_DIRECTORY + downloadUrl.path : TUNNEL_BINARY_LOCATION;
    await utils.downloadAndSave(`${TUNNEL_BINARY_ORIGIN}/${downloadUrl.path}`, destination);
    if (downloadUrl.extract) {
        await utils.unzipFile(destination, TUNNEL_BINARY_DIRECTORY);
    }
    await fse.chmodSync(TUNNEL_BINARY_LOCATION, '755');
}

const connectTunnel = async (options) => {
    const tunnelBaseUrl = options.baseUrl || `http://localhost:${options.tunnelPort || 80}`;
    const tunnelRoutes = options.tunnelRoutes || [tunnelBaseUrl];
    const [result] = await Promise.all([
        servicesApi.getCloudflareTunnel(options.company.companyId, tunnelRoutes),
        module.exports.prepareTunnel(),
    ]);
    tunnelId = result._id;
    tunnelProcess = childProcess.spawn(TUNNEL_BINARY_LOCATION, ['tunnel', '--no-autoupdate', 'run', '--force', '--token', result.token], { stdio: 'inherit' });
    await servicesApi.forceUpdateCloudflareTunnelRoutes(options.company.companyId, tunnelId);

    if (options.tunnelRoutesOutput) {
        await fse.writeFileSync(options.tunnelRoutesOutput, JSON.stringify(result.routesMapping, null, 2));
    }

    options.baseUrl = `${options.tunnelUseHttpAddress ? 'http' : 'https'}://${result.routesMapping[tunnelBaseUrl]}`;
};

const disconnectTunnel = async (options) => {
    const promises = [];
    if (tunnelId) {
        promises.push(servicesApi.deleteCloudflareTunnel(options.company.companyId, tunnelId));
    }
    if (tunnelProcess) {
        promises.push(new Promise((resolve, reject) => {
            tunnelProcess.on('close', (code) => {
                if (code) {
                    reject(new Error(`tunnel process exited with code ${code}`));
                }
                resolve();
            });
            tunnelProcess.kill();
        }));
    }
    return await Promise.all(promises);
};

module.exports = {
    connectTunnel,
    disconnectTunnel,
    prepareTunnel,
};

const os = require('os');
const childProcess = require('child_process');
const pRetry = require('p-retry');
const fse = require('fs-extra');
const portfinder = require('portfinder');
const ms = require('ms');

const { guid, isURL } = require('../utils');
const utils = require('../utils');
const { gridTypes, CLI_MODE } = require('../commons/constants');
const httpRequest = require('../commons/httpRequest');
const { ArgError } = require('../errors');
const servicesApi = require('../commons/testimServicesApi');
const { getExtensionsUrl } = require('../runOptionsUtils');
const featureFlagService = require('../commons/featureFlags');

const logger = require('../commons/logger').getLogger('lambdatestService');

const LT_TUNNEL_BINARY_ORIGIN = 'https://downloads.lambdatest.com/tunnel/v3';
const LT_TUNNEL_BINARY_PATHNAME = {
    win32ia32: 'windows/32bit/LT_Windows.zip',
    win32x64: 'windows/64bit/LT_Windows.zip',
    darwinia32: 'mac/32bit/LT_Mac.zip',
    darwinx64: 'mac/64bit/LT_Mac.zip',
    linuxia32: 'linux/32bit/LT_Linux.zip',
    linuxx64: 'linux/64bit/LT_Linux.zip',
    freebsdia32: 'freebsd/32bit/LT_Freebsd.zip',
    freebsdx64: 'freebsd/64bit/LT_Freebsd.zip',
};
const LT_TUNNEL_BINARY_DIRECTORY = `${os.tmpdir()}/LT`;
const LT_TUNNEL_BINARY_LOCATION = `${LT_TUNNEL_BINARY_DIRECTORY}/LT`;

const LT_MINIMUM_CONNECTION_RETRY_TIMEOUT = ms('15m');

class LambdatestService {
    constructor() {
        this.isActive = false;
    }

    static isLambdatestGrid(gridData) {
        return gridData.type === gridTypes.LAMBDATEST || (gridData.type === gridTypes.HYBRID && gridData.provider === 'lambdatest');
    }

    isLambdatestRun() {
        return this.isActive;
    }

    async enableIfNeeded(gridData) {
        if (!LambdatestService.isLambdatestGrid(gridData)) {
            return;
        }

        LambdatestService.lambdatestConfigPromise = LambdatestService.lambdatestConfigPromise || servicesApi.fetchLambdatestConfig();
        LambdatestService.lambdatestConfig = await LambdatestService.lambdatestConfigPromise;
        this.isActive = true;
    }

    disable() {
        this.isActive = false;
    }

    get getSessionTimeout() {
        if (!this.isActive) {
            return null;
        }
        return LT_MINIMUM_CONNECTION_RETRY_TIMEOUT;
    }

    get getSessionRetries() {
        if (!this.isActive) {
            return null;
        }
        return 1;
    }

    // https://www.lambdatest.com/support/docs/beta-lambda-tunnel-for-corporate-firewalls/
    static async prepareTunnel() {
        const isBinaryExist = await fse.pathExists(LT_TUNNEL_BINARY_LOCATION);
        if (isBinaryExist) {
            return;
        }

        const downloadUrl = LT_TUNNEL_BINARY_PATHNAME[os.platform() + os.arch()];
        if (!downloadUrl) {
            throw new Error(`tunnel on ${os.platform() + os.arch()} platform is not supported.`);
        }
        const zipLocation = `${LT_TUNNEL_BINARY_DIRECTORY}.zip`;
        await utils.downloadAndSave(`${LT_TUNNEL_BINARY_ORIGIN}/${downloadUrl}`, zipLocation);
        await utils.unzipFile(zipLocation, LT_TUNNEL_BINARY_DIRECTORY);
    }

    static async connectTunnel(runnerOptions) {
        if (runnerOptions.externalLambdatestTunnelId) {
            LambdatestService.tunnelName = runnerOptions.externalLambdatestTunnelId;
            return;
        }
        await this.prepareTunnel();
        const infoAPIPort = await portfinder.getPortPromise();
        const { gridData = {}, gridUsername, gridPassword } = runnerOptions;
        const proxyUri = global.proxyUri;
        LambdatestService.tunnelName = guid();

        let tunnelArgs = [
            '--tunnelName', LambdatestService.tunnelName,
            '--infoAPIPort', infoAPIPort,
        ];

        if (runnerOptions.externalLambdatestUseWss) {
            tunnelArgs = [...tunnelArgs, '--mode', 'ws'];
        }
        if (runnerOptions.externalLambdatestDisableAutomationTunneling) {
            tunnelArgs = [...tunnelArgs, '--bypassHosts', 'run.testim.io,services.testim.io,api.coralogix.com,conf.rollout.io,statestore.rollout.io,push.rollout.io,analytic.rollout.io,res.cloudinary.com'];
        }

        if (gridData.tunnelUser && gridData.tunnelKey) {
            tunnelArgs = [...tunnelArgs, '--user', gridData.tunnelUser, '--key', gridData.tunnelKey];
        } else if (gridUsername && gridPassword) {
            tunnelArgs = [...tunnelArgs, '--user', gridUsername, '--key', gridPassword];
        } else {
            throw new ArgError('tunnel requires username and password');
        }

        if (proxyUri) {
            try {
                const proxyUrl = new URL(proxyUri);
                tunnelArgs = [...tunnelArgs, '--proxy-host', proxyUrl.hostname];
                if (proxyUrl.port) {
                    tunnelArgs = [...tunnelArgs, '--proxy-port', proxyUrl.port];
                }
                if (proxyUrl.username && proxyUrl.password) {
                    tunnelArgs = [...tunnelArgs, '--proxy-user', proxyUrl.username, '--proxy-pass', proxyUrl.password];
                }
            } catch (e) {
                throw new ArgError('proxy url is invalid');
            }
        }

        if (runnerOptions.externalLambdatestMitm) {
            tunnelArgs = [...tunnelArgs, '--mitm'];
        }

        LambdatestService.tunnel = childProcess.spawn('./LT', tunnelArgs, { cwd: LT_TUNNEL_BINARY_DIRECTORY });

        let stdoutResult = '';
        let stderrResult = '';

        LambdatestService.tunnel.stdout.on('data', (data) => {
            stdoutResult += data.toString();
        });

        LambdatestService.tunnel.stderr.on('data', (data) => {
            stderrResult += data.toString();
        });

        // verify that LT tunnel strated successfully
        try {
            const ltInfo = await pRetry(() => httpRequest.get(`http://127.0.0.1:${infoAPIPort}/api/v1.0/info`, {}, {}, undefined, { skipProxy: true }), { retries: 30, minTimeout: 2000 });
            logger.info('LT tunnel info', ltInfo);
        } catch (err) {
            logger.error('Failed to start LT tunnel', { err, stdoutResult, stderrResult });
            throw err;
        }
    }

    static async disconnectTunnel(runnerOptions) {
        if (runnerOptions.externalLambdatestTunnelId || !LambdatestService.tunnel) {
            return undefined;
        }
        return new Promise((resolve, reject) => {
            LambdatestService.tunnel.on('close', (code) => {
                if (code) {
                    reject(new Error(`tunnel process exited with code ${code}`));
                }
                resolve();
            });
            LambdatestService.tunnel.kill();
        });
    }

    getCapabilities(runnerOptions, browser, executionId, testResultId, testName) {
        if (!this.isActive) {
            return {};
        }

        const defaultBrowserCaps = LambdatestService.lambdatestConfig.CAPABILITIES[browser] || {};


        const tunnelCaps = {};
        if (LambdatestService.tunnelName) {
            tunnelCaps.tunnel = true;
            tunnelCaps.tunnelName = LambdatestService.tunnelName;
        }

        let loadExtension = [];
        const { mode, canary, ext, extensionPath, installCustomExtension } = runnerOptions;
        if (mode === CLI_MODE.EXTENSION && !ext) {
            const extUrls = getExtensionsUrl({ canary }, true);
            if (!extensionPath && extUrls[browser]) {
                loadExtension = [...loadExtension, extUrls[browser]];
            }
            if (extensionPath && isURL(extensionPath)) {
                loadExtension = [...loadExtension, extensionPath];
            }
        }
        if (installCustomExtension && isURL(installCustomExtension)) {
            loadExtension = [...loadExtension, installCustomExtension];
        }

        return {
            build: executionId,
            name: `${testResultId} - ${testName}`,
            platform: LambdatestService.lambdatestConfig.PLATFORM,
            // eslint-disable-next-line camelcase
            selenium_version: LambdatestService.lambdatestConfig.SELENIUM_VERSION,
            resolution: LambdatestService.lambdatestConfig.RESOLUTION,
            timezone: LambdatestService.lambdatestConfig.TIMEZONE,
            ...defaultBrowserCaps,
            loadExtension,
            ...tunnelCaps,
            console: true,
            queueTimeout: 300, // time a session spends in the LT queue, in seconds (apparently 300 is the minimum)
            // visual: true, // [NOTE]: activate LT screenshots feature (can slow test).
            network: featureFlagService.flags.LTNetworkCapabilities.isEnabled(), // [NOTE]: activate LT capture network logs feature (can cause network issues).
            // fixedIP: '10.80.34.143', // [NOTE]: this is for debug purposes with LT team.
        };
    }
}
module.exports = LambdatestService;

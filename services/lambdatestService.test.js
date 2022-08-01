const { expect, sinon } = require('../../test/utils/testUtils');
const servicesApi = require('../commons/testimServicesApi');
const httpRequest = require('../commons/httpRequest');
const LambdatestService = require('./lambdatestService');
const utils = require('../utils');
const fse = require('fs-extra');
const { AbortError } = require('p-retry');
const os = require('os');
const childProcess = require('child_process');
const EventEmitter = require('events');
const portfinder = require('portfinder');
const { getExtensionsUrl } = require('../runOptionsUtils');

class Process extends EventEmitter {
    constructor() {
        super();
        this.stdout = new EventEmitter();
        this.stderr = new EventEmitter();
    }
    setCode(code) {
        this.code = code;
    }
    kill() {
        this.emit('close', this.code);
    }
}

describe('LambdatestService', () => {
    let sandbox;
    let lambdatestService;
    beforeEach(() => {
        lambdatestService = new LambdatestService();
        sandbox = sinon.createSandbox();
    });
    afterEach(() => {
        sandbox.restore();
    });

    describe('isLambdatestGrid', () => {
        it('should consider a lambda test grid as a lambda test grid', () => {
            expect(LambdatestService.isLambdatestGrid({ type: 'testimLambdaTest' })).to.be.true;
        });
        it('should consider a hybrid grid as a lambda test grid according to ist provider', () => {
            expect(LambdatestService.isLambdatestGrid({ type: 'testimHybrid', provider: 'lambdatest' })).to.be.true;
            expect(LambdatestService.isLambdatestGrid({ type: 'testimHybrid', provider: 'other' })).to.be.false;
        });
    });

    describe('isLambdatestRun', () => {
        it('should consider a lambda test run as a lambda test run', () => {
            lambdatestService.isActive = true;
            expect(lambdatestService.isLambdatestRun()).to.be.true;
        });

        it('should consider non lambda test run as non lambda test run', () => {
            lambdatestService.isActive = false;
            expect(lambdatestService.isLambdatestRun()).to.be.false;
        });
    });

    describe('enableIfNeeded', () => {
        let fetchLambdatestConfigStub;
        beforeEach(() => {
            fetchLambdatestConfigStub = sinon.stub(servicesApi, 'fetchLambdatestConfig').resolves({});
        });
        afterEach(() => {
            fetchLambdatestConfigStub.restore();
            delete LambdatestService.lambdatestConfigPromise;
            delete LambdatestService.lambdatestConfig;
        });

        it('should not enable lambdatest for non lt grid', async () => {
            await lambdatestService.enableIfNeeded({});
            expect(lambdatestService.isActive).to.be.false;
            sinon.assert.notCalled(fetchLambdatestConfigStub);
        });

        it('should enable lambdatest for lt grid', async () => {
            await lambdatestService.enableIfNeeded({ type: 'testimLambdaTest' });
            expect(lambdatestService.isActive).to.be.true;
            sinon.assert.calledOnce(fetchLambdatestConfigStub);
        });

        it('should enable lambdatest for hybrid grid with lt provider', async () => {
            await lambdatestService.enableIfNeeded({ type: 'testimHybrid', provider: 'lambdatest' });
            expect(lambdatestService.isActive).to.be.true;
            sinon.assert.calledOnce(fetchLambdatestConfigStub);
        });

        it('should not enable lambdatest for hybrid grid with other provider', async () => {
            await lambdatestService.enableIfNeeded({ type: 'testimHybrid', provider: 'other' });
            expect(lambdatestService.isActive).to.be.false;
            sinon.assert.notCalled(fetchLambdatestConfigStub);
        });

        it('should cache lambdatest config', async () => {
            await lambdatestService.enableIfNeeded({ type: 'testimLambdaTest' });
            await lambdatestService.enableIfNeeded({ type: 'testimLambdaTest' });
            sinon.assert.calledOnce(fetchLambdatestConfigStub);
        });
    });

    describe('specific lt capabilities', () => {
        it('should return lt session timeout for lt grid', async () => {
            lambdatestService.isActive = true;
            expect(lambdatestService.getSessionTimeout).to.be.equal(900000);
            lambdatestService.isActive = false;
            expect(lambdatestService.getSessionTimeout).to.be.equal(null);
        });

        it('should return lt session retries for lt grid', async () => {
            lambdatestService.isActive = true;
            expect(lambdatestService.getSessionRetries).to.be.equal(1);
            lambdatestService.isActive = false;
            expect(lambdatestService.getSessionRetries).to.be.equal(null);
        });

        it('should not return lt special selenium capabilities when inactove', () => {
            lambdatestService.isActive = false;
            expect(lambdatestService.getCapabilities({})).to.eql({});
        });

        it('should return lt selenium capabilities', () => {
            const browser = utils.guid();
            const executionId = utils.guid();
            const testResultId = utils.guid();
            const testName = utils.guid();

            lambdatestService.isActive = true;
            LambdatestService.lambdatestConfig = {
                CAPABILITIES: { [browser]: { specificBrowserCaps: 123 } },
            };

            expect(lambdatestService.getCapabilities({}, browser, executionId, testResultId, testName)).to.shallowDeepEqual({
                build: executionId,
                name: `${testResultId} - ${testName}`,
                platform: LambdatestService.lambdatestConfig.PLATFORM,
                // eslint-disable-next-line camelcase
                selenium_version: LambdatestService.lambdatestConfig.SELENIUM_VERSION,
                resolution: LambdatestService.lambdatestConfig.RESOLUTION,
                timezone: LambdatestService.lambdatestConfig.TIMEZONE,
                specificBrowserCaps: 123,
                console: true,
                queueTimeout: 300,
            });
        });

        it('should return lt tunnel name as part of selenium capabilities', () => {
            lambdatestService.isActive = true;
            LambdatestService.lambdatestConfig = { CAPABILITIES: {} };
            LambdatestService.tunnelName = utils.guid();

            expect(lambdatestService.getCapabilities({})).to.shallowDeepEqual({
                tunnel: true,
                tunnelName: LambdatestService.tunnelName,
            });
        });

        it('should load testim extension when it is not set', () => {
            lambdatestService.isActive = true;
            LambdatestService.lambdatestConfig = { CAPABILITIES: {} };
            LambdatestService.tunnelName = utils.guid();

            expect(lambdatestService.getCapabilities({ mode: 'extension' }, 'chrome')).to.shallowDeepEqual({ loadExtension: [getExtensionsUrl({}, true).chrome] });
            expect(lambdatestService.getCapabilities({ mode: 'extension' }, 'somOtherBrowser')).to.shallowDeepEqual({ loadExtension: [] });
        });

        it('should load testim extension when passing extensionPath flag', () => {
            lambdatestService.isActive = true;
            LambdatestService.lambdatestConfig = { CAPABILITIES: {} };
            LambdatestService.tunnelName = utils.guid();

            const extensionPath = 'http://localhost:1234/extension.zip';
            expect(lambdatestService.getCapabilities({ mode: 'extension', extensionPath })).to.shallowDeepEqual({ loadExtension: [extensionPath] });
        });

        it('should load testim extension when passing installCustomExtension flag', () => {
            lambdatestService.isActive = true;
            LambdatestService.lambdatestConfig = { CAPABILITIES: {} };
            LambdatestService.tunnelName = utils.guid();

            const installCustomExtension = 'http://localhost:1234/extension.zip';
            expect(lambdatestService.getCapabilities({ mode: 'extension', installCustomExtension })).to.shallowDeepEqual({ loadExtension: [installCustomExtension] });
        });
    });

    describe('prepareTunnel', () => {
        it('should do nothing when tunnel binary already exists', async () => {
            sandbox.stub(fse, 'pathExists').resolves(true);
            const chmod = sandbox.stub(fse, 'chmodSync');
            await LambdatestService.prepareTunnel();
            expect(chmod).not.to.have.been.called;
        });

        it('should throw when unsupported os', async () => {
            sandbox.stub(fse, 'pathExists').resolves(false);
            sandbox.stub(os, 'platform').returns('wtf');
            sandbox.stub(os, 'arch').returns('wtf');

            await expect(LambdatestService.prepareTunnel()).to.be.rejectedWith(Error, 'tunnel on wtfwtf platform is not supported.');
        });

        it('should download and extract tunnel binary', async () => {
            sandbox.stub(fse, 'pathExists').resolves(false);
            sandbox.stub(os, 'platform').returns('win32');
            sandbox.stub(os, 'arch').returns('x64');

            const download = sandbox.stub(utils, 'downloadAndSave');
            const unzip = sandbox.stub(utils, 'unzipFile').resolves();

            await LambdatestService.prepareTunnel();
            sinon.assert.calledOnce(unzip);
            sinon.assert.calledOnce(download);
            expect(download.args[0][0]).to.startWith('https://downloads.lambdatest.com/tunnel/');
        });
    });

    describe('connectTunnel', () => {
        let prepareTunnelStub;
        let spawnStub;
        let credentials;
        let httpGetStub;
        let processMock;

        beforeEach(() => {
            processMock = new Process();
            credentials = { gridUsername: utils.guid(), gridPassword: utils.guid() };
            sandbox.stub(portfinder, 'getPortPromise').resolves(1234);
            prepareTunnelStub = sandbox.stub(LambdatestService, 'prepareTunnel');
            spawnStub = sandbox.stub(childProcess, 'spawn').returns(processMock);
            httpGetStub = sandbox.stub(httpRequest, 'get').resolves({});
        });

        it('should do nothing when using externalLambdatestTunnelId', async () => {
            await LambdatestService.connectTunnel({ externalLambdatestTunnelId: 123 });
            sinon.assert.neverCalledWith(prepareTunnelStub);
            sinon.assert.neverCalledWith(spawnStub);
        });

        it('should prepare the tunnel', async () => {
            await LambdatestService.connectTunnel({ ...credentials });
            sinon.assert.calledOnce(prepareTunnelStub);
        });

        it('should reject when no credentials', async () => {
            await expect(LambdatestService.connectTunnel({ })).to.be.rejectedWith(Error, 'tunnel requires username and password');
        });

        it('should spawn the tunnel process', async () => {
            await LambdatestService.connectTunnel({ ...credentials });
            sinon.assert.calledOnce(spawnStub);
            expect(spawnStub.args[0][1]).to.eql([
                '--tunnelName', LambdatestService.tunnelName, '--infoAPIPort', 1234,
                '--user', credentials.gridUsername, '--key', credentials.gridPassword,
            ]);
        });

        it('should accept tunnelUser and tunnelKey on gridData', async () => {
            credentials = { gridData: { tunnelUser: utils.guid(), tunnelKey: utils.guid() } };
            await LambdatestService.connectTunnel({ ...credentials });
            sinon.assert.calledOnce(spawnStub);
            expect(spawnStub.args[0][1]).to.eql([
                '--tunnelName', LambdatestService.tunnelName, '--infoAPIPort', 1234,
                '--user', credentials.gridData.tunnelUser, '--key', credentials.gridData.tunnelKey,
            ]);
        });

        it('should allow using externalLambdatestUseWss', async () => {
            await LambdatestService.connectTunnel({ ...credentials, externalLambdatestUseWss: true });
            sinon.assert.calledOnce(spawnStub);
            expect(spawnStub.args[0][1].join(' ')).to.contain('--mode ws');
        });

        it('should allow using proxyUri', async () => {
            global.proxyUri = 'http://localhost';
            await LambdatestService.connectTunnel({ ...credentials });
            sinon.assert.calledOnce(spawnStub);
            expect(spawnStub.args[0][1].join(' ')).to.contain('--proxy-host localhost');
            global.proxyUri = undefined;
        });

        it('should allow using proxyUri port and credentials', async () => {
            global.proxyUri = 'http://user:pass@localhost:1234';
            await LambdatestService.connectTunnel({ ...credentials });
            sinon.assert.calledOnce(spawnStub);
            expect(spawnStub.args[0][1].join(' ')).to.contain('--proxy-host localhost');
            expect(spawnStub.args[0][1].join(' ')).to.contain('--proxy-port 1234');
            expect(spawnStub.args[0][1].join(' ')).to.contain('--proxy-user user');
            expect(spawnStub.args[0][1].join(' ')).to.contain('--proxy-pass pass');
            global.proxyUri = undefined;
        });

        it('should throw when proxyUri is invalid', async () => {
            global.proxyUri = 'i am invalid';
            await expect(LambdatestService.connectTunnel({ ...credentials })).to.be.rejectedWith(Error, 'proxy url is invalid');
            global.proxyUri = undefined;
        });

        it('should allow using externalLambdatestDisableAutomationTunneling', async () => {
            await LambdatestService.connectTunnel({ ...credentials, externalLambdatestDisableAutomationTunneling: true });
            sinon.assert.calledOnce(spawnStub);
            expect(spawnStub.args[0][1].join(' ')).to.contain('--bypassHosts run.testim.io,services.testim.io,api.coralogix.com,conf.rollout.io,statestore.rollout.io,push.rollout.io,analytic.rollout.io,res.cloudinary.com');
        });

        it('should allow using externalLambdatestMitm', async () => {
            await LambdatestService.connectTunnel({ ...credentials, externalLambdatestMitm: true });
            sinon.assert.calledOnce(spawnStub);
            expect(spawnStub.args[0][1].join(' ')).to.contain('--mitm');
        });

        it('should verify tunnel started', async () => {
            await LambdatestService.connectTunnel({ ...credentials });
            sinon.assert.calledOnce(httpGetStub);
        });
        it('should throw when tunnel did not start', async () => {
            httpGetStub.rejects(new AbortError('tunnel did not start'));
            await expect(LambdatestService.connectTunnel({ ...credentials })).to.be.rejectedWith(Error, 'tunnel did not start');
            processMock.stdout.emit('data', '');
            processMock.stderr.emit('data', '');
        });
    });

    describe('disconnectTunnel', () => {
        let processMock;
        let killStub;

        beforeEach(() => {
            processMock = new Process();
            killStub = sandbox.stub(processMock, 'kill').callThrough();
            sandbox.stub(childProcess, 'spawn').returns(processMock);
            sandbox.stub(LambdatestService, 'prepareTunnel');
            sandbox.stub(httpRequest, 'get').resolves({});
        });

        it('should kill the tunnel', async () => {
            await LambdatestService.connectTunnel({ tunnel: true, company: {}, gridUsername: utils.guid(), gridPassword: utils.guid() });
            await LambdatestService.disconnectTunnel({ company: {} });
            sinon.assert.calledOnce(killStub);
        });

        it('should reject when killing the tunnel fails', async () => {
            processMock.setCode(1);
            await LambdatestService.connectTunnel({ tunnel: true, company: {}, gridUsername: utils.guid(), gridPassword: utils.guid() });
            await expect(LambdatestService.disconnectTunnel({ company: {} })).to.be.rejectedWith(Error);
            sinon.assert.calledOnce(killStub);
        });

        it('should do nothing when using externalLambdatestTunnelId', async () => {
            await LambdatestService.disconnectTunnel({ externalLambdatestTunnelId: 123 });
            sinon.assert.neverCalledWith(killStub);
        });
    });
});

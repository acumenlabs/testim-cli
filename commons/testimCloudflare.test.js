/* eslint-disable no-console */

'use strict';

const { sinon, expect } = require('../../test/utils/testUtils');
const testimCloudflare = require('./testimCloudflare');
const servicesApi = require('./testimServicesApi.js');
const utils = require('../utils');
const fse = require('fs-extra');
const os = require('os');
const childProcess = require('child_process');
const EventEmitter = require('events');

class Process extends EventEmitter {
    constructor() {
        super();
    }
    setCode(code) {
        this.code = code;
    }
    kill() {
        this.emit('close', this.code);
    }
}

describe('testimCloudflare', () => {
    let sandbox;
    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });
    afterEach(() => {
        sandbox.restore();
    });

    describe('disconnectTunnel', () => {
        let deleteCloudflareTunnelStub;
        let processMock;
        let killStub;

        beforeEach(() => {
            deleteCloudflareTunnelStub = sandbox.stub(servicesApi, 'deleteCloudflareTunnel');
            processMock = new Process();
            killStub = sandbox.stub(processMock, 'kill').callThrough();
            sandbox.stub(childProcess, 'spawn').returns(processMock);
            sandbox.stub(testimCloudflare, 'prepareTunnel');
            sandbox.stub(servicesApi, 'getCloudflareTunnel').resolves({ _id: utils.guid(), routesMapping: {} });
            sandbox.stub(servicesApi, 'forceUpdateCloudflareTunnelRoutes');
            sandbox.stub(fse, 'writeFileSync');
        });

        it('should do nothing when no tunnel', async () => {
            await testimCloudflare.disconnectTunnel({ company: {} });
            sinon.assert.notCalled(deleteCloudflareTunnelStub);
        });

        it('should delete the tunnel', async () => {
            await testimCloudflare.connectTunnel({ company: {} });
            await testimCloudflare.disconnectTunnel({ company: {} });
            sinon.assert.calledOnce(deleteCloudflareTunnelStub);
        });

        it('should kill the tunnel', async () => {
            await testimCloudflare.connectTunnel({ company: {} });
            await testimCloudflare.disconnectTunnel({ company: {} });
            sinon.assert.calledOnce(killStub);
        });

        it('should reject when killing the tunnel fails', async () => {
            processMock.setCode(1);
            await testimCloudflare.connectTunnel({ company: {} });
            await expect(testimCloudflare.disconnectTunnel({ company: {} })).to.be.rejectedWith(Error);
            sinon.assert.calledOnce(killStub);
        });
    });

    describe('prepareTunnel', () => {
        it('should do nothing when cloudflared binary already exists', async () => {
            sandbox.stub(fse, 'pathExists').resolves(true);
            const chmod = sandbox.stub(fse, 'chmodSync');
            await testimCloudflare.prepareTunnel();
            expect(chmod).not.to.have.been.called;
        });

        it('should throw when unsupported os', async () => {
            sandbox.stub(fse, 'pathExists').resolves(false);
            sandbox.stub(os, 'platform').returns('wtf');
            sandbox.stub(os, 'arch').returns('wtf');

            await expect(testimCloudflare.prepareTunnel()).to.be.rejectedWith(Error, 'tunnel on wtfwtf platform is not supported.');
        });

        it('should download cloudflared binary', async () => {
            sandbox.stub(fse, 'pathExists').resolves(false);
            sandbox.stub(os, 'platform').returns('win32');
            sandbox.stub(os, 'arch').returns('x64');

            const chmod = sandbox.stub(fse, 'chmodSync');
            const download = sandbox.stub(utils, 'downloadAndSave');

            await testimCloudflare.prepareTunnel();
            sinon.assert.calledOnce(chmod);
            sinon.assert.calledOnce(download);
            expect(download.args[0][0]).to.startWith('https://github.com/cloudflare/cloudflared/releases/download');
        });

        it('should extract tgz file', async () => {
            sandbox.stub(fse, 'pathExists').resolves(false);
            sandbox.stub(os, 'platform').returns('darwin');
            sandbox.stub(os, 'arch').returns('x64');
            sandbox.stub(fse, 'chmodSync');

            sandbox.stub(utils, 'downloadAndSave').resolves();
            const unzip = sandbox.stub(utils, 'unzipFile').resolves();
            await testimCloudflare.prepareTunnel();

            sinon.assert.calledOnce(unzip);
        });
    });

    describe('connectTunnel', () => {
        let prepareTunnelStub;
        let getCloudflareTunnelStub;
        let forceUpdateCloudflareTunnelRoutesStub;
        let writeFileSyncStub;
        let spawnStub;

        let tunnelData;

        beforeEach(() => {
            tunnelData = { _id: utils.guid(), token: utils.guid(), routesMapping: {} };
            prepareTunnelStub = sandbox.stub(testimCloudflare, 'prepareTunnel');
            getCloudflareTunnelStub = sandbox.stub(servicesApi, 'getCloudflareTunnel').resolves(tunnelData);
            forceUpdateCloudflareTunnelRoutesStub = sandbox.stub(servicesApi, 'forceUpdateCloudflareTunnelRoutes');
            writeFileSyncStub = sandbox.stub(fse, 'writeFileSync');
            spawnStub = sandbox.stub(childProcess, 'spawn');
        });

        it('should prepare the tunnel', async () => {
            await testimCloudflare.connectTunnel({ company: {} });
            sinon.assert.calledOnce(prepareTunnelStub);
        });

        it('should get and the tunnel routes', async () => {
            await testimCloudflare.connectTunnel({ company: {} });
            sinon.assert.calledOnce(getCloudflareTunnelStub);
            sinon.assert.calledWith(forceUpdateCloudflareTunnelRoutesStub);
        });

        it('should spawn the cloudflard process', async () => {
            await testimCloudflare.connectTunnel({ company: {} });
            sinon.assert.calledOnce(spawnStub);
            expect(spawnStub.args[0][1]).to.eql(['tunnel', '--no-autoupdate', 'run', '--force', '--token', tunnelData.token]);
        });

        it('should write the tunnel data to a file', async () => {
            tunnelData.routesMapping = utils.guid();
            await testimCloudflare.connectTunnel({ company: {}, tunnelRoutesOutput: 'test.json' });
            sinon.assert.calledOnce(writeFileSyncStub);
            expect(writeFileSyncStub.args[0][0]).to.eql('test.json');
            expect(writeFileSyncStub.args[0][1]).to.eql(JSON.stringify(tunnelData.routesMapping));
        });

        it('should set the baseUrl to the tunneled url', async () => {
            tunnelData.routesMapping = { 'http://localhost:80': utils.guid() };
            const opts = { company: {} };
            await testimCloudflare.connectTunnel(opts);
            expect(opts.baseUrl).to.eql(`https://${tunnelData.routesMapping['http://localhost:80']}`);
        });

        it('should set the baseUrl to the tunneled url, overriding an existing baseURL', async () => {
            const baseUrl = utils.guid();
            tunnelData.routesMapping = { [baseUrl]: utils.guid() };
            const opts = { company: {}, baseUrl };
            await testimCloudflare.connectTunnel(opts);
            expect(opts.baseUrl).to.eql(`https://${tunnelData.routesMapping[baseUrl]}`);
        });

        it('should set the baseUrl considering tunnelUseHttpAddress', async () => {
            tunnelData.routesMapping = { 'http://localhost:80': utils.guid() };
            const opts = { company: {}, tunnelUseHttpAddress: true };
            await testimCloudflare.connectTunnel(opts);
            expect(opts.baseUrl).to.eql(`http://${tunnelData.routesMapping['http://localhost:80']}`);
        });
    });
});

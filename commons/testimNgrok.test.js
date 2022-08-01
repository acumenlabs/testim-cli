/* eslint-disable no-console */

'use strict';

const { ArgError } = require('../errors.js');
const { sinon, expect } = require('../../test/utils/testUtils');
const testimNgrok = require('./testimNgrok');
const utils = require('../utils');
const npmWrapper = require('./npmWrapper');



describe('testimNgrok', () => {
    let sandbox;
    let authData;
    let tunnelUrl;
    let collectNgrokStatsStub;

    const ngrokMock = {
        connect: () => {},
        disconnect: () => {},
        getApi: () => {},
    };

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        authData = { ngrokToken: utils.guid() };
        tunnelUrl = utils.guid();
        sandbox.stub(ngrokMock, 'connect').callsFake(() => tunnelUrl);
        sandbox.stub(ngrokMock, 'disconnect');
        sandbox.stub(npmWrapper, 'getPackageIfInstalledLocally').returns(ngrokMock);
        collectNgrokStatsStub = sandbox.stub(testimNgrok, 'collectNgrokStats');
    });
    afterEach(() => {
        sandbox.restore();
    });

    describe('disconnectTunnel', () => {
        it('should do nothing when no tunnel', async () => {
            await testimNgrok.disconnectTunnel({});
            sinon.assert.neverCalledWith(ngrokMock.disconnect);
        });

        it('should disconnect the tunnel', async () => {
            await testimNgrok.connectTunnel({}, authData);
            await testimNgrok.disconnectTunnel({});
            sinon.assert.calledOnce(ngrokMock.disconnect);
        });

        it('should collect stats on disconnect', async () => {
            await testimNgrok.connectTunnel({}, authData);
            await testimNgrok.disconnectTunnel({ tunnelDiagnostics: true });

            sinon.assert.calledOnce(collectNgrokStatsStub);
        });
    });

    describe('connectTunnel', () => {
        it('should throw when no token', async () => {
            await expect(testimNgrok.connectTunnel({ company: {} })).to.be.rejectedWith(ArgError, 'tunnel feature is not enabled, please contact support - info@testim.io.');
        });

        it('should spawn the tunnel', async () => {
            const opts = {};
            await testimNgrok.connectTunnel(opts, authData);

            sinon.assert.calledOnce(ngrokMock.connect);
            expect(ngrokMock.connect.args[0][0]).to.shallowDeepEqual({
                proto: 'http',
                addr: 80,
                authtoken: authData.ngrokToken,
                hostname: undefined,
            });
            expect(opts.baseUrl).to.equal(tunnelUrl);
        });

        it('should return whitlisted url when isNgrokWhitelisted', async () => {
            authData.isNgrokWhitelisted = true;
            await testimNgrok.connectTunnel({ projectData: { projectId: 'projectId' } }, authData);
            expect(ngrokMock.connect.args[0][0].hostname).to.endWith('projectId.whitelisted-ngrok.testim.io');
        });

        it('should support tunnelHostHeader', async () => {
            const tunnelHostHeader = utils.guid();
            await testimNgrok.connectTunnel({ tunnelHostHeader }, authData);
            // eslint-disable-next-line camelcase
            expect(ngrokMock.connect.args[0][0]).to.shallowDeepEqual({ host_header: tunnelHostHeader });
        });

        it('should support tunnelRegion', async () => {
            const tunnelRegion = utils.guid();
            await testimNgrok.connectTunnel({ tunnelRegion }, authData);
            expect(ngrokMock.connect.args[0][0]).to.shallowDeepEqual({ region: tunnelRegion });
        });

        it('should force using http when passing tunnelUseHttpAddress', async () => {
            const opts = { tunnelUseHttpAddress: true };
            const guid = utils.guid();
            tunnelUrl = `https://${guid}`;
            await testimNgrok.connectTunnel(opts, authData);

            sinon.assert.calledOnce(ngrokMock.connect);
            expect(opts.baseUrl).to.equal(`http://${guid}`);
        });

        it('should collect stats on connect', async () => {
            await testimNgrok.connectTunnel({ tunnelDiagnostics: true }, authData);
            sinon.assert.calledOnce(collectNgrokStatsStub);
        });
    });

    describe('collectNgrokStats', () => {
        let tunnels;
        let getApiStub;
        beforeEach(() => {
            tunnels = [{ }];
            getApiStub = sandbox.stub(ngrokMock, 'getApi').returns({ get: () => ({ tunnels }) });
            collectNgrokStatsStub.callThrough();
        });

        it('should collect stats', async () => {
            await testimNgrok.collectNgrokStats(false);
            sinon.assert.calledOnce(ngrokMock.getApi);
        });

        it('should rerun itself using timeout', async () => {
            const clock = sandbox.useFakeTimers();

            await testimNgrok.collectNgrokStats();
            clock.tick(15000);
            sinon.assert.calledTwice(collectNgrokStatsStub);
        });

        it('should ignore errors while collecting stats', async () => {
            getApiStub.throws(new Error('test'));
            await testimNgrok.collectNgrokStats();
            sinon.assert.calledOnce(ngrokMock.getApi);
        });
    });
});

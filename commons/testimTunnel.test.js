const { expect, sinon } = require('../../test/utils/testUtils');
const LambdatestService = require('../services/lambdatestService');
const processHandler = require('../processHandler');
const testimNgrok = require('./testimNgrok');
const testimCloudflare = require('./testimCloudflare');
const testimTunnel = require('./testimTunnel');

describe('testimTunnel', () => {
    describe('connect', () => {
        let ltConnectStub;
        let ngrokConnectStub;
        let cloudflareConnectStub;

        beforeEach(() => {
            ltConnectStub = sinon.stub(LambdatestService, 'connectTunnel').resolves();
            ngrokConnectStub = sinon.stub(testimNgrok, 'connectTunnel').resolves();
            cloudflareConnectStub = sinon.stub(testimCloudflare, 'connectTunnel').resolves();
        });
        afterEach(() => {
            ltConnectStub.restore();
            ngrokConnectStub.restore();
            cloudflareConnectStub.restore();
        });

        it('should not connect to tunnel if tunnel option off', async () => {
            await testimTunnel.connect({});
            sinon.assert.notCalled(ltConnectStub);
            sinon.assert.notCalled(ngrokConnectStub);
            sinon.assert.notCalled(cloudflareConnectStub);
        });

        it('should choose ngrok if passed grid is not a lambdatest grid', async () => {
            await testimTunnel.connect({ tunnel: true, gridData: { } });
            sinon.assert.notCalled(ltConnectStub);
            sinon.assert.calledOnce(ngrokConnectStub);
            sinon.assert.notCalled(cloudflareConnectStub);
        });

        it('should choose cloudflare if passed tunnelRoutes options', async () => {
            await testimTunnel.connect({ tunnel: true, tunnelRoutes: [] });
            sinon.assert.notCalled(ltConnectStub);
            sinon.assert.notCalled(ngrokConnectStub);
            sinon.assert.calledOnce(cloudflareConnectStub);
        });

        it('should choose lambdatest if passed grid is a lambdatest grid', async () => {
            await testimTunnel.connect({ tunnel: true, gridData: { type: 'testimLambdaTest', tunnel: 'lambdatest' } });
            sinon.assert.calledOnce(ltConnectStub);
            sinon.assert.notCalled(ngrokConnectStub);
            sinon.assert.notCalled(cloudflareConnectStub);
        });

        it('should choose lambdatest if passed grid is a hybrid grid', async () => {
            await testimTunnel.connect({ tunnel: true, gridData: { type: 'testimHybrid', tunnel: 'lambdatest' } });
            sinon.assert.calledOnce(ltConnectStub);
            sinon.assert.notCalled(ngrokConnectStub);
            sinon.assert.notCalled(cloudflareConnectStub);
        });

        it('should choose ngrok if passed grid is a hybrid grid and it is set to use ngrok tunnel', async () => {
            await testimTunnel.connect({ tunnel: true, gridData: { type: 'testimHybrid', tunnel: 'ngrok' } });
            sinon.assert.notCalled(ltConnectStub);
            sinon.assert.calledOnce(ngrokConnectStub);
            sinon.assert.notCalled(cloudflareConnectStub);
        });

        it('should handle connect errors', async () => {
            ltConnectStub.rejects('error');
            await expect(testimTunnel.connect({ tunnel: true, gridData: { type: 'testimLambdaTest', tunnel: 'lambdatest' } })).to.be.rejectedWith('Failed to start tunnel. Please contact support@testim.io');
        });
    });

    describe('disconnect', () => {
        let ltDisconnectStub;
        let ngrokDisconnectStub;
        let cloudflareDisconnectStub;

        beforeEach(() => {
            ltDisconnectStub = sinon.stub(LambdatestService, 'disconnectTunnel').resolves();
            ngrokDisconnectStub = sinon.stub(testimNgrok, 'disconnectTunnel').resolves();
            cloudflareDisconnectStub = sinon.stub(testimCloudflare, 'disconnectTunnel').resolves();
        });
        afterEach(() => {
            ltDisconnectStub.restore();
            ngrokDisconnectStub.restore();
            cloudflareDisconnectStub.restore();
        });

        it('should not disconnect from tunnel if tunnel option off', async () => {
            await testimTunnel.disconnect({});
            sinon.assert.notCalled(ltDisconnectStub);
            sinon.assert.notCalled(ngrokDisconnectStub);
            sinon.assert.notCalled(cloudflareDisconnectStub);
        });

        it('should choose ngrok if passed grid is not a lambdatest grid', async () => {
            await testimTunnel.disconnect({ tunnel: true, gridData: { } });
            sinon.assert.notCalled(ltDisconnectStub);
            sinon.assert.calledOnce(ngrokDisconnectStub);
            sinon.assert.notCalled(cloudflareDisconnectStub);
        });

        it('should choose cloudflare if passed tunnelRoutes options', async () => {
            await testimTunnel.disconnect({ tunnel: true, tunnelRoutes: [] });
            sinon.assert.notCalled(ltDisconnectStub);
            sinon.assert.notCalled(ngrokDisconnectStub);
            sinon.assert.calledOnce(cloudflareDisconnectStub);
        });

        it('should choose lambdatest if passed grid is a lambdatest grid', async () => {
            await testimTunnel.disconnect({ tunnel: true, gridData: { type: 'testimLambdaTest', tunnel: 'lambdatest' } });
            sinon.assert.calledOnce(ltDisconnectStub);
            sinon.assert.notCalled(ngrokDisconnectStub);
            sinon.assert.notCalled(cloudflareDisconnectStub);
        });

        it('should choose lambdatest if passed grid is a hybrid grid', async () => {
            await testimTunnel.disconnect({ tunnel: true, gridData: { type: 'testimHybrid', tunnel: 'lambdatest' } });
            sinon.assert.calledOnce(ltDisconnectStub);
            sinon.assert.notCalled(ngrokDisconnectStub);
            sinon.assert.notCalled(cloudflareDisconnectStub);
        });

        it('should choose ngrok if passed grid is a hybrid grid and it is set to use ngrok tunnel', async () => {
            await testimTunnel.disconnect({ tunnel: true, gridData: { type: 'testimHybrid', tunnel: 'ngrok' } });
            sinon.assert.notCalled(ltDisconnectStub);
            sinon.assert.calledOnce(ngrokDisconnectStub);
            sinon.assert.notCalled(cloudflareDisconnectStub);
        });

        it('should handle connect errors', async () => {
            ltDisconnectStub.rejects('error');
            await expect(testimTunnel.disconnect({ tunnel: true, gridData: { type: 'testimLambdaTest', tunnel: 'lambdatest' } })).to.be.rejectedWith('catch error - failed to close tunnel');
        });
    });

    describe('serveTunneling', () => {
        let connectStub;
        let disconnectStub;
        let registerExitHookStub;
        let exitHooks;

        beforeEach(() => {
            exitHooks = [];
            connectStub = sinon.stub(testimTunnel, 'connect').resolves();
            disconnectStub = sinon.stub(testimTunnel, 'disconnect').resolves();
            registerExitHookStub = sinon.stub(processHandler, 'registerExitHook').callsFake(cb => { exitHooks.push(cb); });
        });
        afterEach(() => {
            connectStub.restore();
            registerExitHookStub.restore();
            disconnectStub.restore();
        });

        it('should connect to tunnel', async () => {
            await testimTunnel.serveTunneling({}, Promise.resolve());
            sinon.assert.calledOnce(connectStub);
        });

        it('should disconnect from tunnel on exit', async () => {
            await testimTunnel.serveTunneling({}, Promise.resolve());
            sinon.assert.calledOnce(registerExitHookStub);
            exitHooks[0]();
            sinon.assert.calledOnce(disconnectStub);
        });

        it('should return a default promise that never resolves', async () => {
            expect(testimTunnel.serveTunneling({})).to.be.an.instanceof(Promise);
        });
    });
});

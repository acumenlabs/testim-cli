const proxyquire = require('proxyquire');

const { expect, sinon } = require('../../test/utils/testUtils');
const gridService = require('../services/gridService');
const reporter = require('../reports/reporter');
const { PageNotAvailableError, GridError, GetBrowserError } = require('../errors');
const servicesApi = require('../commons/testimServicesApi');
const utils = require('../utils');


describe('BaseWorker', () => {
    let worker;
    let handleHybridStub;
    let getGridSlotStub;
    let runTestOnceStub = sinon.stub();
    let testRunHandlerMock;
    let testPlayerMock;
    const onTestStartedStub = sinon.stub();
    const sandbox = sinon.createSandbox();

    beforeEach(() => {
        const BaseWorker = proxyquire.noCallThru()('./BaseWorker', {
            './workerUtils': {
                releasePlayer: () => sinon.stub().resolves({}),
            },
        });

        worker = new BaseWorker(null, {}, null, null, onTestStartedStub);
        worker.userData = {};
        worker.options = { gridData: {}, browser: 'chrome', company: { companyId: 'companyId' }, getBrowserTimeout: 1000, getSessionTimeout: 100, getBrowserRetries: 10 };
        worker.testRunConfig = {};

        testRunHandlerMock = { getExecutionId: () => 'executionId', getTestResultId: () => 'testResultId' };
        testPlayerMock = { onDone: sinon.spy() };

        sinon.stub(worker, 'initPlayer').returns(testPlayerMock);
        sinon.stub(worker, 'getBrowserOnce').returns({});
        runTestOnceStub = sinon.stub(worker, 'runTestOnce');
        handleHybridStub = sinon.stub(gridService, 'handleHybridOrVendorIfNeeded').callThrough();
        getGridSlotStub = sinon.stub(gridService, 'getGridSlot').resolves({});


        sandbox.stub(utils, 'delay').returns(Promise.resolve());
        sandbox.stub(reporter);
    });

    afterEach(() => {
        handleHybridStub.restore();
        getGridSlotStub.restore();

        sandbox.restore();
    });

    describe('getTestPlayer', () => {
        describe('getSlot', () => {
            it('should get grid slot from server', async () => {
                await worker.getTestPlayer(testRunHandlerMock);
                sinon.assert.calledOnce(getGridSlotStub);
                sinon.assert.notCalled(utils.delay);
            });
            it('should retry getting slot until it succeeds', async () => {
                getGridSlotStub.onFirstCall().rejects();
                getGridSlotStub.onSecondCall().resolves({});

                await worker.getTestPlayer(testRunHandlerMock);
                sinon.assert.calledTwice(getGridSlotStub);
                sinon.assert.calledOnce(utils.delay);
            });
            it('should not proceed to getting browser if all retries used for getting a slot', async () => {
                getGridSlotStub.resolves({});
                worker.options.getBrowserRetries = 0;
                await expect(worker.getTestPlayer(testRunHandlerMock)).to.eventually.be.rejectedWith('No free browser slots in desired grid');
                sinon.assert.calledOnce(getGridSlotStub);
                sinon.assert.notCalled(worker.getBrowserOnce);
                sinon.assert.notCalled(worker.initPlayer);
                sinon.assert.notCalled(utils.delay);
            });
        });

        describe('getBrowserOnce', () => {
            it('should get browser from grid', async () => {
                await worker.getTestPlayer(testRunHandlerMock);
                sinon.assert.calledOnce(getGridSlotStub);
                sinon.assert.calledOnce(worker.getBrowserOnce);
                sinon.assert.calledOnce(worker.initPlayer);
                sinon.assert.notCalled(utils.delay);
            });
            it('should retry getting browser until it succeeds', async () => {
                worker.getBrowserOnce.onFirstCall().rejects();
                worker.getBrowserOnce.onSecondCall().resolves({});

                await worker.getTestPlayer(testRunHandlerMock);
                sinon.assert.calledOnce(getGridSlotStub);
                sinon.assert.calledTwice(worker.getBrowserOnce);
                sinon.assert.calledTwice(worker.initPlayer);
                sinon.assert.calledOnce(testPlayerMock.onDone);
                sinon.assert.calledOnce(utils.delay);
            });
            it('should not retry if page is not available', async () => {
                worker.getBrowserOnce.throws(() => new PageNotAvailableError());

                await expect(worker.getTestPlayer(testRunHandlerMock)).to.eventually.be.rejectedWith(Error);
                sinon.assert.calledOnce(getGridSlotStub);
                sinon.assert.calledOnce(worker.getBrowserOnce);
                sinon.assert.calledOnce(testPlayerMock.onDone);
                sinon.assert.notCalled(utils.delay);
            });
            it('should handle get grid error', async () => {
                worker.getBrowserOnce.throws(() => new GridError());
                worker.options.getBrowserRetries = 1;

                await expect(worker.getTestPlayer(testRunHandlerMock)).to.eventually.be.rejectedWith(GetBrowserError);
                sinon.assert.calledOnce(testPlayerMock.onDone);
            });
        });

        describe('hybrid grid', () => {
            let getHybridGridProviderStub;

            beforeEach(() => {
                getHybridGridProviderStub = sinon.stub(servicesApi, 'getHybridGridProvider');
                handleHybridStub.callThrough();
            });
            afterEach(() => {
                getHybridGridProviderStub.restore();
            });

            it('should not get hybrid provider for non hybrid grid types', async () => {
                getGridSlotStub.resolves({ type: 'testim', gridId: 'gridId' });

                await worker.getTestPlayer(testRunHandlerMock);
                sinon.assert.notCalled(getHybridGridProviderStub);
                sinon.assert.calledOnce(handleHybridStub);

                expect(worker.getBrowserOnce.getCall(0).args[3]).to.shallowDeepEqual({ type: 'testim', gridId: 'gridId' });
            });

            it('should get hybrid provider after getting grid slot', async () => {
                getGridSlotStub.resolves({ type: 'testimHybrid', gridId: 'gridId' });
                getHybridGridProviderStub.resolves({ provider: 'loacker', connectionDetails: { host: 'localhost' } });

                await worker.getTestPlayer(testRunHandlerMock);
                sinon.assert.calledOnce(handleHybridStub);
                sinon.assert.calledWith(handleHybridStub, worker.options, { type: 'testimHybrid', gridId: 'gridId' });

                expect(worker.getBrowserOnce.getCall(0).args[3]).to.shallowDeepEqual({ type: 'testimHybrid', gridId: 'gridId', provider: 'loacker', host: 'localhost' });
            });

            it('should get browser from different provider on each retry', async () => {
                getGridSlotStub.resolves({ type: 'testimHybrid', gridId: 'gridId' });

                getHybridGridProviderStub.onFirstCall().resolves({ provider: 'loacker', connectionDetails: { host: 'localhost', external: { user: 'user', key: 'password' } } });
                getHybridGridProviderStub.onSecondCall().resolves({ provider: 'nitzan', connectionDetails: { host: 'google.com', port: 443 } });
                getHybridGridProviderStub.onThirdCall().resolves({ provider: 'a', connectionDetails: { host: 'google.com', port: 4444 } });
                worker.getBrowserOnce.onFirstCall().rejects(new Error());
                worker.getBrowserOnce.onSecondCall().rejects(new Error());
                worker.getBrowserOnce.onThirdCall().resolves({});

                await worker.getTestPlayer(testRunHandlerMock);
                sinon.assert.calledThrice(handleHybridStub);
                sinon.assert.calledWith(handleHybridStub, worker.options, { type: 'testimHybrid', gridId: 'gridId' });

                expect(worker.getBrowserOnce.getCall(0).args[3]).to.shallowDeepEqual({ type: 'testimHybrid', gridId: 'gridId', provider: 'loacker', host: 'localhost', user: 'user', key: 'password' });
                expect(worker.getBrowserOnce.getCall(1).args[3]).to.shallowDeepEqual({ type: 'testimHybrid', gridId: 'gridId', provider: 'nitzan', host: 'google.com', user: undefined, key: undefined, port: 443 });
                expect(worker.getBrowserOnce.getCall(2).args[3]).to.shallowDeepEqual({ type: 'testimHybrid', gridId: 'gridId', provider: 'a', host: 'google.com', user: undefined, key: undefined, port: 4444 });
            });
        });

        describe('runTest', () => {
            it('should call the runTestOnc with the base url of the test object we acquired from onTestStarted', async () => {
                const testRunHandler = {
                    _baseUrl: 'https://testim.io',
                    getTestStatus: () => sinon.stub().returns(42),
                    getTestId: () => sinon.stub().returns(42),
                    getTestResultId: () => sinon.stub().returns(42),
                    getRetryKey: () => sinon.stub().returns(42),
                    getExecutionId: () => sinon.stub().returns(42),
                    testRunHandler: () => sinon.stub().returns(42),
                    clearTestResult: () => sinon.stub().returns(42),
                };
                onTestStartedStub.returns({
                    config: {
                        baseUrl: 'http://demo.testim.io/',
                    },
                });
                await worker.runTest(testRunHandler);
                expect(runTestOnceStub.firstCall.firstArg._baseUrl).to.equals('http://demo.testim.io/');
            });
        });
    });
});

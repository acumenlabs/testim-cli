const { expect, sinon } = require('../../test/utils/testUtils');
const gridService = require('./gridService');
const servicesApi = require('../commons/testimServicesApi');

describe('gridService', () => {
    describe('handleHybridOrVendorIfNeeded', () => {
        let getHybridGridProviderStub;
        let ltServiceMock;

        beforeEach(() => {
            ltServiceMock = { enableIfNeeded: sinon.stub().resolves(), disable: sinon.stub().resolves() };
            getHybridGridProviderStub = sinon.stub(servicesApi, 'getHybridGridProvider');
        });
        afterEach(() => {
            getHybridGridProviderStub.restore();
        });

        it('should return grid if no grid id or grid type', async () => {
            const grid = { name: 'grid' };
            const result = await gridService.handleHybridOrVendorIfNeeded();
            expect(result).to.eql({});
            sinon.assert.notCalled(getHybridGridProviderStub);
        });

        it('should return grid if it is not a hybrid grid', async () => {
            const grid = { type: 'not hybrid', gridId: 'gridId' };
            const result = await gridService.handleHybridOrVendorIfNeeded({ company: {} }, grid);
            expect(result).to.equal(grid);
            sinon.assert.notCalled(getHybridGridProviderStub);
        });

        it('should return grid if it is hybrid with insufficient data to get its provider', async () => {
            const grid = { type: 'testimHybrid', gridId: 'gridId' };
            const result = await gridService.handleHybridOrVendorIfNeeded({ company: { companyId: 'companyId' }, browser: 'chrome' }, grid);
            expect(result).to.equal(grid);
            sinon.assert.notCalled(getHybridGridProviderStub);
        });

        it('should get grid provider for hybrid grids', async () => {
            getHybridGridProviderStub.resolves({ provider: 'provider' });
            const grid = { type: 'testimHybrid', gridId: 'gridId' };
            const result = await gridService.handleHybridOrVendorIfNeeded({ company: { companyId: 'companyId' }, browser: 'chrome' }, grid, {}, ltServiceMock, { currentRetry: 1, maxRetries: 1 });
            expect(result).to.shallowDeepEqual({ ...grid, provider: 'provider' });
            sinon.assert.calledOnce(getHybridGridProviderStub);
        });

        it('should enable lambda test service if lambda test grid', async () => {
            const grid = { type: 'testimLambdaTest', gridId: 'gridId' };
            await gridService.handleHybridOrVendorIfNeeded({ company: {} }, grid, {}, ltServiceMock);
            sinon.assert.calledOnce(ltServiceMock.enableIfNeeded);
            sinon.assert.notCalled(getHybridGridProviderStub);
        });

        it('should enable lambda test service if hybrid grid and lambda test provider', async () => {
            getHybridGridProviderStub.resolves({ provider: 'lambdatest' });
            const grid = { type: 'testimHybrid', gridId: 'gridId' };
            await gridService.handleHybridOrVendorIfNeeded({ company: { companyId: 'companyId' }, browser: 'chrome' }, grid, {}, ltServiceMock, { currentRetry: 1, maxRetries: 1 });
            sinon.assert.calledOnce(ltServiceMock.enableIfNeeded);
        });

        it('should disable lambda test service if hybrid grid and not lambda test provider', async () => {
            getHybridGridProviderStub.resolves({ provider: 'provider' });
            const grid = { type: 'testimHybrid', gridId: 'gridId' };
            await gridService.handleHybridOrVendorIfNeeded({ company: { companyId: 'companyId' }, browser: 'chrome' }, grid, {}, ltServiceMock, { currentRetry: 1, maxRetries: 1 });
            sinon.assert.calledOnce(ltServiceMock.disable);
            sinon.assert.notCalled(ltServiceMock.enableIfNeeded);
        });

        it('should return hybrid grid tunnel credentials if set', async () => {
            getHybridGridProviderStub.resolves({ provider: 'provider', connectionDetails: { hybrid: { tunnel: 'provider', external: { provider: { user: 'username', key: 'password' } } } } });
            const grid = { type: 'testimHybrid', gridId: 'gridId' };
            const result = await gridService.handleHybridOrVendorIfNeeded({ company: { companyId: 'companyId' }, browser: 'chrome' }, grid, {}, ltServiceMock, { currentRetry: 1, maxRetries: 1 });
            expect(result).to.shallowDeepEqual({ ...grid, provider: 'provider', key: undefined, user: undefined, tunnelUser: 'username', tunnelKey: 'password' });
        });

        it('should ignore hybrid grid tunnel credentials if tunnel set to a different provider', async () => {
            getHybridGridProviderStub.resolves({ provider: 'provider', connectionDetails: { hybrid: { tunnel: 'otherprovider', external: { provider: { user: 'username', key: 'password' } } } } });
            const grid = { type: 'testimHybrid', gridId: 'gridId' };
            const result = await gridService.handleHybridOrVendorIfNeeded({ company: { companyId: 'companyId' }, browser: 'chrome' }, grid, {}, ltServiceMock, { currentRetry: 1, maxRetries: 1 });
            expect(result).to.shallowDeepEqual({ ...grid, provider: 'provider', key: undefined, user: undefined, tunnelUser: undefined, tunnelKey: undefined });
        });
    });

    describe('getGridData', () => {
        let getAllGridsStub;
        let getTestPlanStub;

        beforeEach(() => {
            getAllGridsStub = sinon.stub(servicesApi, 'getAllGrids');
            getTestPlanStub = sinon.stub(servicesApi, 'getTestPlan').resolves([{ gridId: 'gridId' }]);
        });
        afterEach(() => {
            getAllGridsStub.restore();
            getTestPlanStub.restore();
        });

        it('should not access server when using useLocalChromeDriver flag', async () => {
            const grid = await gridService.getGridData({ useLocalChromeDriver: true });
            expect(grid).to.eql({ mode: 'local' });
            sinon.assert.notCalled(getAllGridsStub);
        });

        it('should not access server when using useChromeLauncher flag', async () => {
            const grid = await gridService.getGridData({ useChromeLauncher: true });
            expect(grid).to.eql({ mode: 'local' });
            sinon.assert.notCalled(getAllGridsStub);
        });

        it('should return fixed grid when passing host and port', async () => {
            const grid = await gridService.getGridData({ host: 'localhost', port: 4444 });
            expect(grid).to.shallowDeepEqual({ type: 'hostAndPort', host: 'localhost', port: 4444 });
            sinon.assert.notCalled(getAllGridsStub);
        });

        it('should get grid from server when passing grid id', async () => {
            getAllGridsStub.resolves([{ _id: 'gridId', type: 'gridId' }]);
            const grid = await gridService.getGridData({ gridId: 'gridId', company: { companyId: 'companyId' } });
            expect(grid).to.shallowDeepEqual({ type: 'gridId', gridId: 'gridId' });
            sinon.assert.calledOnce(getAllGridsStub);
        });

        it('should use existing grid list if passed when passing grid id', async () => {
            const grid = await gridService.getGridData({ gridId: 'gridId', company: { companyId: 'companyId' }, allGrids: [{ _id: 'gridId', type: 'gridId' }] });
            expect(grid).to.shallowDeepEqual({ type: 'gridId', gridId: 'gridId' });
            sinon.assert.notCalled(getAllGridsStub);
        });

        it('should handle grid not found error when passing grid id', async () => {
            getAllGridsStub.resolves([{ _id: 'gridId', type: 'gridId' }]);
            await expect(gridService.getGridData({ gridId: 'gridId1', company: { companyId: 'companyId' } }))
                .to.eventually.be.rejectedWith('Failed to find grid id: gridId1');
        });

        it('should get grid from server when passing grid name', async () => {
            getAllGridsStub.resolves([{ name: 'GRIDNAME', type: 'gridName' }]);
            const grid = await gridService.getGridData({ grid: 'gridName', company: { companyId: 'companyId' } });
            expect(grid).to.shallowDeepEqual({ type: 'gridName', name: 'GRIDNAME' });
            sinon.assert.calledOnce(getAllGridsStub);
        });

        it('should use existing grid list if passed when passing grid name', async () => {
            const grid = await gridService.getGridData({ grid: 'gridName', company: { companyId: 'companyId' }, allGrids: [{ name: 'GRIDNAME', type: 'gridName' }] });
            expect(grid).to.shallowDeepEqual({ type: 'gridName', name: 'GRIDNAME' });
            sinon.assert.notCalled(getAllGridsStub);
        });

        it('should handle grid not found error when passing grid name', async () => {
            getAllGridsStub.resolves([{ type: 'gridName' }]);
            await expect(gridService.getGridData({ grid: 'gridName', company: { companyId: 'companyId' } }))
                .to.eventually.be.rejectedWith('Failed to find grid name: gridName');
        });

        it('should not assign a grid when using a test plan', async () => {
            const grid = await gridService.getGridData({ testPlan: ['testPlan'], company: { companyId: 'companyId' }, allGrids: [{ _id: 'gridId', type: 'gridId' }] });
            expect(grid).to.be.undefined;
        });

        it('should not assign a grid when using a test plan id', async () => {
            const grid = await gridService.getGridData({ testPlanIds: ['testPlan'], company: { companyId: 'companyId' }, allGrids: [{ _id: 'gridId', type: 'gridId' }] });
            expect(grid).to.be.undefined;
        });

        it('should throw when no grid selected', async () => {
            await expect(gridService.getGridData({ company: { companyId: 'companyId' } }))
                .to.eventually.be.rejectedWith('Missing host or grid configuration');
        });
    });

    describe('getGridSlot', () => {
        let getGridByIdStub;
        let getGridByNameStub;
        let onGridSlot;
        let addItemToGridCacheStub;

        beforeEach(() => {
            getGridByIdStub = sinon.stub(servicesApi, 'getGridById').resolves({ grid: { gridId: 'gridId', type: 'gridId' }, status: 'success' });
            getGridByNameStub = sinon.stub(servicesApi, 'getGridByName').resolves({ grid: { gridId: 'gridId', type: 'gridName' }, status: 'success' });
            addItemToGridCacheStub = sinon.stub(gridService, 'addItemToGridCache').callThrough();
            onGridSlot = sinon.stub().resolves();
        });
        afterEach(() => {
            getGridByIdStub.restore();
            getGridByNameStub.restore();
            addItemToGridCacheStub.restore();
        });

        it('should not access server when using useLocalChromeDriver flag', async () => {
            const slot = await gridService.getGridSlot('browser', 'executionId', 'testResultId', onGridSlot, { useLocalChromeDriver: true }, 'workerId');
            expect(slot).to.eql({ mode: 'local' });
            sinon.assert.notCalled(getGridByIdStub);
            sinon.assert.notCalled(getGridByNameStub);
            sinon.assert.notCalled(addItemToGridCacheStub);
            sinon.assert.calledOnce(onGridSlot);
        });

        it('should not access server when using useChromeLauncher flag', async () => {
            const slot = await gridService.getGridSlot('browser', 'executionId', 'testResultId', onGridSlot, { useChromeLauncher: true }, 'workerId');
            expect(slot).to.eql({ mode: 'local' });
            sinon.assert.notCalled(getGridByIdStub);
            sinon.assert.notCalled(getGridByNameStub);
            sinon.assert.notCalled(addItemToGridCacheStub);
            sinon.assert.calledOnce(onGridSlot);
        });

        it('should return fixed grid when passing host and port', async () => {
            const slot = await gridService.getGridSlot('browser', 'executionId', 'testResultId', onGridSlot, { host: 'localhost', port: 4444 }, 'workerId');
            expect(slot).to.shallowDeepEqual({ type: 'hostAndPort', host: 'localhost', port: 4444 });
            sinon.assert.notCalled(getGridByIdStub);
            sinon.assert.notCalled(getGridByNameStub);
            sinon.assert.notCalled(addItemToGridCacheStub);
            sinon.assert.calledOnce(onGridSlot);
        });

        it('should get grid from server when passing grid id', async () => {
            const slot = await gridService.getGridSlot('browser', 'executionId', 'testResultId', onGridSlot, { gridId: 'gridId' }, 'workerId');
            expect(slot).to.shallowDeepEqual({ type: 'gridId', gridId: 'gridId' });
            sinon.assert.calledOnce(getGridByIdStub);
            sinon.assert.notCalled(getGridByNameStub);
            sinon.assert.calledOnce(addItemToGridCacheStub);
            sinon.assert.calledOnce(onGridSlot);
        });

        it('should get grid from server when passing grid name', async () => {
            const slot = await gridService.getGridSlot('browser', 'executionId', 'testResultId', onGridSlot, { grid: 'gridName' }, 'workerId');
            expect(slot).to.shallowDeepEqual({ type: 'gridName', gridId: 'gridId' });
            sinon.assert.calledOnce(getGridByNameStub);
            sinon.assert.notCalled(getGridByIdStub);
            sinon.assert.calledOnce(addItemToGridCacheStub);
            sinon.assert.calledOnce(onGridSlot);
        });

        it('should handle grid not found error', async () => {
            getGridByIdStub.resolves({ status: 'error', code: 'not-found' });
            await expect(gridService.getGridSlot('browser', 'executionId', 'testResultId', onGridSlot, { gridId: 'gridId' }, 'workerId'))
                .to.eventually.be.rejectedWith('The specified grid is not available');
        });

        it('should handle no available slot error', async () => {
            getGridByIdStub.resolves({ status: 'error', code: 'no-available-slot' });
            await expect(gridService.getGridSlot('browser', 'executionId', 'testResultId', onGridSlot, { gridId: 'gridId' }, 'workerId'))
                .to.eventually.be.rejectedWith('Failed to run test on browser - concurrency limit reached');
        });

        it('should handle getGridSlot request error', async () => {
            getGridByIdStub.rejects({ status: 'error', code: 'not-found' });
            await expect(gridService.getGridSlot('browser', 'executionId', 'testResultId', onGridSlot, { gridId: 'gridId' }, 'workerId'))
                .to.eventually.be.rejectedWith('Test couldn\'t get browser - unknown error');
        });

        it('should throw when no grid selected', async () => {
            await expect(gridService.getGridSlot('browser', 'executionId', 'testResultId', onGridSlot, {}, 'workerId'))
                .to.eventually.be.rejectedWith('Missing host or grid configuration');
        });

        it('should handle unkonwn errors', async () => {
            getGridByIdStub.resolves({ status: 'error', code: 'bla bla' });
            await expect(gridService.getGridSlot('browser', 'executionId', 'testResultId', onGridSlot, { gridId: 'gridId' }, 'workerId'))
                .to.eventually.be.rejectedWith('Test couldn\'t get browser - unknown error');
        });

        it('should handle no status', async () => {
            getGridByIdStub.resolves({ code: 'bla bla' });
            await expect(gridService.getGridSlot('browser', 'executionId', 'testResultId', onGridSlot, { gridId: 'gridId' }, 'workerId'))
                .to.eventually.be.rejectedWith('Test couldn\'t get browser - unknown error');
        });
    });

    describe('releaseGridSlot', () => {
        let releaseGridSlotStub;
        beforeEach(() => {
            releaseGridSlotStub = sinon.stub(servicesApi, 'releaseGridSlot').resolves();
        });
        afterEach(() => {
            releaseGridSlotStub.restore();
        });

        it('should call releaseGridSlot with the correct parameters', async () => {
            gridService.addItemToGridCache('workerId', 'companyId', 'gridId', 'slotId', 'chrome');
            await gridService.releaseGridSlot('workerId', 'projectId');
            sinon.assert.calledWith(releaseGridSlotStub, 'companyId', 'projectId', 'slotId', 'gridId', 'chrome');
        });

        it('should not call releaseGridSlot if the workerId is not in the cache', async () => {
            await gridService.releaseGridSlot('workerId', 'projectId');
            sinon.assert.notCalled(releaseGridSlotStub);
        });

        it('should not call releaseGridSlot if no slotId', async () => {
            gridService.addItemToGridCache('workerId', 'companyId', 'gridId');
            await gridService.releaseGridSlot('workerId', 'projectId');
            sinon.assert.notCalled(releaseGridSlotStub);
        });

        it('should handle releaseGridSlot request error', async () => {
            releaseGridSlotStub.rejects({ });
            gridService.addItemToGridCache('workerId', 'companyId', 'gridId', 'slotId', 'chrome');
            await gridService.releaseGridSlot('workerId', 'projectId');
            sinon.assert.calledWith(releaseGridSlotStub, 'companyId', 'projectId', 'slotId', 'gridId', 'chrome');
        });
    });

    describe('keepAlive', () => {
        let clock;
        let keepAliveStub;
        let releaseGridSlotStub;
        beforeEach(() => {
            clock = sinon.useFakeTimers();
            keepAliveStub = sinon.stub(servicesApi, 'keepAliveGrid').resolves();
            releaseGridSlotStub = sinon.stub(servicesApi, 'releaseGridSlot').resolves();
        });
        afterEach(() => {
            clock.restore();
            keepAliveStub.restore();
            releaseGridSlotStub.restore();
        });

        it('should send keepAlive to server on an interval', async () => {
            gridService.addItemToGridCache('workerId', 'companyId', 'gridId', 'slotId', 'chrome');
            await gridService.keepAlive.start('projectId');
            clock.tick(10010);
            sinon.assert.calledOnceWithExactly(keepAliveStub, 'projectId', [{ gridId: 'gridId', companyId: 'companyId', slotId: 'slotId', browser: 'chrome' }]);
            await gridService.releaseGridSlot('workerId', 'projectId');
        });

        it('should send keepAlive to server every 10 seconds', async () => {
            gridService.addItemToGridCache('workerId', 'companyId', 'gridId', 'slotId', 'chrome');
            await gridService.keepAlive.start('projectId');
            clock.tick(30010);
            sinon.assert.calledThrice(keepAliveStub);
            await gridService.releaseGridSlot('workerId', 'projectId');
        });

        it('should not send keepAlive if there is no grid', async () => {
            await gridService.keepAlive.start('projectId');
            clock.tick(10010);
            sinon.assert.notCalled(keepAliveStub);
        });

        it('should handle keepAlive request error', async () => {
            keepAliveStub.rejects({ });
            gridService.addItemToGridCache('workerId', 'companyId', 'gridId', 'slotId', 'chrome');
            await gridService.keepAlive.start('projectId');
            clock.tick(10010);
            sinon.assert.calledOnce(keepAliveStub);
            await gridService.releaseGridSlot('workerId', 'projectId');
        });

        it('should release all slots when ending', async () => {
            gridService.addItemToGridCache('workerId', 'companyId', 'gridId', 'slotId', 'chrome');
            gridService.addItemToGridCache('workerId1', 'companyId', 'gridId', 'slotId1', 'firefox');
            await gridService.keepAlive.start('projectId');
            await gridService.keepAlive.end('projectId');
            sinon.assert.calledTwice(releaseGridSlotStub);
            sinon.assert.calledWith(releaseGridSlotStub, 'companyId', 'projectId', 'slotId', 'gridId', 'chrome');
            sinon.assert.calledWith(releaseGridSlotStub, 'companyId', 'projectId', 'slotId1', 'gridId', 'firefox');
        });

        it('should not release slots if there is no slots in use', async () => {
            await gridService.keepAlive.start('projectId');
            await gridService.keepAlive.end('projectId');
            sinon.assert.notCalled(releaseGridSlotStub);
        });
    });
});

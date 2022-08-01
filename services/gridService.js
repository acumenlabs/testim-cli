'use strict';

const _ = require('lodash');
const Promise = require('bluebird');

const { GridError, ArgError } = require('../errors');
const { hasTestPlanFlag } = require('../utils');
const { gridMessages, gridTypes } = require('../commons/constants');
const logger = require('../commons/logger').getLogger('grid-service');
const servicesApi = require('../commons/testimServicesApi');

const gridCache = {};
const urlExtractRegex = /(^(https?):\/{2})?(.*)/;
let keepAliveTimer = null;

function extractProtocol(grid) {
    if (grid.protocol) {
        return grid.protocol;
    }

    if ([gridTypes.TESTIM, gridTypes.BROWSERSTACK, gridTypes.SAUCELABS].includes(grid.type) && grid.port === 443) {
        return 'https';
    }

    if ([gridTypes.TESTIM_ENTERPRISE, gridTypes.LAMBDATEST, gridTypes.DEVICE_FARM].includes(grid.type)) {
        const urlExtract = urlExtractRegex.exec(grid.host);
        return urlExtract[2] || 'https';
    }

    return '';
}

function extractHost(hostUrl) {
    const urlExtract = urlExtractRegex.exec(hostUrl);
    return urlExtract[3];
}

function getSerializableObject(grid) {
    const host = grid && extractHost(grid.host);
    const port = grid && grid.port;
    const path = grid && grid.path;
    const protocol = grid && extractProtocol(grid);
    const accessToken = grid && grid.token;
    const slotId = grid && grid.slotId;
    const tunnel = grid && grid.hybrid && grid.hybrid.tunnel;
    const user = grid && grid.external && grid.external.user;
    const key = grid && grid.external && grid.external.key;
    const type = grid && grid.type;
    const tunnelUser = type === gridTypes.HYBRID ?
        (tunnel && grid.hybrid.external && grid.hybrid.external[grid.hybrid.tunnel] && grid.hybrid.external[grid.hybrid.tunnel].user) : user;
    const tunnelKey = type === gridTypes.HYBRID ?
        (tunnel && grid.hybrid.external && grid.hybrid.external[grid.hybrid.tunnel] && grid.hybrid.external[grid.hybrid.tunnel].key) : key;
    const name = grid && grid.name;
    const gridId = grid && (grid._id || grid.gridId);
    const provider = grid && grid.provider;

    return {
        host, port, path, protocol, accessToken, slotId, gridId, tunnel, user, key, type, name, provider, tunnelUser, tunnelKey,
    };
}

function handleGetGridResponse(projectId, companyId, workerId, browser, getFun) {
    return getFun()
        .catch(err => {
            logger.error('failed to get grid', { projectId, companyId, err });
            throw new Error(gridMessages.UNKNOWN);
        })
        .then(async (res) => {
            logger.info('get grid info', Object.assign({}, res, { projectId, companyId }));
            const isSuccess = () => res.status === 'success';
            const isError = () => res.status === 'error' && res.code;
            if (!res || (!isError() && !isSuccess())) {
                logger.error('invalid response - get grid', { res });
                throw new Error(gridMessages.UNKNOWN);
            }

            if (isSuccess()) {
                const serGrid = getSerializableObject(res.grid);
                module.exports.addItemToGridCache(workerId, companyId, serGrid.gridId, serGrid.slotId, browser);
                return serGrid;
            }

            if (isError() && res.code === 'not-found') {
                throw new GridError(gridMessages.NOT_FOUND);
            }

            if (isError() && res.code === 'no-available-slot') {
                throw new GridError(`Failed to run test on ${browser} - concurrency limit reached`);
            }

            logger.error('invalid code error response - get grid', { res });
            throw new GridError(gridMessages.UNKNOWN);
        });
}

function addItemToGridCache(workerId, companyId, gridId, slotId, browser) {
    gridCache[workerId] = { gridId, companyId, slotId, browser };
}

function getHostAndPortById(workerId, companyId, projectId, gridId, browser, executionId, options) {
    return handleGetGridResponse(projectId, companyId, workerId, browser, () => servicesApi.getGridById(companyId, projectId, gridId, browser, executionId));
}

function getHostAndPortByName(workerId, companyId, projectId, gridName, browser, executionId, options) {
    const get = () => {
        const grid = options.allGrids && options.allGrids.find(grid => (grid.name || '').toLowerCase() === gridName.toLowerCase());
        if (grid && grid._id) {
            return servicesApi.getGridById(companyId, projectId, grid._id, browser, executionId);
        }
        return servicesApi.getGridByName(companyId, projectId, gridName, browser, executionId);
    };
    return handleGetGridResponse(projectId, companyId, workerId, browser, get);
}

function getAllGrids(companyId) {
    return servicesApi.getAllGrids(companyId);
}

function getGridDataByGridId(companyId, gridId, allGrids) {
    return Promise.resolve(allGrids || getAllGrids(companyId))
        .then(grids => {
            const grid = grids.find(grid => grid._id === gridId);
            if (!grid) {
                throw new ArgError(`Failed to find grid id: ${gridId}`);
            }
            return getSerializableObject(grid);
        });
}

function getGridDataByGridName(companyId, gridName, allGrids) {
    return Promise.resolve(allGrids || getAllGrids(companyId))
        .then(grids => {
            const grid = grids.find(grid => (grid.name || '').toLowerCase() === gridName.toLowerCase());
            if (!grid) {
                throw new ArgError(`Failed to find grid name: ${gridName}`);
            }
            return getSerializableObject(grid);
        });
}

function releaseGridSlot(workerId, projectId) {
    const gridData = gridCache[workerId];
    if (!gridData) {
        return Promise.resolve();
    }

    const { slotId, gridId, browser, companyId } = gridData;
    delete gridCache[workerId];
    if (!slotId) {
        logger.warn('failed to find grid slot id', { projectId });
        return Promise.resolve();
    }

    logger.info('release slot id', { projectId, companyId, slotId, gridId, browser });
    return servicesApi.releaseGridSlot(companyId, projectId, slotId, gridId, browser)
        .catch(err => logger.error('failed to release slot', { projectId, err }));
}

function keepAlive(projectId) {
    const slots = Object.keys(gridCache).reduce((slots, workerId) => {
        slots.push(gridCache[workerId]);
        return slots;
    }, []).filter(Boolean);

    if (_.isEmpty(slots)) {
        return Promise.resolve();
    }

    logger.info('keep alive worker slots', { projectId, slots });
    return servicesApi.keepAliveGrid(projectId, slots)
        .catch(err => logger.error('failed to update grid keep alive', { err, slots, projectId }));
}

function startKeepAlive(projectId) {
    const KEEP_ALIVE_INTERVAL = 10 * 1000;
    keepAliveTimer = setInterval(keepAlive, KEEP_ALIVE_INTERVAL, projectId);
}

function releaseAllSlots(projectId) {
    const workerIds = Object.keys(gridCache);

    if (_.isEmpty(workerIds)) {
        return Promise.resolve();
    }

    logger.warn('not all slots released before end runner flow', { projectId });
    return Promise.map(workerIds, workerId => releaseGridSlot(workerId, projectId))
        .catch(err => logger.error('failed to release all slots', { err, projectId }));
}

function endKeepAlive(projectId) {
    return releaseAllSlots(projectId)
        .then(() => clearInterval(keepAliveTimer));
}

function getVendorKeyFromOptions(type, options) {
    const { testobjectSauce, saucelabs } = options;
    if (type === 'testobject') {
        return testobjectSauce.testobjectApiKey;
    }
    if (type === 'saucelabs') {
        return saucelabs.accessKey;
    }
    return undefined;
}

function getVendorUserFromOptions(type, options) {
    const { saucelabs } = options;
    if (type === 'saucelabs') {
        return saucelabs.username;
    }
    return undefined;
}

function getOptionGrid(options) {
    const getGridType = () => {
        if (!_.isEmpty(options.testobjectSauce)) {
            return 'testobject';
        }

        if (!_.isEmpty(options.saucelabs)) {
            return 'saucelabs';
        }

        if (!_.isEmpty(options.perfecto)) {
            return 'perfecto';
        }

        return 'hostAndPort';
    };
    const type = getGridType();
    const { host, port, path, protocol } = options;
    const key = getVendorKeyFromOptions(type, options);
    const user = getVendorUserFromOptions(type, options);
    return Promise.resolve({ host, port, path, protocol, type, user, key });
}

async function getTestPlanGridData(options, testPlanData) {
    const companyId = options.company.companyId;
    return await getGridDataByGridId(companyId, testPlanData.gridId, options.allGrids);
}

async function getGridData(options) {
    const {
        allGrids = undefined, company,
        host, useLocalChromeDriver, useChromeLauncher, gridId, grid,
    } = options;
    if (useLocalChromeDriver || useChromeLauncher) {
        return { mode: 'local' };
    }
    if (host) {
        return getOptionGrid(options);
    }
    const companyId = company.companyId;
    if (gridId) {
        return getGridDataByGridId(companyId, gridId, allGrids);
    }
    if (grid) {
        return getGridDataByGridName(companyId, grid, allGrids);
    }
    if (hasTestPlanFlag(options) || options.tunnelOnlyMode) {
        logger.info('skipping getting grid, as it is set on test plan', { companyId });
        return undefined;
    }

    throw new GridError('Missing host or grid configuration');
}

const getGridSlot = Promise.method(_getGridSlot);

async function _getGridSlot(browser, executionId, testResultId, onGridSlot, options, workerId) {
    const getGridDataFromServer = () => {
        const { host, project, grid, gridId, useLocalChromeDriver, useChromeLauncher, company = {} } = options;
        const companyId = company.companyId;
        if (useLocalChromeDriver || useChromeLauncher) {
            return { mode: 'local' };
        }
        if (host) {
            return Promise.resolve(getOptionGrid(options));
        }
        if (gridId) {
            return getHostAndPortById(workerId, companyId, project, gridId, browser, executionId, options);
        }
        if (grid) {
            return getHostAndPortByName(workerId, companyId, project, grid, browser, executionId, options);
        }
        throw new GridError('Missing host or grid configuration');
    };

    const gridInfo = await getGridDataFromServer();

    await onGridSlot(executionId, testResultId, gridInfo);

    return gridInfo;
}

const handleHybridOrVendorIfNeeded = async (runnerOptions = { }, gridInfo = {}, testRunConfig = {}, lambdatestService = {}, retryConfig = {}) => {
    const { company = {} } = runnerOptions;
    const companyId = company.companyId;
    const { gridId, type } = gridInfo;
    const browser = runnerOptions.browser || testRunConfig.browserValue;
    const usingTunnel = Boolean(runnerOptions.tunnel);
    const { maxRetries, currentRetry } = retryConfig;

    if (!gridId || !type) {
        return gridInfo;
    }

    if (type === gridTypes.LAMBDATEST) {
        await lambdatestService.enableIfNeeded(gridInfo);
    }

    if (type !== gridTypes.HYBRID || !companyId || !browser || !maxRetries || !currentRetry) {
        return gridInfo;
    }

    const response = await servicesApi.getHybridGridProvider({ companyId, gridId, maxRetries, currentRetry, browser, usingTunnel });
    logger.info('handling hybrid grid', { response, companyId });
    const gridData = getSerializableObject({ ...gridInfo, ...response.connectionDetails, provider: response.provider });
    if (response.provider !== 'lambdatest') {
        lambdatestService.disable();
    }
    if (response.provider === 'lambdatest') {
        await lambdatestService.enableIfNeeded(gridData);
    }

    return gridData;
};

module.exports = {
    getGridSlot,
    releaseGridSlot,
    getGridData,
    getTestPlanGridData,
    addItemToGridCache,
    keepAlive: {
        start: startKeepAlive,
        end: endKeepAlive,
    },
    handleHybridOrVendorIfNeeded,
};

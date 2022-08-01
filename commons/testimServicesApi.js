'use strict';

const pako = require('pako');
const pRetry = require('p-retry');
const _ = require('lodash');
const testimCustomToken = require('./testimCustomToken');
const constants = require('./constants');
const Promise = require('bluebird');
const utils = require('../utils.js');
const config = require('./config');
const httpRequest = require('./httpRequest');

const runnerVersion = utils.getRunnerVersion();
const logger = require('./logger').getLogger('testim service api');
const hash = require('object-hash');
const { ArgError } = require('../errors');

const DEFAULT_REQUEST_RETRY = 3;

function getTokenHeader() {
    return testimCustomToken.getCustomTokenV3()
        .then(brearToken => {
            if (!brearToken) {
                return Promise.reject(new Error('Failed to get token from server'));
            }
            return { Authorization: `Bearer ${brearToken}` };
        });
}

function postAuth({
    url, body, headers = {}, timeout, retry,
}) {
    return getTokenHeader()
        .then(tokenHeaders => {
            const finalHeaders = Object.assign({}, headers, tokenHeaders);
            return httpRequest.post({
                url: `${config.SERVICES_HOST}${url || ''}`,
                body,
                headers: finalHeaders,
                timeout,
                retry,
            });
        });
}

function postAuthFormData(url, fields, files, headers = {}, timeout) {
    return getTokenHeader()
        .then(tokenHeaders => {
            const finalHeaders = Object.assign({}, headers, tokenHeaders);
            return httpRequest.postForm(`${config.SERVICES_HOST}${url || ''}`, fields, files, finalHeaders, timeout);
        });
}

function putAuth(url, body) {
    return getTokenHeader()
        .then(headers => httpRequest.put(`${config.SERVICES_HOST}${url || ''}`, body, headers));
}

function deleteAuth(url, body) {
    return getTokenHeader()
        .then(headers => httpRequest.delete(`${config.SERVICES_HOST}${url || ''}`, body, headers));
}

function getWithAuth(url, query, options, timeout) {
    return getTokenHeader()
        .then(headers => httpRequest.get(`${config.SERVICES_HOST}${url || ''}`, query, headers, timeout, options));
}

function getS3Artifact(url, timeout) {
    return pRetry(() => getWithAuth(`/storage${url}`, null, { isBinary: true }, timeout), { retries: DEFAULT_REQUEST_RETRY });
}

function getTestPlan(projectId, testPlanNames) {
    //TODO: need to be checked after 3 months to prevent users from using old version
    const parseProperty = (dataValue) => (dataValue == null ? [] : (typeof (dataValue) === 'string' && JSON.parse(dataValue)) || dataValue);
    return pRetry((() => getWithAuth('/testPlan', { projectId, name: testPlanNames.join(',') }), { retries: DEFAULT_REQUEST_RETRY }))
        .then(body => body.map(testPlan => {
            testPlan.testConfigIds = parseProperty(testPlan.testConfigIds);
            testPlan.beforeAllLabels = parseProperty(testPlan.beforeAllLabels);
            testPlan.testLabels = parseProperty(testPlan.testLabels);
            testPlan.afterAllLabels = parseProperty(testPlan.afterAllLabels);
            return testPlan;
        }));
}


function loadTest({ testId, branch, projectId, skipSharedSteps = false, useBranchMap = true }) {
    return pRetry(() => getWithAuth(`/test/${testId}`, {
        projectId,
        branch,
        skipSharedSteps,
        useBranchMap,
    }), { retries: DEFAULT_REQUEST_RETRY });
}

function saveTestPlanResult(projectId, testPlanId, result) {
    return pRetry(() => postAuth({ url: '/testPlan/result', body: { projectId, testPlanId, result } }), { retries: DEFAULT_REQUEST_RETRY });
}

function updateTestStatus(projectId, executionId, testId, resultId, status, data, retries = DEFAULT_REQUEST_RETRY) {
    return pRetry(() => putAuth('/result/run/test', {
        runId: executionId,
        testId,
        resultId,
        status,
        projectId,
        runnerVersion,
        ...data,
    }), { retries });
}

function updateExecutionTests(executionId, runnerStatuses, status, reason, success, startTime, endTime, projectId) {
    return pRetry(() => putAuth('/result/run/tests', {
        runId: executionId,
        runnerStatuses,
        status,
        reason,
        success,
        startTime,
        endTime,
        projectId,
    }), { retries: DEFAULT_REQUEST_RETRY });
}

function reportExecutionStarted({
    executionId,
    projectId,
    labels,
    startTime,
    executions,
    config,
    resultLabels,
    remoteRunId,
    localRunUserId,
    isLocalRun,
    intersections,
}) {
    const isCiRun = require('../cli/isCiRun').isCi;
    return postAuth({
        timeout: 90000,
        url: '/result/run',
        body: {
            runId: executionId,
            projectId,
            labels,
            startTime,
            execution: executions,
            status: 'RUNNING',
            config,
            resultLabels,
            remoteRunId,
            intersections,
            metadata: {
                isCiRun,
                localRunUserId,
                isLocalRun,
            },
        },
        retry: 3, // TODO: add a log in the callback
    });
}

function reportExecutionFinished(status, executionId, projectId, success, tmsOptions = {}, remoteRunId, resultExtraData) {
    const endTime = Date.now();

    return pRetry(() => putAuth('/result/run', {
        runId: executionId,
        projectId,
        endTime,
        status,
        success,
        tmsOptions,
        remoteRunId,
        resultExtraData,
    }), { reties: DEFAULT_REQUEST_RETRY });
}

async function getTestPlanTestList(projectId, names, planIds, branch, intersections) {
    return pRetry(() => postAuth({
        url: '/testPlan/list',
        body: { projectId, names, planIds, branch, intersections },
        // people who send insane lists get a timeout :(
        timeout: 120000,
    }), { reties: DEFAULT_REQUEST_RETRY });
}

function getSuiteTestList({
    projectId, labels, testIds, testNames, testConfigNames, suiteNames, suiteIds, branch, rerunFailedByRunId, testConfigIds, intersections,
}) {
    return pRetry(() => postAuth({
        url: '/suite/v2/list',
        body: {
            projectId,
            labels,
            testIds,
            testNames,
            testConfigNames,
            suiteNames,
            suiteIds,
            branch,
            rerunFailedByRunId,
            testConfigIds,
            intersections,
        },
    }), { reties: DEFAULT_REQUEST_RETRY });
}

function getUsageForCurrentBillingPeriod(projectId) {
    return pRetry(() => getWithAuth(`/plan/project/${projectId}/usage-current-billing-period`), { reties: DEFAULT_REQUEST_RETRY })
        .catch((error) => {
            logger.error('failed getting usage for current billing period', { projectId, error });
            return undefined;
        });
}

function isTestResultCompleted(resultId, projectId, testRetryKey) {
    return pRetry(() => getWithAuth(`/result/${resultId}/isComplete`, { projectId, testRetryKey }), { reties: DEFAULT_REQUEST_RETRY });
}

function getTestResults(testId, resultId, projectId, branch) {
    return pRetry(() => getWithAuth(`/test/v2/${testId}/result/${resultId}`, { projectId, branch }), { reties: DEFAULT_REQUEST_RETRY });
}

function keepAliveGrid(projectId, slots) {
    return postAuth({
        url: `/grid/keep-alive?reqId=${utils.guid()}`,
        body: { projectId, slots },
        timeout: 10000,
    });
}

function releaseGridSlot(companyId, projectId, slotId, gridId, browser) {
    return postAuth({
        url: `/grid/release?reqId=${utils.guid()}`,
        body: {
            companyId, projectId, slotId, gridId, browser,
        },
    });
}

function getHybridGridProvider(body) {
    return postAuth({
        url: '/grid/hybrid/provider',
        body,
    });
}

function getGridByName(companyId, projectId, gridName, browser, executionId) {
    return pRetry(() => getWithAuth('/grid/name', {
        companyId, projectId, name: gridName, browser, executionId, reqId: utils.guid(),
    }), { reties: DEFAULT_REQUEST_RETRY });
}

function getGridById(companyId, projectId, gridId, browser, executionId) {
    return pRetry(() => getWithAuth(`/grid/${gridId}`, { companyId, projectId, browser, executionId, reqId: utils.guid() }), { reties: DEFAULT_REQUEST_RETRY });
}


async function initializeUserWithAuth({ projectId, token, branchName, lightweightMode, localGrid }) {
    try {
        return await pRetry(() => httpRequest.post({
            url: `${config.SERVICES_HOST}/executions/initialize`,
            body: {
                projectId,
                token,
                branchName: branchName || 'master',
                lightweightMode,
                localGrid,
            },
        }), { reties: DEFAULT_REQUEST_RETRY });
    } catch (e) {
        logger.error('error initializing info from server', e);
        if (e && e.message && e.message.includes('Bad Request')) {
            throw new ArgError(
                'Error trying to retrieve CLI token. ' +
                'Your CLI token and project might not match. ' +
                'Please make sure to pass `--project` and `--token` that' +
                ' match to each other or make sure they match in your ~/.testim file.');
        }
        if (e && e.code && e.code.includes('ENOTFOUND')) {
            throw new ArgError('Due to network connectivity issues, Testim CLI has been unable to connect to the Testim backend.');
        }
        throw e;
    }
}

async function getEditorUrl() {
    if (config.EDITOR_URL) {
        return config.EDITOR_URL;
    }
    try {
        return await pRetry(() => getWithAuth('/system-info/editor-url'), { reties: DEFAULT_REQUEST_RETRY });
    } catch (err) {
        logger.error('cannot retrieve editor-url from server');
        return 'https://app.testim.io';
    }
}

function getAllGrids(companyId) {
    return pRetry(() => getWithAuth('/grid', { companyId }), { reties: DEFAULT_REQUEST_RETRY });
}

const fetchLambdatestConfig = async () => pRetry(() => getWithAuth('/grid/lt/config'), { reties: DEFAULT_REQUEST_RETRY });

const getLabFeaturesByProjectId = async (projectId) => pRetry(() => getWithAuth(`/labFeature/v2/project/${projectId}`), { reties: DEFAULT_REQUEST_RETRY });


function getRealData(projectId, channel, query) {
    return pRetry(() => getWithAuth(`/real-data/${channel}?${query}&projectId=${projectId}`), { reties: DEFAULT_REQUEST_RETRY });
}

function updateTestResult(projectId, resultId, testId, testResult, remoteRunId) {
    return pRetry(() => postAuth({
        url: '/result/test',
        body: {
            projectId,
            resultId,
            testId,
            testResult,
            remoteRunId,
        },
    }), { reties: DEFAULT_REQUEST_RETRY });
}

function clearTestResult(projectId, resultId, testId, testResult) {
    return pRetry(() => postAuth({
        url: '/result/test/clear',
        body: {
            projectId,
            resultId,
            testId,
            testResult,
        },
    }), { reties: DEFAULT_REQUEST_RETRY });
}

function saveRemoteStep(projectId, resultId, stepId, remoteStep) {
    return pRetry(() => postAuth({
        url: '/remoteStep',
        body: {
            projectId,
            resultId,
            stepId,
            remoteStep,
        },
    }), { reties: DEFAULT_REQUEST_RETRY });
}

function relativize(uri) {
    return uri.startsWith('/') ? uri : `/${uri}`;
}

function getStorageRelativePath(filePath, bucket, projectId) {
    let fullPath = relativize(filePath);
    if (projectId) {
        fullPath = `/${projectId}${fullPath}`;
    }
    if (bucket) {
        fullPath = `/${bucket}${fullPath}`;
    }

    return fullPath;
}

function uploadArtifact(projectId, testId, testResultId, content, subType, mimeType = 'application/octet-stream') {
    let fileSuffix = null;
    if (mimeType === 'application/json') {
        fileSuffix = '.json';
    }
    const fileName = `${subType}_${utils.guid()}${fileSuffix || ''}`;
    const path = `${testId}/${testResultId}/${fileName}`;
    const storagePath = getStorageRelativePath(path, 'test-result-artifacts', projectId);

    const buffer = Buffer.from(pako.gzip(content, {
        level: 3, // sufficient time/size ratio.
    }));

    const files = {
        file: {
            fileName,
            buffer,
        },
    };

    return pRetry(() => postAuthFormData(`/storage${storagePath}`, {}, files, {
        'X-Asset-Encoding': 'gzip',
    }), { reties: DEFAULT_REQUEST_RETRY }).then(() => storagePath);
}

const uploadRunDataArtifact = _.memoize(async (projectId, testId, testResultId, runData) => {
    if (_.isEmpty(runData)) {
        return undefined;
    }
    return await uploadArtifact(projectId, testId, testResultId, JSON.stringify(runData), 'test-run-data', 'application/json');
}, (projectId, testId, testResultId, runData) => `${hash(runData)}:${testId}:${testResultId}`);

const updateTestDataArtifact = _.memoize(async (projectId, testId, testResultId, testData, projectDefaults) => {
    if (_.isEmpty(testData)) {
        return undefined;
    }
    const removeHiddenParamsInTestData = () => {
        const testDataValueClone = _.clone(testData);
        if (projectDefaults && projectDefaults.hiddenParams) {
            const { hiddenParams } = projectDefaults;
            (hiddenParams || []).forEach((param) => {
                if (testDataValueClone[param]) {
                    testDataValueClone[param] = constants.test.HIDDEN_PARAM;
                }
            });
        }
        return testDataValueClone;
    };

    return await uploadArtifact(projectId, testId, testResultId, JSON.stringify(removeHiddenParamsInTestData(testData)), 'test-test-data', 'application/json');
}, (projectId, testId, testResultId, testData) => `${hash(testData)}:${testId}:${testResultId}`);

function addTestRetry({
    projectId,
    runId,
    testId,
    newResultId,
    originalTestResultId,
    previousTestResultId,
    testResult,
}) {
    return pRetry(() => postAuth({
        url: '/result/test/retry',
        body: {
            projectId,
            newResultId,
            originalTestResultId,
            previousTestResultId,
            testId,
            runId,
            testResult,
        },
    }), { reties: DEFAULT_REQUEST_RETRY });
}

/**
 * @param {string} projectId
 * @returns {Promise<import('../../../clickim/src/common/api/testimApplitoolsApi').ApplitoolsIntegrationData>}
 */
function getApplitoolsIntegrationData(projectId) {
    try {
        return getWithAuth(`/integration/applitools/v3/connected?projectId=${projectId}`);
    } catch (err) {
        logger.warn('could\'nt get applitools integration data.', { err });
        return {};
    }
}


function getCloudflareTunnel(companyId, routes) {
    try {
        return putAuth('/tunnel', { companyId, routes });
    } catch (err) {
        logger.warn('could\'nt get tunnel.', { err });
        return {};
    }
}
function forceUpdateCloudflareTunnelRoutes(companyId, tunnelId) {
    try {
        return postAuth({ url: `/tunnel/${tunnelId}`, body: { companyId } });
    } catch (err) {
        logger.warn('could\'nt get tunnel.', { err });
        return {};
    }
}
function deleteCloudflareTunnel(companyId, tunnelId) {
    try {
        return deleteAuth(`/tunnel/${tunnelId}`, { companyId });
    } catch (err) {
        logger.warn('could\'nt get tunnel.', { err });
        return {};
    }
}

function updateRemoteRunFailure(body) {
    return httpRequest.post({ url: `${config.SERVICES_HOST}/result/remoteRunFailure`, body });
}

module.exports = {
    getS3Artifact,
    getTestPlan,
    saveTestPlanResult,
    updateTestStatus,
    updateExecutionTests,
    reportExecutionStarted,
    reportExecutionFinished,
    getTestPlanTestList,
    getSuiteTestList,
    getUsageForCurrentBillingPeriod,
    getTestResults,
    getGridByName,
    releaseGridSlot,
    keepAliveGrid,
    getGridById,
    getAllGrids,
    fetchLambdatestConfig,
    getRealData,
    updateTestResult,
    clearTestResult,
    saveRemoteStep,
    getEditorUrl,
    getLabFeaturesByProjectId,
    uploadRunDataArtifact: Promise.method(uploadRunDataArtifact),
    updateTestDataArtifact: Promise.method(updateTestDataArtifact),
    initializeUserWithAuth: Promise.method(initializeUserWithAuth),
    addTestRetry,
    getHybridGridProvider,
    loadTest,
    isTestResultCompleted,
    getApplitoolsIntegrationData,
    getCloudflareTunnel,
    forceUpdateCloudflareTunnelRoutes,
    deleteCloudflareTunnel,
    updateRemoteRunFailure,
};

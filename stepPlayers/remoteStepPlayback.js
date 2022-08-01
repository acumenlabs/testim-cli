'use strict';

const testimServicesApi = require('../commons/testimServicesApi');

const _ = require('lodash');
const cliJsStepPlayback = require('./cliJsStepPlayback');
const logger = require('../commons/logger').getLogger('step-playback');

const playbacks = {
    'cli-validation-code-step': cliJsStepPlayback,
    'cli-wait-for-code-step': cliJsStepPlayback,
    'cli-action-code-step': cliJsStepPlayback,
    'cli-api-code-step': cliJsStepPlayback,
    'cli-condition-step': cliJsStepPlayback,
    'cli-download-code-step': cliJsStepPlayback,
    'node-package': require('./nodePackageStepPlayback'),
    'tdk-hybrid': require('./hybridStepPlayback'),
};

async function saveRemoteStep(projectId, resultId, stepId, remoteStepData) {
    try {
        return await testimServicesApi.saveRemoteStep(projectId, resultId, stepId, remoteStepData);
    } catch (e) {
        logger.error('failed to report remote step state', { projectId, resultId, stepId });
        return undefined;
    }
}

async function onCompleted(projectId, resultId, stepId, runResult, sessionId) {
    logger.info('finished to run remote step', { stepId, sessionId });
    const remoteStepData = {
        status: 'completed',
        success: true,
        failureReason: null,
        data: runResult,
    };

    return await saveRemoteStep(projectId, resultId, stepId, remoteStepData);
}

async function onFailed(projectId, resultId, stepId, failureReason, sessionId) {
    logger.info('failed to run remote step', { stepId, sessionId, failureReason });
    const remoteStepData = {
        status: 'completed',
        success: false,
        failureReason,
    };

    return await saveRemoteStep(projectId, resultId, stepId, remoteStepData);
}

async function executeStep(options, driver, step, resultId) {
    if (!step || !step.type || step.status === 'completed') {
        return undefined;
    }

    const { project: projectId, projectData, userData } = options;
    const stepType = step.type;
    const sessionId = driver.getSessionId();
    const stepId = step.id;
    logger.info('start play remote step', { stepType, stepId, sessionId });

    const playback = playbacks[stepType];
    if (!playback) {
        return await onFailed(projectId, resultId, stepId, `Failed to find step type ${stepType}`, sessionId);
    }

    try {
        const runResult = await playback.run(driver, step, projectData, userData);
        return await onCompleted(projectId, resultId, stepId, runResult, sessionId);
    } catch (err) {
        return await onFailed(projectId, resultId, stepId, err.message, sessionId);
    }
}

module.exports = {
    executeStep,
};

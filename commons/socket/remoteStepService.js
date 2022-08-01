let remoteStepServiceSocketIO; // required lazily since it takes 150ms to load
const socketService = require('./socketService');

const {socketEventTypes} = require('../constants');
const {REMOTE_STEP_SAVED} = socketEventTypes;
const featureFlags = require('../featureFlags');
const Promise = require('bluebird');

class RemoteStepService {
    init(projectId) {
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            return;
        }
        remoteStepServiceSocketIO = require('./remoteStepServiceSocketIO');
        remoteStepServiceSocketIO.init(projectId);
    }

    joinToRemoteStep(resultId) {
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            return socketService.addFilter(`${resultId}:remoteStep`, {resultId}, [REMOTE_STEP_SAVED]);
        }
        return remoteStepServiceSocketIO.joinToRemoteStep(resultId);
    }

    //TODO remove after migrate to save result via RestAPI
    saveRemoteStep(resultId, stepId, remoteStep) {
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            return Promise.resolve();
        }
        return remoteStepServiceSocketIO.saveRemoteStep(resultId, stepId, remoteStep);
    }

    listenToRemoteStep(resultId, onRemoteStep) {
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            socketService.listenTo(
                `${resultId}:remoteStep`,
                [REMOTE_STEP_SAVED],
                data => data.resultId === resultId && data.remoteStep && data.remoteStep.status === 'pending',
                data => onRemoteStep(data.remoteStep)
            );
            return;
        }
        remoteStepServiceSocketIO.listenToRemoteStep(resultId, onRemoteStep);
    }

    unlistenToRemoteStep(resultId) {
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            socketService.removeFilter(`${resultId}:remoteStep`, [REMOTE_STEP_SAVED]);
            return Promise.resolve();
        }
        return remoteStepServiceSocketIO.unlistenToRemoteStep(resultId);
    }
}

module.exports = new RemoteStepService();

const testResultServiceSocketIO = require('./testResultServiceSocketIO');
const socketService = require('./socketService');

const { EventEmitter } = require('events');
const featureFlags = require('../featureFlags');

const { socketEventTypes } = require('../constants');
const Promise = require('bluebird');

class TestResultService extends EventEmitter {
    init(projectId) {
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            socketService.onConnect = () => this.emit('socket-connected');
            return;
        }
        testResultServiceSocketIO.init(projectId);
        testResultServiceSocketIO.onConnect = () => this.emit('socket-connected');
    }

    joinToTestResult(resultId, testId) {
        //TODO - Consider unifying the joinToTestResult and listenToTestResult flows
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            return socketService.addFilter(`${resultId}:testResult`, { resultId, testId }, [
                socketEventTypes.TEST_RESULT_UPDATED,
                socketEventTypes.TEST_RESULT_CREATED,
            ]);
        }
        testResultServiceSocketIO.joinRoom(resultId, testId);
        return testResultServiceSocketIO.emitJoinRoom(resultId, testId);
    }

    leaveTestResult(resultId, testId) {
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            socketService.removeFilter(`${resultId}:testResult`, [socketEventTypes.TEST_RESULT_UPDATED, socketEventTypes.TEST_RESULT_CREATED]);
            return Promise.resolve();
        }

        return testResultServiceSocketIO.leaveTestResult(resultId, testId);
    }

    listenToTestResult(resultId, testId, onTestResultStatus) {
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            socketService.listenTo(
                `${resultId}:testResult`,
                [socketEventTypes.TEST_RESULT_UPDATED, socketEventTypes.TEST_RESULT_CREATED],
                data => data.resultId === resultId && data.testId === testId,
                data => onTestResultStatus(data)
            );
            return;
        }

        testResultServiceSocketIO.listenToTestResult(resultId, testId, onTestResultStatus);
    }

    getSocket() {
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            return undefined;
        }
        return testResultServiceSocketIO.getSocket();
    }
}

module.exports = new TestResultService();

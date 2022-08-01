"use strict";

const Promise = require('bluebird');
const BaseSocketService = require('./baseSocketServiceSocketIO');

class TestResultServiceSocketIO extends BaseSocketService {
    init(projectId) {
        super.init(projectId, 'testResult');
        this.listerers = {};
    }

    listenToTestResult(resultId, testId, onTestResultStatus) {
        if(this.listerers[resultId]) {
            this._socket.off("testResult:updated", this.listerers[resultId]);
            delete this.listerers[resultId];
        }

        this.listerers[resultId] = data => {
            if (data.resultId === resultId && data.testId === testId) {
                onTestResultStatus(data.testResult);
            }
        };

        this._socket.on("testResult:updated", this.listerers[resultId]);
    }

    emitJoinRoom(resultId, testId) {
        return this.emitPromise("testResult:join", {
            resultId,
            testId
        });
    }

    joinToTestResult(resultId, testId) {
        if(this.rooms[resultId]) {
            return Promise.resolve();
        }
        this.joinRoom(resultId, testId);
        return this.emitJoinRoom(resultId, testId);
    }

    emitLeaveRoom(resultId, testId) {
        return this.emitPromise("testResult:leave", {
            resultId,
            testId
        });
    }

    leaveTestResult(resultId, testId) {
        if(!this.listerers[resultId]) {
            return Promise.resolve();
        }

        this.leaveRoom(resultId);
        this._socket.off("testResult:updated", this.listerers[resultId]);
        delete this.listerers[resultId];
        return this.emitLeaveRoom(resultId, testId);
    }

    getSocket() {
        return this._socket;
    }
}

module.exports = new TestResultServiceSocketIO();

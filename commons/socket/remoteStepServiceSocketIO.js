"use strict";

const Promise = require('bluebird');
const BaseSocketService = require('./baseSocketServiceSocketIO');

class RemoteStepServiceSocketIO extends BaseSocketService {
    init(projectId) {
        super.init(projectId, 'remoteStep');
        this.listerers = {};
    }

    emitJoinRoom(resultId) {
        return this.emitPromise("remoteStep:join", {resultId});
    }

    emitLeaveRoom(resultId) {
        return this.emitPromise("remoteStep:leave", {resultId});
    }

    joinToRemoteStep(resultId) {
        if(this.rooms[resultId]) {
            return Promise.resolve();
        }
        this.joinRoom(resultId);
        return this.emitJoinRoom(resultId);
    }

    saveRemoteStep(resultId, stepId, remoteStep) {
        return this.emitPromise("remoteStep:save", {
            resultId,
            stepId,
            remoteStep
        });
    }

    listenToRemoteStep(resultId, onRemoteStep) {

        if(this.listerers[resultId]) {
            this._socket.off("remoteStep:saved", this.listerers[resultId]);
            delete this.listerers[resultId];
        }

        this.listerers[resultId] = data => {
            if (data.resultId === resultId && data.remoteStep && data.remoteStep.status === 'pending') {
                onRemoteStep(data.remoteStep);
            }
        };
        this._socket.on("remoteStep:saved", this.listerers[resultId]);
    }

    unlistenToRemoteStep(resultId) {
        if(!this.listerers[resultId]) {
            return Promise.resolve();
        }

        this.leaveRoom(resultId);
        this._socket.off("remoteStep:saved", this.listerers[resultId]);
        delete this.listerers[resultId];
        return this.emitLeaveRoom(resultId);
    }
}

module.exports = new RemoteStepServiceSocketIO();

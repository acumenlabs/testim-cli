"use strict";

const BaseSocketService = require('./baseSocketServiceSocketIO');

class RealDataServiceSocketIO extends BaseSocketService {
    init(projectId) {
        return super.initNewSocket(projectId, 'real-data');
    }

    emitJoinRoom(runId, projectId) {
        this._socket.emit("testResult:listen", {query: `projectId=${projectId}&runId=${runId}`});
    }

    joinToTestResultsByRunId(runId, projectId) {
        this.joinRoom(runId, projectId);
        this.emitJoinRoom(runId, projectId);
    }

    stopListenToTestResultsByRunId(runId) {
        this.leaveRoom(runId);
        this._socket.emit("testResult:listen:stop", {});
    }

    listenToTestResultsByRunId(cb) {
        function onDone(data) {
            cb(data.data);
        }

        this._socket.on("testResult:changes", onDone.bind(this));
    }
}

module.exports = RealDataServiceSocketIO;

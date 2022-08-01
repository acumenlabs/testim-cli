"use strict";

const RealDataServiceSocketIO = require('./realDataServiceSocketIO');
const socketService = require('./socketService');

const {socketEventTypes} = require('../constants');
const featureFlags = require('../featureFlags');

const {TEST_RESULT_CREATED, TEST_RESULT_UPDATED} = socketEventTypes;

class RealDataService {
    constructor() {
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            return;
        }
        this.realDataServiceSocketIO = new RealDataServiceSocketIO();
    }

    init(projectId) {
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            return Promise.resolve();
        }
        return this.realDataServiceSocketIO.init(projectId);
    }

    joinToTestResultsByRunId(runId, projectId) {
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            return socketService.addFilter(runId, {runId}, [
                TEST_RESULT_UPDATED,
                TEST_RESULT_CREATED
            ], true);
        }
        this.realDataServiceSocketIO.joinToTestResultsByRunId(runId, projectId);
    }

    stopListenToTestResultsByRunId(runId) {
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            socketService.removeFilter(runId, [TEST_RESULT_UPDATED, TEST_RESULT_CREATED]);
            return;
        }
        this.realDataServiceSocketIO.stopListenToTestResultsByRunId(runId);
    }

    listenToTestResultsByRunId(runId, cb) {
        if (featureFlags.flags.useNewWSCLI.isEnabled()) {
            socketService.listenTo(
                runId,
                [TEST_RESULT_UPDATED, TEST_RESULT_CREATED],
                data => data.runId === runId,
                data => cb(data)
            );
            return;
        }
        this.realDataServiceSocketIO.listenToTestResultsByRunId(cb);
    }
}

module.exports = RealDataService;

'use strict';

const TestRun = require('./testRunHandler.js');

class ExecutionQueue {
    constructor(executionId, executionName, testList, options, branchToUse, testStatus) {
        this._waitingTests = testList.map(testInfo => new TestRun(executionId, executionName, testInfo, options, branchToUse, testStatus));
    }

    stop() {
        this._waitingTests = [];
    }

    getNext() {
        const nextTestRunHandler = this._waitingTests.shift();
        if (nextTestRunHandler) {
            return nextTestRunHandler;
        }
        return undefined;
    }

    hasMoreTests() {
        return Boolean(this._waitingTests.length);
    }
}



module.exports = ExecutionQueue;

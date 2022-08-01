var JsonReporter = function (options) {
    this.options = options;
};

JsonReporter.prototype.onTestStarted = function(test, workerId) {
    var event = {
        name: "testStarted",
        data: {
            test: test,
            workerId: workerId
        }
    };

    console.log(JSON.stringify(event));
};

JsonReporter.prototype.onTestFinished = function(test, workerId) {
    var event = {
        name: "testFinished",
        data: {
            test: test,
            workerId: workerId
        }
    };

    console.log(JSON.stringify(event));
};

JsonReporter.prototype.onTestPlanStarted = function(beforeTests, tests, afterTests, testPlanName, executionId) {
    const event = {
        name: "suiteStarted",
        data: {
            projectId: this.options.project,
            executionId: executionId
        }
    };

    console.log(JSON.stringify(event));
};

JsonReporter.prototype.onTestPlanFinished = function(testResults) {
    var event = {
        name: "suiteFinished",
        data: {
            testResults: testResults
        }
    };

    console.log(JSON.stringify(event));
};

module.exports = JsonReporter;

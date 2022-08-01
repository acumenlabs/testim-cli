'use strict';

const logger = require('../commons/logger').getLogger('reporter');
const Promise = require('bluebird');

const Reporter = function Reporter() {};

Reporter.prototype.setOptions = function (options, branchToUse) {
    this.reporters = [];
    const optReporters = options.reporters;

    const DebugReporter = require('./debugReporter');
    this.reporters.push(new DebugReporter(options));

    if (optReporters === undefined || optReporters.length === 0) {
        const ConsoleReporter = require('./consoleReporter');
        this.reporters.push(new ConsoleReporter(options, branchToUse));
        if (options !== undefined && options.reportFile !== undefined) {
            const JunitReporter = require('./junitReporter');
            this.reporters.push(new JunitReporter(options, branchToUse));
        }
    } else {
        if (optReporters.indexOf('teamcity') > -1) {
            const TeamCityReporter = require('./teamCityReporter');
            this.reporters.push(new TeamCityReporter(options));
        }

        if (optReporters.indexOf('console') > -1) {
            const ConsoleReporter = require('./consoleReporter');
            this.reporters.push(new ConsoleReporter(options, branchToUse));
        }

        if (optReporters.indexOf('junit') > -1) {
            const JunitReporter = require('./junitReporter');
            this.reporters.push(new JunitReporter(options, branchToUse));
        }

        if (optReporters.indexOf('json') > -1) {
            const JsonReporter = require('./jsonReporter');
            this.reporters.push(new JsonReporter(options));
        }

        if (optReporters.indexOf('chrome') > -1) {
            const { ChromeReporter } = require('./chromeReporter');
            this.reporters.push(new ChromeReporter(options, branchToUse));
        }
    }
};

function addHook(name) {
    Reporter.prototype[name] = function (...args) {
        return Promise.filter(this.reporters, reporter => reporter && reporter[name]).each(reporter => reporter[name](...args));
    };
}

addHook('onGetBrowserFailure');
addHook('onGetBrowserSuccess');
addHook('onTestPlanStarted');
addHook('onGetSlot');
addHook('onGetSession');
addHook('onTestFinished');
addHook('onTestFailed');
addHook('onTestPassed');
addHook('onTestStarted');
addHook('onTestIgnored');
addHook('onWaitToTestStart');
addHook('onWaitToTestComplete');

Reporter.prototype.onTestPlanFinished = function (testResults, testPlanName, startTime, executionId, isAnonymous, isCodeMode, childTestResults) {
    let results = {};

    // TODO: remove mutation of testResults from the Reporter
    if (childTestResults) {
        const childValues = Object.values(childTestResults);
        if (childValues.length > 0) {
            for (const child of Object.values(childTestResults)) {
                results[child.id] = child;
            }
            for (const parent of Object.keys(testResults)) {
                if (!childValues.some(c => c.parentResultId !== parent)) {
                    results[parent] = testResults[parent];
                }
            }
        } else {
            logger.warn('childTestResults is not array');
            results = testResults;
        }
    } else {
        results = testResults;
    }

    return Promise.each(this.reporters, reporter => {
        if (reporter && reporter.onTestPlanFinished) {
            const duration = Date.now() - (startTime || 0);
            return reporter.onTestPlanFinished(results, testPlanName, duration, executionId, isAnonymous, isCodeMode);
        }
        return undefined;
    });
};

Reporter.prototype.onTestPlanStarted = function (beforeTests, tests, afterTests, testPlanName, executionId, isAnonymous, configName, isCodeMode) {
    return Promise.each(this.reporters, reporter => {
        if (reporter && reporter.onTestPlanStarted) {
            return reporter.onTestPlanStarted(beforeTests, tests, afterTests, testPlanName, executionId, isAnonymous, configName, isCodeMode);
        }
        return undefined;
    });
};

Reporter.prototype.onGetSlot = function (workerId, browser) {
    return Promise.each(this.reporters, reporter => {
        if (reporter && reporter.onGetSlot) {
            return reporter.onGetSlot(workerId, browser);
        }
        return undefined;
    });
};

Reporter.prototype.onGetSession = function (workerId, testName, mode) {
    return Promise.each(this.reporters, reporter => {
        if (reporter && reporter.onGetSession) {
            return reporter.onGetSession(workerId, testName, mode);
        }
        return undefined;
    });
};

Reporter.prototype.onWaitToTestComplete = function (workerId, isCodeMode, debuggerAddress) {
    return Promise.each(this.reporters, reporter => {
        if (reporter && reporter.onWaitToTestComplete) {
            return reporter.onWaitToTestComplete(workerId, isCodeMode, debuggerAddress);
        }
        return undefined;
    });
};

Reporter.prototype.onWaitToTestStart = function (workerId) {
    return Promise.each(this.reporters, reporter => {
        if (reporter && reporter.onWaitToTestStart) {
            return reporter.onWaitToTestStart(workerId);
        }
        return undefined;
    });
};

Reporter.prototype.onAllTestPlansFinished = function (testPlanResults) {
    // TODO: remove mutation of testPlanResults from the Reporter
    for (const result of testPlanResults) {
        if (result.childTestResults) {
            result.results = {};
            const childValues = Object.values(result.childTestResults);
            for (const child of childValues) {
                result.results[child.id] = child;
            }
            for (const parent of Object.keys(testPlanResults)) {
                if (!childValues.some(c => c.parentResultId !== parent)) {
                    result.results[parent] = testPlanResults[parent];
                }
            }
        }
    }

    return Promise.each(this.reporters, reporter => {
        if (reporter && reporter.onAllTestPlansFinished) {
            return reporter.onAllTestPlansFinished(testPlanResults);
        }
        return undefined;
    });
};


module.exports = new Reporter();

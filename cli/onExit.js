'use strict';

const constants = require('../commons/constants');
const { requireWithFallback } = require('../commons/requireWithFallback');
const { isCi } = require('./isCiRun');
const { writeStackTrace } = require('./writeStackTrace');
const logger = require('../commons/logger').getLogger('process-handler');

let exitCodeIgnoreFailingTests = false;

function getExitCode(result) {
    if (result instanceof Error) {
        return 1;
    }

    if (exitCodeIgnoreFailingTests) {
        return 0;
    }

    result = result || {};
    const hasFailedTests = Object.values(result).some(
        ({ runnerStatus, success, testStatus, status }) => {
            if (
                [runnerStatus, status].includes(constants.runnerTestStatus.SKIPPED) ||
                ([runnerStatus, status].includes(constants.runnerTestStatus.FAILED) &&
                    testStatus === constants.testStatus.EVALUATING)
            ) {
                return false;
            }
            return success !== true;
        }
    );

    return hasFailedTests ? 1 : 0;
}

function closeChromeDriverIfRunning() {
    try {
        const chromedriver = requireWithFallback('chromedriver');
        chromedriver.stop();
    // eslint-disable-next-line no-empty
    } catch (err) { }
}

module.exports.ignoreFailingTestsInExitCode = function () {
    exitCodeIgnoreFailingTests = true;
};


module.exports.onExit = async function onExit(exitValue) {
    if (exitValue && exitValue.stack) {
        if (!isCi) {
            writeStackTrace(exitValue);
        } else {
            // eslint-disable-next-line no-console
            console.error(exitValue, exitValue && exitValue.stack);
        }
    }

    closeChromeDriverIfRunning();

    await logger.waitForFlush();

    process.exit(getExitCode(exitValue));
};

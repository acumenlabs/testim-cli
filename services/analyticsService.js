'use strict';

const analytics = require('../commons/testimAnalytics');
const { isCi } = require('../cli/isCiRun');

const calcSource = (source, user) => {
    if (source !== 'cli' && source !== 'cli-local') {
        return source;
    }

    if (isCi && user) {
        return 'ci-with-user';
    }

    if (isCi) {
        return 'ci';
    }

    if (user) {
        return 'cli-with-user';
    }

    return source;
};

function setLightweightAnalytics(properties, lightweightMode) {
    if (lightweightMode && lightweightMode.type) {
        properties[`${lightweightMode.type}Mode`] = true;
    }
    return properties;
}

function analyticsTestStart({
    executionId, projectId, testId, resultId, companyId, companyName, projectName, companyPlan, sessionType, source, user, lightweightMode, isStartUp,
}) {
    const properties = setLightweightAnalytics({
        executionId,
        projectId,
        testId,
        resultId,
        companyId,
        companyName,
        projectName,
        companyPlan,
        sessionType,
        source: calcSource(source, user),
        isStartUp,
    }, lightweightMode);
    analytics.trackWithCIUser('test-run-ci', properties);
}

function analyticsTestEnd({
    executionId, projectId, testId, resultId, result, companyId, companyName, projectName, companyPlan, sessionType, source, user, lightweightMode,
    logger, isStartUp,
}) {
    try {
        const properties = setLightweightAnalytics({
            executionId,
            projectId,
            testId,
            resultId,
            companyId,
            companyName,
            projectName,
            companyPlan,
            sessionType,
            mockNetworkEnabled: result.wasMockNetworkActivated,
            source: calcSource(source, user),
            isStartUp,
        }, lightweightMode);

        if (result.success) {
            analytics.trackWithCIUser('test-run-ci-success', properties);
            return;
        }
        analytics.trackWithCIUser('test-run-ci-fail', Object.assign({}, properties, { failureReason: result.failureReason }));
    } catch (err) {
        logger.error('failed to update test end analytics', { err });
    }
}



function analyticsExecsStart({ executionId, projectId, sessionType }) {
    analytics.trackWithCIUser('batch-run-ci', {
        executionId,
        projectId,
        sessionType,
    });
}

module.exports = {
    analyticsTestStart,
    analyticsTestEnd,
    analyticsExecsStart,
};

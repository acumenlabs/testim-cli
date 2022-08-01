'use strict';

const _ = require('lodash');

const COMMUNICATION_BUFFER_TIME = 1000;
const UI_VERIFICATION_STEPS = ['simple-ui-verification', 'wait-for-simple-ui-verification'];
const FULL_TIMEOUT_STEP_TYPES = [
    ...UI_VERIFICATION_STEPS,
    'custom-validation',
    'sfdc-recorded-step',
    'sfdc-step-login',
    'sfdc-step-logout',
    'sfdc-step-sobjectcreate',
    'sfdc-step-sobjectdelete',
    'sfdc-step-findrecord',
    'sfdc-step-quickaction',
    'sfdc-step-sobjectvalidate',
    'sfdc-step-launchapp',
    'sfdc-step-closeconsoletabs',
    'sfdc-step-sobjectedit',
];

class PlaybackTimeoutCalculator {
    constructor(isDebuggerConnected) {
        this.resetStepVariables();
        this.resetRetryVariables();
        this.isDebuggerConnected = isDebuggerConnected;
    }

    resetStepVariables(totalStepTime, currentRetryTimes) {
        this.currentRetryTimes = currentRetryTimes || [];
        this.totalStepTime = totalStepTime || 0;
        this.totalStepTimesReport = [];
        this.currentRetryTimesReport = {};
        const now = Date.now();
        this.currentRetryStart = now;
        this.lastUpdateTime = now;
    }

    resetRetryVariables() {
        const now = Date.now();
        this.currentRetryStart = now;
        this.lastUpdateTime = now;
        this.totalStepTimesReport.push(this.currentRetryTimesReport);
        this.currentRetryTimesReport = {};
    }

    initStepRun(stepPlayback) {
        const getRetryTimeoutSuggestions = (totalStepTime) => {
            const timeToPlayStep = this.getTotalStepTimeLeftToPlay(stepPlayback, totalStepTime);
            const MINIMAL_RETRY_TIME = 5000;
            if (timeToPlayStep <= MINIMAL_RETRY_TIME) {
                return [MINIMAL_RETRY_TIME];
            }
            return [Math.max(MINIMAL_RETRY_TIME, timeToPlayStep / 3)];
        };
        stepPlayback.setStartTimestamp();
        const totalStepTime = this.getTotalStepRunTime(stepPlayback);
        const currentRetryTimes = FULL_TIMEOUT_STEP_TYPES.includes(stepPlayback.stepType) ? [totalStepTime] : getRetryTimeoutSuggestions(totalStepTime);
        this.resetStepVariables(totalStepTime, currentRetryTimes);
        stepPlayback.context.data.maxTotalStepTime = totalStepTime;
    }

    getStepTimes() {
        this.totalStepTimesReport.push(this.currentRetryTimesReport);
        return _.cloneDeep(this.totalStepTimesReport);
    }

    initRetryTime() {
        this.resetRetryVariables();
    }

    getTotalStepRunTime(stepPlayback) {
        const HALF_HOUR_IN_MS = 30 * 60 * 1000;
        let fallbackTimeout = stepPlayback.context.config.stepTimeout;
        if (UI_VERIFICATION_STEPS.includes(stepPlayback.stepType)) {
            fallbackTimeout = stepPlayback.context.config.applitoolsStepTimeout || HALF_HOUR_IN_MS;
        }
        if (stepPlayback.step.type.startsWith('sfdc-')) {
            fallbackTimeout = stepPlayback.step.defaultTimeout;
        }
        return (stepPlayback.step.useStepTimeout && stepPlayback.step.stepTimeout) ? stepPlayback.step.stepTimeout : fallbackTimeout;
    }
    getTotalStepTimeLeftToPlay(stepPlayback, totalStepTime = this.totalStepTime) {
        const playTimeSoFar = Date.now() - stepPlayback.startTimestamp;
        return totalStepTime - playTimeSoFar;
    }
    getCurrentRetryTime(stepPlayback) {
        return (stepPlayback.retryIndex < this.currentRetryTimes.length) ?
            this.currentRetryTimes[stepPlayback.retryIndex] :
            this.getTotalStepTimeLeftToPlay(stepPlayback);
    }
    getTotalCurrentRetryTimeLeft(stepPlayback) {
        const totalRetryTime = Date.now() - this.currentRetryStart;
        return this.getCurrentRetryTime(stepPlayback) - totalRetryTime + COMMUNICATION_BUFFER_TIME;
    }
    getTabTimeout(stepPlayback) {
        return this.getTotalCurrentRetryTimeLeft(stepPlayback);
    }
    getDynamicParentTimeout(stepPlayback) {
        return this.getTotalCurrentRetryTimeLeft(stepPlayback);
    }
    getFrameTimeout(stepPlayback) {
        return this.getTotalCurrentRetryTimeLeft(stepPlayback);
    }
    getLocateTimeout(stepPlayback) {
        return this.getTotalCurrentRetryTimeLeft(stepPlayback);
    }

    calcAndroidScrollTimeout(stepPlayback) {
        const buffer = 5000;
        let timePerEvent = 2000; // absolute scroll - 2 seconds per event + buffer

        if (stepPlayback.step.isScrollToElement) {
            // scroll to element, 4 secs per event to account for locate flow in each event
            timePerEvent = 4000;
        }

        return (stepPlayback.step.events.length * timePerEvent) + buffer;
    }

    getActionTimeout(stepPlayback) {
        if (this.isDebuggerConnected) {
            return 6e5;
        }
        const SLEEP_ERROR_MARGIN_MS = 5000;
        const actionType = stepPlayback.step.type;
        const MIN_ACTION_PLAYBACK_TIME = 30000;

        let actionTime;
        if (actionType === 'sleep') {
            actionTime = stepPlayback.step.durationMS + SLEEP_ERROR_MARGIN_MS;
        } else if (actionType === 'android-scroll') {
            actionTime = Math.max(this.calcAndroidScrollTimeout(stepPlayback), MIN_ACTION_PLAYBACK_TIME);
        } else {
            actionTime = Math.max(this.getTotalStepTimeLeftToPlay(stepPlayback), MIN_ACTION_PLAYBACK_TIME);
        }
        return actionTime;
    }

    setStepPhaseTime(phase) {
        const now = Date.now();
        const totalTime = now - this.lastUpdateTime;
        this.lastUpdateTime = now;
        this.currentRetryTimesReport[phase] = totalTime;
    }

    reportGetTabTime() {
        this.setStepPhaseTime('tab');
    }

    reportGetFrameTime() {
        this.setStepPhaseTime('frame');
    }

    reportCalcConditionTime() {
        this.setStepPhaseTime('condition');
    }

    reportPreLocateActionsTime() {
        this.setStepPhaseTime('pre-locate');
    }

    reportFindElementsTime() {
        this.setStepPhaseTime('locate');
    }

    reportStepActionTime() {
        this.setStepPhaseTime('action');
    }
}


module.exports = PlaybackTimeoutCalculator;

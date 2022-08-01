'use strict';

const { gridTypes } = require('./constants');

class FeatureAvailabilityService {
    constructor() {
        /**
         * @type {'free'|'trial'|'pro'}
         */
        this._planType = 'free';
    }

    setPlanType(planType) {
        this._planType = planType;
    }

    get isTestStatusEnabled() {
        return ['pro', 'trial'].includes(this._planType);
    }

    shouldShowFreeGridRunWarning(gridType) {
        return this._planType !== 'pro' && gridType === gridTypes.DEVICE_FARM;
    }
}

module.exports = new FeatureAvailabilityService();

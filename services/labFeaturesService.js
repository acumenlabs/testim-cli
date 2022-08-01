'use strict';

const featureFlagService = require('../commons/featureFlags');
const { getLabFeaturesByProjectId } = require('../commons/testimServicesApi');
const _ = require('lodash');

const logger = require('../commons/logger').getLogger('lab-features-service');

class LabFeaturesService {
    constructor() {
        this.featuresForProject = [];
        this.labBatman = false;
    }

    async loadLabFeatures(projectId, companyPlan) {
        if (!companyPlan || !projectId) {
            logger.error('missing companyPlan or projectId when loading lab features', { companyPlan, projectId });
            this.featuresForProject = [];
        }

        try {
            const labBatman = this.isLabsEnabledForCompany(companyPlan);
            const features = labBatman ? (await getLabFeaturesByProjectId(projectId)) : [];
            this.featuresForProject = features;
            this.labBatman = labBatman;
        } catch (err) {
            logger.error('failed loading lab features', { err, companyPlan, projectId });
            this.featuresForProject = [];
        }
    }

    isFeatureAvailableForProject(featureFlagName) {
        const featureFlag = featureFlagService.flags[featureFlagName];
        this.validateAsLabFeatureFlag(featureFlag);
        const ffValue = featureFlag.getValue();
        if (ffValue === 'disabled') {
            return false;
        }
        if (ffValue === 'enabled') {
            return true;
        }

        const { featuresForProject: features, labBatman } = this;
        const labFeature = features.find(f => f.featureFlagName === featureFlagName);
        const featureEnabled = labFeature && labFeature.enabled;

        return Boolean(labBatman && featureEnabled);
    }

    isLabsEnabledForCompany(companyPlan) {
        return Boolean(_(companyPlan).get('premiumFeatures.enableLabFeatures'));
    }

    validateAsLabFeatureFlag(featureFlag) {
        if ('getValue' in featureFlag) {
            return;
        }

        const msg = `Attempted querying a lab feature flag which isn't a variant. This means that a wrong configuration is being used in FeatureFlagsService (for feature flag: ${featureFlag.name}`;
        logger.error(msg, { featureFlagName: featureFlag.name });
        throw new Error(msg);
    }
}
module.exports = new LabFeaturesService();

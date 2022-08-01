'use strict';

const perf = require('./performance-logger');

perf.log('getSessionPlayerRequire start');
const getSessionPlayerFolder = require('./prepareRunnerAndTestimStartUtils').getSessionPlayerFolder;

const testimAppDataFolder = getSessionPlayerFolder();
/**
 * @type {{
        sessionPlayer: typeof import('../../../clickim/src/background/session/sessionPlayer').SessionPlayer;
        utils: typeof import('../../../clickim/src/lib/utils').utils;
        commonConstants: typeof import('../../../clickim/src/common/commonConstantsStrong');
        locatorBuilderUtils: import('../../../clickim/src/locators/locatorBuilderUtils')['locatorBuilderUtils'];
        assetService: import('../../../clickim/src/background/assetService')['assetService'];
        localAssetService: import('../../../clickim/src/background/localAssetService');
        urlUtils: import('../../../clickim/src/background/portMatch/urlUtils');
        positionUtils: import('../../../clickim/src/lib/positionUtils');
        visibilityUtils: import('../../../clickim/src/background/visibilityUtils');
        apiCall: import('../../../clickim/src/common/playback/apiCall')['apiCall'];
        stepParamBuilder: typeof import('../../../clickim/src/common/stepParamsBuilder').StepParamsBuilder;
        stepParamExpressionEvaluator: import('../../../clickim/src/common/stepParamExpressionEvaluator');
        manifestVersion: string | undefined;
        EyeSdkBuilder: typeof import('../../../clickim/src/background/eyeSdkBuilder').EyeSdkBuilder;
        sfdc: typeof import('sfdc-engine');
    }}
 */
const sessionPlayer = require(require('path').join(testimAppDataFolder, 'sessionPlayer.js')); // eslint-disable-line import/no-dynamic-require

module.exports = sessionPlayer;
perf.log('getSessionPlayerRequire end');

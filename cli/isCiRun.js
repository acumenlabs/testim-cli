"use strict";

// copied from https://github.com/watson/ci-info/blob/master/index.js
module.exports.isCi = !!(
    process.env.CI || // Travis CI, CircleCI, Cirrus CI, Gitlab CI, Appveyor, CodeShip, dsari
    process.env.CONTINUOUS_INTEGRATION || // Travis CI, Cirrus CI
    process.env.BUILD_NUMBER || // Jenkins, TeamCity
    process.env.RUN_ID || // TaskCluster, dsari
    false
);
/* eslint-disable import/no-dynamic-require */

'use strict';

const path = require('path');

module.exports = {
    requireWithFallback,
};

/**
 * Require with statCache issue workaround
 * @param {string} packageNama
 */
function requireWithFallback(packageNama) {
    // Workaround for
    // https://github.com/nodejs/node/issues/31803 statCache
    const mainPath = path.resolve(
        path.dirname(require.resolve(`${packageNama}/package.json`)),
        // @ts-ignore
        require(`${packageNama}/package.json`).main || ''
    );

    return require(mainPath);
}

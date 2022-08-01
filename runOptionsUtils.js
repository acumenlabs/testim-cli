// @ts-check

"use strict";
const config = require('./commons/config');

module.exports = {
    getExtensionsUrl,
    getResolvedExtensionUrl,
    getPlayerUrl
}

/**
 *
 * @param {Readonly<import("commander").CommanderStatic>} program
 */
function getExtensionsUrl(program, useCanonicalURL) {
    const zipFileSuffix = program.canary ? "-master.zip" : ".zip";
    let firefox;
    let chrome;
    if (!useCanonicalURL) {
        firefox = `${config.BLOB_URL}/extension/testim-firefox-profile${zipFileSuffix}`;
        chrome = `${config.BLOB_URL}/extension/testim-headless${zipFileSuffix}`;
    } else {
        firefox = `${config.CANONICAL_BLOB_URL}/extension/testim-firefox-profile${zipFileSuffix}`;
        chrome = `${config.CANONICAL_EDGE_URL}/extension/testim-headless${zipFileSuffix}`;
    }
    return {
        firefox,
        chrome,
        'edge-chromium': chrome,
    };
}

/**
 *
 * @param {Readonly<import("commander").CommanderStatic>} program
 */
function getResolvedExtensionUrl(program) {
    const { chrome, firefox } = getExtensionsUrl(program, false);

    if (program.browser === 'firefox') {
        return firefox;
    } else if(program.browser === 'chrome') {
        return chrome
    } else {
        return [chrome, firefox];
    }
}

/**
 *
 * @param {Readonly<import("commander").CommanderStatic>} program
 */
function getPlayerUrl(program) {
    let playerUrlPrefix = `${config.BLOB_URL}/extension/sessionPlayer`;
    const playerUrl = program.canary ? playerUrlPrefix + "-master" : playerUrlPrefix;

    return playerUrl;
}

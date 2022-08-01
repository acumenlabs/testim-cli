'use strict';

let SERVICES_HOST = process.env.SERVICES_HOST || 'https://services.testim.io';
const canonicalBlobURL = 'https://testimstatic.blob.core.windows.net';
const canonicalEdgeUrl = 'https://tstresultfiles.azureedge.net';
if (process.env.GATEWAY_URL) {
    process.env.CORALOGIX_URL = `${process.env.GATEWAY_URL}/testim/coralogix/api/v1/logs`;
    process.env.SERVICES_HOST = `${process.env.GATEWAY_URL}/testim/services`;
    // set the services for the extension
    process.env.EXTENSION_SERVICES_HOST = process.env.TUNNEL_GATEWAY ? process.env.SERVICES_HOST : SERVICES_HOST;
    SERVICES_HOST = process.env.SERVICES_HOST;
}

module.exports = {
    DISABLE_AGENT_ORIGIN_CHECK: parseInt(process.env.DISABLE_AGENT_ORIGIN_CHECK || '0'),
    DISABLE_DEBUGGER_INFINITE_TIMEOUT: parseInt(process.env.DISABLE_DEBUGGER_INFINITE_TIMEOUT || '0'),
    OVERRIDE_TIMEOUTS: parseInt(process.env.OVERRIDE_TIMEOUTS || '0'),
    EDITOR_URL: process.env.EDITOR_URL,
    WEBSOCKET_HOST: process.env.WEBSOCKET_HOST || `${SERVICES_HOST}/ws`,
    SERVICES_HOST,
    LOGGER_CONSOLE: parseInt(process.env.LOGGER_CONSOLE || '0'),
    LOGGER_DEBUG: parseInt(process.env.LOGGER_DEBUG || '0'),
    WEBDRIVER_DEBUG: parseInt(process.env.WEBDRIVER_DEBUG || '0'),
    IS_ON_PREM: parseInt(process.env.IS_ON_PREM || '0'),
    REQUESTS_QUEUE_SIZE: process.env.REQUESTS_QUEUE_SIZE ? parseInt(process.env.REQUESTS_QUEUE_SIZE) : undefined,
    DEBUG_MODE: parseInt(process.env.DEBUG_MODE || '0'),
    TESTIM_CONCURRENT_WORKER_COUNT: process.env.TESTIM_CONCURRENT_WORKER_COUNT ? parseInt(process.env.TESTIM_CONCURRENT_WORKER_COUNT) : null,
    ROLLOUT_KEY: process.env.ROLLOUT_KEY || '5b5560729601aa6484276518',
    DF_ENABLE_VIDEO: parseInt(process.env.DF_ENABLE_VIDEO || '0'),
    START_WORKER_DELAY_MS: parseInt(process.env.START_WORKER_DELAY_MS || 1500),
    APPIUM_VERSION: process.env.APPIUM_VERSION || '1.10.1',

    GATEWAY_URL: process.env.GATEWAY_URL,
    EXTENSION_SERVICES_HOST: process.env.EXTENSION_SERVICES_HOST || SERVICES_HOST,
    BLOB_URL: process.env.GATEWAY_URL ? `${process.env.GATEWAY_URL}/testim/blob` : canonicalBlobURL,
    EDGE_URL: process.env.GATEWAY_URL ? `${process.env.GATEWAY_URL}/testim/edge` : canonicalEdgeUrl,
    CANONICAL_BLOB_URL: canonicalBlobURL,
    CANONICAL_EDGE_URL: canonicalEdgeUrl,
};

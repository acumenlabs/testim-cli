"use strict";
const { DISABLE_DEBUGGER_INFINITE_TIMEOUT } = require('./config');

module.exports.isDebuggerConnected = () => {
    try {
        if (DISABLE_DEBUGGER_INFINITE_TIMEOUT) {
            return false;
        }
        const inspector = require('inspector');
        //https://github.com/GoogleChrome/puppeteer/blob/14fb3e38db7c97fc3ea76c65e6f219b0ddb3b54f/utils/testrunner/TestRunner.js#L279
        if (inspector.url()) {
            return true;
        }
    } catch (e) {
        return false;
    }
};

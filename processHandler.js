/* eslint-disable no-console */

'use strict';

const Promise = require('bluebird');
const logger = require('./commons/logger').getLogger('process-handler');

const exitHooks = [];

module.exports = function (onExit, _process = process) {
    async function cleanup(err) {
        // give cleanup and socket reports a chance to run
        await Promise.all(exitHooks.map(x => x())).timeout(10000).catch(() => {});
        onExit(err);
    }
    _process.on('uncaughtException', async (err) => {
        logger.error('Caught exception', { err });
        console.log('Uncaught exception');
        if (err.message) {
            console.log('Message =', err.message);
        }
        if (err.reason) {
            console.log('Reason =', err.reason);
        }
        await cleanup(err);
    });

    _process.on('unhandledRejection', (reason) => {
        // rollout manages promises incorrectly and generates unhandled rejections from within their code
        logger.fatal('Caught unhandled promise rejection', reason);
        //TODO(benji) - this is a pretty shitty way to detect this error since rollout can change their API endpoint
        if (reason && reason.message && reason.message.includes('ENOTFOUND x-api.rollout.io')) {
            // this is not a fatal error - we recover from this in feature-flags service
            return;
        }

        throw reason;
    });

    _process.on('rejectionHandled', () => {
        logger.error('Caught rejection handled');
    });

    _process.once('SIGTERM', () => {
        const msg = 'Runner aborted - SIGTERM event';
        const err = new Error(msg);
        logger.error(msg);
        cleanup(err);
        throw err;
    });

    _process.once('SIGINT', () => {
        const msg = 'Runner aborted - SIGINT event';
        const err = new Error(msg);
        logger.error(msg);
        cleanup(err);
        throw err;
    });

    // One time self-call is expected :(
    _process.once('exit', (e) => {
        onExit(e);
    });
};

module.exports.registerExitHook = function (hook) {
    exitHooks.push(hook);
};

module.exports.reset = function () {
    exitHooks.splice(0, exitHooks.length);
};

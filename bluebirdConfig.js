"use strict";

/**
 * Configure bluebird promises
 */
const Promise = require('bluebird');
const { isDebuggerConnected } = require('./commons/detectDebugger');
const { OVERRIDE_TIMEOUTS } = require('./commons/config');
Promise.config({
    // Disable warnings.
    warnings: false,
    // Enable long stack traces.
    longStackTraces: Boolean(isDebuggerConnected()),
    // Disable cancellation.
    cancellation: false
});

let warnedAboutDebugger = false;
if (OVERRIDE_TIMEOUTS) {
    let old = Promise.prototype.timeout;
    const timeoutOverride = Number(OVERRIDE_TIMEOUTS || 6e5);
    if (!OVERRIDE_TIMEOUTS && !warnedAboutDebugger) {
        warnedAboutDebugger = true;
        console.log('Debugger connected - timeouts were overridden to 10 minutes to improve debugging');
    }
    Promise.prototype.timeout = function onPromiseTimeout() {
        return old.call(this, timeoutOverride);
    };
}

if (process.env.IS_BLUEBIRD_NATIVE_PROMISE_SCHEDULER) {
    // If the debugger is connected we skip the trampoline in order to schedule with native promise scheduling
    // which makes the V8 debugger aware of promise scheduling and makes async stack traces work without a lot of unnecessary bluebird-specific frames.
    const NativePromise = (async function () {})().constructor;
    const ResolvedNativePromise = NativePromise.resolve();
    Promise.setScheduler(fn => ResolvedNativePromise.then(fn));
}

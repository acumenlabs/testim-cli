"use strict";

const MEASURE_TESTIM_CLI_PERFORMANCE = process.env.MEASURE_TESTIM_CLI_PERFORMANCE;
let epoch = Date.now();
let last = Date.now();

module.exports = {
    log(...args) {
        if (!MEASURE_TESTIM_CLI_PERFORMANCE) {
            return;
        }
        let time = Date.now();
        console.log(`${time - epoch}\t\t\t${time - last}\t\t\t`, ...args);
        last = time;
    },
    measure(fn) {
        if (!MEASURE_TESTIM_CLI_PERFORMANCE) {
            return;
        }
        const start = Date.now();
        try {
            fn();
        } finally {
            console.log(fn.name, 'took', Date.now() - start);
        }
    },
    patchPromisePrototype() {
        Promise.prototype.log = function log (message) {
            if (!MEASURE_TESTIM_CLI_PERFORMANCE) {
                return this;
            }
            return this.then((v) => {
                module.exports.log(message);
                return v;
            });
        };
        // patch Promise.prototype to contain a log method
        require('bluebird').prototype.log = function log(message) {
            if (!MEASURE_TESTIM_CLI_PERFORMANCE) {
                return this;
            }
            return this.tap(() => module.exports.log(message));
        }
    },
    measureRequireTimes() {
        if (!MEASURE_TESTIM_CLI_PERFORMANCE) {
            return;
        }
        const {
            performance,
            PerformanceObserver
        } = require('perf_hooks');
        const mod = require('module');

        // Monkey patch the require function
        mod.Module.prototype.require = performance.timerify(mod.Module.prototype.require);
        require = performance.timerify(require);

        // Activate the observer
        const obs = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            entries.sort((a, b) => b.duration - a.duration).filter(x => x.duration > 1).forEach((entry) => {
                console.log(`require('${entry[0]}')`, entry.duration);
            });
            obs.disconnect();
        });
        obs.observe({ entryTypes: ['function'], buffered: true });
    }
}

// ew ~ Benji
module.exports.patchPromisePrototype();

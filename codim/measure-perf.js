const startTime = Date.now();
let last = 0;
global.log = function time(message) {
    let time = Date.now() - startTime;
    console.log(time, time - last ,message);
    last = time;
};
global.perf = function perf(fn) {
    const start = Date.now();
    try {
        fn();
    } finally {
        console.log(fn.name, 'took', Date.now() - start);
    }
}

require('bluebird').prototype.log = function log(message) {
    return this.tap(() => global.log(message));
}

global.measureRequireTimes = () => {
    'use strict';
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

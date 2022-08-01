const pRetry = require('p-retry');
const { makeCounters } = require('./httpRequestCounters');
const { rejects, doesNotReject, strictEqual } = require('assert');

describe('the http request counters', () => {
    let wrapWithMonitoring;
    beforeEach(() => {
        wrapWithMonitoring = makeCounters();
    });

    it('marks an always failing network as unhealthy', async () => {
        const fn = pRetry(wrapWithMonitoring(() => { throw new Error('bad network'); }), { retries: 30, minTimeout: 0, maxTimeout: 0 });
        await rejects(fn);
        strictEqual(await wrapWithMonitoring.isNetworkHealthy(), false);
    });

    it('marks an unstable network as unhealthy', async () => {
        const fn = pRetry(wrapWithMonitoring(() => { throw new Error('bad network'); }), { retries: 30, minTimeout: 0, maxTimeout: 0 });
        const fn2 = pRetry(wrapWithMonitoring(() => 'hello'), { retries: 20, minTimeout: 0, maxTimeout: 0 });
        await rejects(fn);
        await doesNotReject(fn2);
        strictEqual(await wrapWithMonitoring.isNetworkHealthy(), false);
    });

    it('marks a trivial amount of failed requests as healthy', async () => {
        const fn = pRetry(wrapWithMonitoring(() => { throw new Error('bad network'); }), { retries: 30, minTimeout: 0, maxTimeout: 0 });
        await rejects(fn);
        const fn2 = wrapWithMonitoring(() => 'hello');
        await Promise.all(Array(290).fill().map(fn2));
        strictEqual(await wrapWithMonitoring.isNetworkHealthy(), true);
    });

    it('marks a healthy network as healthy', async () => {
        const fn2 = wrapWithMonitoring(() => 'hello');
        await Promise.all(Array(200).fill().map(fn2));
        strictEqual(await wrapWithMonitoring.isNetworkHealthy(), true);
    });
});

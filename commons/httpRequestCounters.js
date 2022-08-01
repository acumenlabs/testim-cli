'use strit';

const { sum } = require('lodash');
const Bluebird = require('bluebird');
const dns = require('dns');
const _ = require('lodash');
const config = require('./config');

const logger = require('./logger').getLogger('http-request-counters');

let networkConnectivityTestFailed = false;

/** Tests network connectivity with DNS resolution (a basic test for a 7 later stack parallel but essential to most HTTP requests) */
const testNetworkConnectivity = async () => {
    if (config.IS_ON_PREM) {
        return true;
    }
    const hostnames = ['www.google.com', 'www.facebook.com', 'www.microsoft.com', 'testim.io'];
    try {
        // If any of these domains resolve we consider the connectivity to be ok
        const result = Boolean(await Bluebird.any(hostnames.map(host => dns.promises.lookup(host))));
        if (!result) {
            networkConnectivityTestFailed = true;
        }
        return result;
    } catch (e) {
        logger.error('network connectivity test failed');
        networkConnectivityTestFailed = true;
        return false;
    }
};
const throttledTestNetworkConnectivity = _.throttle(testNetworkConnectivity, 10 * 1000);

// we remove entries after 15 minutes, note that this isn't accurate because
// we remove the "fail"/"success" 10 minutes after we add them (and not the "call")
// this is fine since these values are an estimation and not an accurate representation
// we poll them when a test fails - so values older than 15 minutes (10 minutes is
// the default timeout) are hardly relevant.
const ttl = 60 * 1000 * 15;

module.exports.makeCounters = () => {
    const counters = {
        call: new Map(),
        success: new Map(),
        fail: new Map(),
    };
    function update(counter, key) {
        const result = counter.get(key) || 0;
        counter.set(key, result + 1);
        setTimeout(() => {
            const result = counter.get(key) || 1;
            counter.set(key, result - 1);
        }, ttl);
    }
    function wrapWithMonitoring(fn, name = fn.name) {
        return Bluebird.method(async function (...args) {
            update(counters.call, name);
            try {
                const result = await fn.call(this, ...args);
                update(counters.success, name);
                return result;
            } catch (e) {
                update(counters.fail, name);
                if (!networkConnectivityTestFailed) {
                    throttledTestNetworkConnectivity();
                }
                throw e;
            }
        });
    }
    wrapWithMonitoring.isNetworkHealthy = async function isNetworkHealthy() {
        if (networkConnectivityTestFailed || !(await testNetworkConnectivity())) {
            return false;
        }
        const allFailed = sum([...counters.fail.values()]);
        const allCalls = sum([...counters.call.values()]);
        // we declare a test unhealthy network wise if
        // 10% or more of requests (out of finished requests) failed
        // note that the network can be unhealthy but the test would still pass
        return allFailed < allCalls * 0.1;
    };
    wrapWithMonitoring.counters = counters; // expose the counters used to the outside
    wrapWithMonitoring.isNetworkHealthy.counters = wrapWithMonitoring.counters;
    wrapWithMonitoring.didNetworkConnectivityTestFail = () => networkConnectivityTestFailed;
    return wrapWithMonitoring;
};

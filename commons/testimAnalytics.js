'use strict';

/* segment.io */
const config = require('./config');
const Analytics = require('analytics-node');

const analytics = new Analytics('sJOSIGKa5x5rJEGsaOlCjrgozAf7FnVY', { flushAt: 1 });

const anonymousId = require('crypto').randomBytes(20).toString('hex');

function identify(data) {
    if (config.IS_ON_PREM) {
        return;
    }
    if (!data || !data.userId) {
        data = { anonymousId };
    }
    analytics.identify(data);
}

function trackWithCIUser(eventName, properties) {
    return track('ci', eventName, properties);
}

function track(userId, eventName, properties) {
    if (config.IS_ON_PREM) {
        return;
    }
    const id = userId ? { userId } : { anonymousId };
    analytics.track(Object.assign(id, {
        event: eventName,
        properties,
    }));
}

module.exports = {
    identify,
    track,
    trackWithCIUser,
};

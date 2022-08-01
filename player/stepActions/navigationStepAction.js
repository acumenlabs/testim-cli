"use strict";

const StepAction = require('./stepAction');
const url = require('url');
const Promise = require('bluebird');

class NavigationStepAction extends StepAction {

    updateBaseUrl(location) {
        let orgUrl = url.parse(location);
        const baseLocation = url.parse(this.context.recordedBaseUrl);
        const newBaseLocation = url.parse(this.context.baseUrl);
        if (orgUrl.host === baseLocation.host && baseLocation.host !== newBaseLocation.host) {
            orgUrl.host = newBaseLocation.host;
        }
        return Promise.resolve(orgUrl.href);
    }

    performAction() {
        const url = this.context.data.testimNavigationStepDestination || this.context.data.url;

        return this.updateBaseUrl(url)
            .then(url => this.driver.url(url))
            .then(() => Promise.resolve());
    }

}

module.exports = NavigationStepAction;

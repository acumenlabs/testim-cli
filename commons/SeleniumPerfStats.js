'use strict';

const _ = require('lodash');
const { guid, calcPercentile } = require('../utils');

const SELENIUM_PERF_MARKS = {
    GET_BROWSER: 'GET_BROWSER',
    GET_HTML: 'GET_HTML',
    GET_ELEMENT: 'GET_ELEMENT',
    GET_SCREENSHOT: 'GET_SCREENSHOT',
};

class SeleniumPerfStats {
    constructor() {
        this.marks = _.mapValues(SELENIUM_PERF_MARKS, () => []);
        this.marks.ALL = [];
        this.startTimes = {};
    }

    markStart(mark) {
        const id = guid();
        this.startTimes[`${mark}:${id}`] = Date.now();
        return id;
    }

    markEnd(id, mark) {
        const markDuration = Date.now() - this.startTimes[`${mark}:${id}`];
        delete this.startTimes[`${mark}:${id}`];

        if (!this.marks[mark]) {
            this.marks.ALL.push(markDuration);
            return;
        }
        this.marks[mark].push(markDuration);
    }

    getStats() {
        return {
            seleniumPerfMarks: this.marks,
            seleniumStats: _.chain(this.marks).transform(
                (result, samples, key) => {
                    if (_.isEmpty(samples)) {
                        return;
                    }
                    result[`${key}_COUNT`] = samples.length;
                    result[`${key}_P50`] = calcPercentile(samples, 50);
                    result[`${key}_P95`] = calcPercentile(samples, 95);
                },
                {}
            ).value(),
        };
    }
}

module.exports = {
    SELENIUM_PERF_MARKS,
    SeleniumPerfStats,
};

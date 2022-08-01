'use strict';

const { ReportBase } = require('istanbul-lib-report');
const _ = require('lodash');

class SummaryToObjectReport extends ReportBase {
    constructor(opts) {
        super();

        opts = opts || {};
        this.appendToObject = opts.appendToObject || {};
    }

    onStart(node) {
        const summary = node.getCoverageSummary();
        this.appendToObject = Object.assign(this.appendToObject, summary.toJSON());
    }
}

module.exports = SummaryToObjectReport;

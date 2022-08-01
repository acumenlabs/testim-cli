const utils = require('../utils');
const { launchChrome } = require('../commons/chrome-launcher');

module.exports.ChromeReporter = class ChromeReporter {
    constructor(options, branchToUse) {
        this.options = options;
        this.branchToUse = branchToUse;
    }

    onTestStarted(test, workerId, isRerun, isCodeMode) {
        if(isCodeMode) {
            return
        }
        const testUrl = utils.getTestUrl(this.options.editorUrl, this.options.project, test.testId, test.resultId, this.branchToUse);
        return launchChrome(testUrl);
    }
};

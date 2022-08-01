const {SELENIUM_STATUS_CODES} = require('./constants');

//https://github.com/webdriverio-boneyard/v4/blob/master/lib/utils/ErrorHandler.js
//https://github.com/webdriverio-boneyard/v4/blob/master/LICENSE-MIT
class WebDriverError  extends Error {
    constructor(type, msg, details) {
        super();

        if (typeof msg === 'number') {
            // if ID is not known error throw UnknownError
            if (!SELENIUM_STATUS_CODES[msg]) {
                msg = 13; // UnknownError
            }

            this.type = SELENIUM_STATUS_CODES[msg].id;
            this.message = SELENIUM_STATUS_CODES[msg].message;

            if (msg === 7 && details) { //NoSuchElement
                this.message = `${this.message.slice(0, -1)} ("${details}").`;
            }
        } else if (arguments.length > 1) {
            this.details = details;
            this.message = msg;
            this.type = type;
        } else if (arguments.length === 1) {
            this.type = 'TestimWebdriverError';
            this.message = type;
        }

        /**
         * don't modify error if no response is available
         */
        if (typeof this.message !== 'object') {
            Error.captureStackTrace(this, WebDriverError);
            return;
        }

        let seleniumStack = this.message;

        if (seleniumStack.screenshot) {
            this.screenshot = seleniumStack.screenshot;
            delete seleniumStack.screenshot;
        }

        if (seleniumStack.message && seleniumStack.type) {
            if (typeof seleniumStack.orgStatusMessage === 'string' && seleniumStack.orgStatusMessage.match(/"errorMessage":"NoSuchElement"/)) {
                seleniumStack.type = 'NoSuchElement';
                seleniumStack.status = 7;
                seleniumStack.message = SELENIUM_STATUS_CODES['7'].message;
            }

            this.message = seleniumStack.message + ' (' + seleniumStack.type + ':' + seleniumStack.status + ')';
        }

        if (typeof seleniumStack.orgStatusMessage === 'string') {
            let reqPos = seleniumStack.orgStatusMessage.indexOf(',"request"');
            let problem = '';

            if (reqPos > 0) {
                problem = JSON.parse(seleniumStack.orgStatusMessage.slice(0, reqPos) + '}').errorMessage;
            } else {
                problem = seleniumStack.orgStatusMessage;
            }

            if (problem.indexOf('No enum constant org.openqa.selenium.Platform') > -1) {
                problem = 'The Selenium backend you\'ve chosen doesn\'t support the desired platform (' + problem.slice(46) + ')';
            }

            // truncate errorMessage
            if (problem.indexOf('(Session info:') > -1) {
                problem = problem.slice(0, problem.indexOf('(Session info:')).trim();
            }

            // make assumption based on experience on certain error messages
            if (problem.indexOf('unknown error: path is not absolute') !== -1) {
                problem = 'You are trying to set a value to an input field with type="file", use the `uploadFile` command instead (Selenium error: ' + problem + ')';
            }

            this.message = problem;
            this.seleniumStack = seleniumStack;
        }

        Error.captureStackTrace(this, WebDriverError );
    }

    /**
     * make stack loggable
     * @return {Object} error log
     */
    toJSON() {
        return {
            name: this.type,
            message: this.message
        };
    }
}

module.exports = function (msg, details) {
    return new WebDriverError('SeleniumProtocolError', msg, details);
};

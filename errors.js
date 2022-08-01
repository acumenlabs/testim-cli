const { AbortError } = require('p-retry');
/**
 * NoArgsError - throws when arguments not passed to cli
 *
 */
function NoArgsError() {
    this.name = 'NoArgsError';
    Error.captureStackTrace(this, NoArgsError);
}

NoArgsError.prototype = Object.create(Error.prototype);
NoArgsError.prototype.constructor = NoArgsError;

/**
 * ArgError - throws when argument is invalid
 *
 */
function ArgError(message) {
    this.message = message;
    this.name = 'ArgError';
    Error.captureStackTrace(this, ArgError);
}

ArgError.prototype = Object.create(Error.prototype);
ArgError.prototype.constructor = ArgError;

/**
 * SeleniumError - throws when selenium return error
 *
 */
function SeleniumError(seleniumStack) {
    this.message = seleniumStack.orgStatusMessage || seleniumStack.message;
    this.errorType = seleniumStack.type;
    this.name = 'SeleniumError';
    Error.captureStackTrace(this, SeleniumError);
}

SeleniumError.prototype = Object.create(Error.prototype);
SeleniumError.prototype.constructor = SeleniumError;

/**
 * StopRunOnError
 *
 */
function StopRunOnError(message) {
    this.message = message;
    this.name = 'StopRunOnError';
    Error.captureStackTrace(this, StopRunOnError);
}

StopRunOnError.prototype = Object.create(Error.prototype);
StopRunOnError.prototype.constructor = StopRunOnError;

class GetBrowserError extends Error {
    constructor(message, type) {
        super(message);
        this.type = type;
    }
}

class PageNotAvailableError extends AbortError {
}

class QuotaDepletedError extends Error { }

class GridError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GridError';
    }

    toString() {
        return this.message;
    }
}

/**
 * NpmPackageError
 *
 */
function NpmPackageError(message) {
    this.message = message;
    this.name = 'NpmPackageError';
    Error.captureStackTrace(this, NpmPackageError);
}

NpmPackageError.prototype = Object.create(Error.prototype);
NpmPackageError.prototype.constructor = NpmPackageError;

/**
 * SeleniumCrashError
 *
 */
function SeleniumCrashError() {
    this.message = 'selenium driver crashed';
    this.name = 'SeleniumCrashError';
    Error.captureStackTrace(this, SeleniumCrashError);
}
SeleniumCrashError.prototype = Object.create(Error.prototype);
SeleniumCrashError.prototype.constructor = SeleniumCrashError;

/**
 * IeError
 *
 */
function IeError(msg = '') {
    this.message = msg;
    this.name = 'IeError';
    Error.captureStackTrace(this, IeError);
}
IeError.prototype = Object.create(Error.prototype);
IeError.prototype.constructor = IeError;

class ClientError extends Error {}

class PlaygroundCodeError extends Error {}

class NpmPermissionsError extends Error {
    constructor(path) {
        super(`Testim had missing write access to ${path}`);
        this.path = path;
    }
}

class NotImplementedError extends Error {
    constructor(descendant = false) {
        let message = 'not implemented';
        if (descendant) {
            message = 'should be implemented on descendant';
        }
        super(message);
    }
}

module.exports = {
    NoArgsError,
    SeleniumError,
    ArgError,
    StopRunOnError,
    GetBrowserError,
    PageNotAvailableError,
    GridError,
    QuotaDepletedError,
    NpmPackageError,
    NpmPermissionsError,
    SeleniumCrashError,
    IeError,
    ClientError,
    PlaygroundCodeError,
    NotImplementedError,
};

'use strict';

class AbortError extends Error {
    constructor(message = "aborted") {
        super(message);
        this.name = "AbortError";
    }
}

module.exports = {
    AbortError
}

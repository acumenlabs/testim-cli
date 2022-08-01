function isOldProtocol(err) {
    return (
        (err.message && err.message.match(/Command not found/)) ||
        err.message === 'HTTP method not allowed' ||
        err.message === 'Unknown error' ||
        (err.message && err.message.match(/Unknown timeout type/)) ||
        (err.seleniumStack && err.seleniumStack.type === 'UnknownCommand') ||
        (err.message && err.message.match(/did not match a known command/)) ||
        (err.message && err.message.match(/Server returned HTTP response code: 405 for URL/)) ||
        (err.seleniumStack && err.seleniumStack.message === 'The arguments passed to a command are either invalid or malformed.') ||
        err.message.match(/Invalid timeout type specified: ms/)
    );
}

function encodeForSafari(url, isSafari, logger) {
    if (!isSafari || !url) {
        return url;
    }

    // don't touch the URL if it has %. Technically incorrect (% alone breaks Safari),
    // but otherwise we can break other people's URLs. Replace spaces because it's safe.
    if (url.includes('%')) {
        return url.replace(/ /g, '%20');
    }

    try {
        const isAlreadyEncoded = decodeURI(url) !== url;
        if (isAlreadyEncoded) {
            return url;
        }
        return encodeURI(url);
    } catch (err) {
        if (logger) {
            logger.warn('tried to encode url but failed', { err, url });
        }
        return url;
    }
}

module.exports = { isOldProtocol, encodeForSafari };

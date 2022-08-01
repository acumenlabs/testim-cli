"use strict";

const logger = require('../../commons/logger').getLogger('cookies-utils');

module.exports = function (driver) {
    class CookieUtils {
        set(cookie) {
            let domain = cookie.domain;
            if(!cookie.hostOnly) {
                if (domain && !domain.startsWith('.')) {
                    domain = `.${domain}`;
                }
            }
            return driver.setCookie(cookie.name, cookie.value, domain, cookie.httpOnly, cookie.secure, cookie.path, cookie.expirationDate)
                .catch(err => {
                    logger.error("failed to set cookie", {err});
                    throw err;
                });
        }

        get(cookie) {
            return driver.getCookie(cookie.name)
                .catch(err => {
                    logger.error("failed to get cookie", {err});
                    throw err;
                });
        }

        remove(cookie) {
            return driver.deleteCookie(cookie.name)
                .catch(err => {
                    logger.error("failed to remove cookie", {err});
                    throw err;
                });
        }
    }

    return new CookieUtils();
};

'use strict';

const lazyRequire = require('../commons/lazyRequire');
const { AbortError } = require('../commons/AbortError');
const { last } = require('lodash');
const { getArgumentsFromContext } = require('../codim/hybrid-utils');

module.exports.execute = async function executePlaywrightFunction(player, hybridFunction, step, testimContext, source, abortSignal) {
    let onAbort;

    try {
        const playwright = await lazyRequire('playwright');

        if (abortSignal.aborted) {
            throw new AbortError();
        }

        const browser = await playwright.chromium.connect({
            wsEndpoint: player.driver.cdpUrl,
        });

        if (abortSignal.aborted) {
            browser.disconnect();
            throw new AbortError();
        }

        onAbort = function onAbort() {
            // this will make any future browser action to fail
            browser.disconnect();
        }
        abortSignal.addEventListener("abort", onAbort);

        //TODO(Benji) https://github.com/microsoft/playwright/issues/1985

        const playwrightContext = await browser.newContext({viewport: null })
        const pages = await playwrightContext.pages();
        const page = last(pages);
        function getLocator(arg) {
            return page.$(arg.selector);
        }
        const args = await getArgumentsFromContext(step, testimContext, getLocator);
        const fn = hybridFunction.bind(null, page, ...args);

        await fn();
        return { success: true }
    } catch (e) {
        if (abortSignal.aborted) {
            return { success: false, shouldRetry: false, reason: "aborted" };
        }

        return {
            success: false,
            reason: (e && e.message || e) ,
            extraInfo: e && e.constructor && e.constructor.name
        };
    } finally {
        if (onAbort) {
            abortSignal.removeEventListener("abort", onAbort);
        }
    }
}

'use strict';

const lazyRequire = require('../commons/lazyRequire');
const { AbortError } = require('../commons/AbortError');
const { last } = require("lodash");
const { getArgumentsFromContext } = require('../codim/hybrid-utils');

module.exports.execute = async function executePuppeteerFunction(player, hybridFunction, step, context, source, abortSignal) {
    let onAbort;

    try {
        /**
         * @type {typeof import("puppeteer")}
         */
        const puppeteer = await lazyRequire('puppeteer');

        if (abortSignal.aborted) {
            throw new AbortError();
        }

        const browser = await puppeteer.connect({
            browserWSEndpoint: player.driver.cdpUrl,
            defaultViewport: null, // disable puppeteer resize
            product: 'chrome', //
        });

        if (abortSignal.aborted) {
            browser.disconnect();
            throw new AbortError();
        }

        onAbort = function onAbort() {
            // this will make puppeteer action to fail
            browser.disconnect();
        }

        abortSignal.addEventListener("abort", onAbort);

        const pages = await browser.pages();
        let foundMainPage;

        for (const page of pages) {
            if (await page.evaluate(function () {
                return window.__isMainTestimTab;
            })) {
                foundMainPage = page;
                break;
            }
        }

        const page = foundMainPage ? foundMainPage : last(pages);
        function getLocator(arg) {
            return page.$(arg.selector);
        }

        const args = await getArgumentsFromContext(step, context, getLocator);
        const fn = hybridFunction.bind(null, page, ...args);


        await fn();
        return { success: true }
    } catch (e) {
        if (abortSignal.aborted) {
            return { success: false, shouldRetry: false, reason: "aborted" };
        }

        return {
            success: false,
            shouldRetry: false,
            reason: (e && e.message || e),
            extraInfo: e && e.constructor && e.constructor.name
        };
    } finally {
        abortSignal.removeEventListener("abort", onAbort);
    }
}

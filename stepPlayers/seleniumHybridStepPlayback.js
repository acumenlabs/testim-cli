'use strict';

const lazyRequire = require('../commons/lazyRequire');
const { getArgumentsFromContext } = require('../codim/hybrid-utils');

module.exports.execute = async function executeSeleniumFunction(player, hybridFunction, step, context, source, abortSignal) {
    let onAbort;

    // with selenium - we don't have any instrumentation - so we just run the code.
    try {
        // selenium hybrid test
        /**
         * @type {import("selenium-webdriver")}
         */
        const { WebDriver } = await lazyRequire('selenium-webdriver');

        if (abortSignal.aborted) {
            throw new AbortError();
        }

        const { Executor, HttpClient } = require('selenium-webdriver/http');

        const webdriverOptions = player.driver.client.requestHandler.defaultOptions;
        const startPath = player.driver.client.requestHandler.startPath;
        const seleniumServerUrl = `${webdriverOptions.protocol}://${webdriverOptions.hostname}:${webdriverOptions.port}`;
        const seleniumUrl = seleniumServerUrl + startPath; // we do not add startPath since selenium-webdriver adds /wd/hub on its own + startPath;
        const client = new HttpClient(seleniumUrl);
        const webDriver = new WebDriver(player.getSessionId() , new Executor(client));

        // find main tab
        await fixSeleniumMainTab(webDriver, player.driver);

        function getLocator(arg) {
            return webDriver.findElement({ css: arg.selector });
        }

        const args = await getArgumentsFromContext(step, context, getLocator);
        const fn = hybridFunction.bind(null, webDriver, ...args);

        onAbort = function onAbort() {
            // We don't have real way to abort user code,
            // So we kill the http client of the WebDriver
            client.send = async function send() {
                throw new AbortError();
            }
        }
        abortSignal.addEventListener("abort", onAbort);

        await fn();
        return { success: true };
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
        if (onAbort) {
            abortSignal.removeEventListener("abort", onAbort);
        }
    }
};

async function fixSeleniumMainTab(webDriver, driver) {
    if (!driver.cdpUrl) {
        // remote run
        return;
    }
    {
        const contexts = await webDriver.getAllWindowHandles();
        for(const context of contexts) {
            await webDriver.switchTo().window(context);
            const isMainTab = await webDriver.executeScript("return window.__isMainTestimTab");
            if (isMainTab) {
                break;
            }
        }
    }
}

/* eslint-disable no-console */

'use strict';

const { sinon, expect } = require('../../test/utils/testUtils');
const proxyquire = require('proxyquire').noCallThru();
const { NpmPermissionsError } = require('../errors');

describe('prepareRunnerAndTestimStartUtils', () => {
    describe('prepareChromeDriver', () => {
        let prepareChromeDriver;
        let chromeDriverWrapper;

        beforeEach(() => {
            chromeDriverWrapper = {
                install: sinon.stub(),
                start: sinon.stub(),
                isReady: sinon.stub(),
            };
            prepareChromeDriver = proxyquire('./prepareRunnerAndTestimStartUtils', {
                './chromedriverWrapper': chromeDriverWrapper,
            }).prepareChromeDriver;
        });

        afterEach(() => {
            sinon.restore();
        });

        it('should call install and start chromedriver', async () => {
            chromeDriverWrapper.install.resolves();
            chromeDriverWrapper.start.resolves();
            chromeDriverWrapper.isReady.resolves();
            const driverOptions = { someOption: 'option' };

            await prepareChromeDriver({ name: 'some username' }, driverOptions);

            expect(chromeDriverWrapper.install).to.have.been.calledOnce;
            expect(chromeDriverWrapper.start).to.have.been.calledOnce;
            expect(chromeDriverWrapper.isReady).to.have.been.calledOnceWithExactly(driverOptions);
        });

        it('should throw if an NpmPermissionsError was thrown while installing', async () => {
            const error = new NpmPermissionsError('/path/with/no/access');
            chromeDriverWrapper.install.rejects(error);

            expect(prepareChromeDriver()).to.be.rejectedWith(error);
        });

        it('should throw if an Error was thrown while starting', async () => {
            const error = new Error('oh noes');
            chromeDriverWrapper.install.resolves();
            chromeDriverWrapper.start.rejects(error);

            expect(prepareChromeDriver()).to.be.rejectedWith(error);
        });

        it('should print instructions if Error was thrown while starting', async () => {
            sinon.stub(console, 'log');
            const error = new Error('oh noes');
            chromeDriverWrapper.install.resolves();
            chromeDriverWrapper.start.rejects(error);

            await expect(prepareChromeDriver()).to.be.rejected;
            expect(console.log).to.have.been.calledOnceWith(`
1. If you don't have Chrome, please install it from https://www.google.com/chrome.
2. If Chrome is installed, please verify it's binary directory:
    - installed where chromedriver expects it (see https://github.com/SeleniumHQ/selenium/wiki/ChromeDriver#requirements).
    - exists in your PATH environment variables.
3. Try adding --chrome-binary-location flag to Testim CLI specifying the exact location of chrome binary in your computer (e.g on Windows "C:/Program Files/Google/Chrome/Application/chrome.exe").
4. You can always use a standalone Selenium grid and providing it's details with the --host and --port flags (see https://www.npmjs.com/package/selenium-standalone)`);
        });
    });
});

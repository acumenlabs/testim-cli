'use strict';

const proxyquire = require('proxyquire').noCallThru();
const { sinon, expect } = require('../../test/utils/testUtils');
const os = require('os');
const { NpmPermissionsError } = require('../errors');
const path = require('path');

const fs = require('fs');

describe('npmWrapper', () => {
    describe('installPackageLocally', () => {
        describe('unit', () => {
            class ExecError extends Error {
                constructor(stderr) {
                    super();
                    this.stderr = stderr;
                }
            }

            let npmWrapper;

            let fakeChildProcess;
            let fakeLogger;
            let fakeFS;
            let originalConsole;
            beforeEach(() => {
                fakeChildProcess = { exec: sinon.stub() };
                fakeLogger = { warn: sinon.stub(), info: sinon.stub() };
                fakeFS = {
                    promises: {
                        access: sinon.stub().rejects(new Error()),
                    },
                };
                originalConsole = global.console;
                global.console = { log: sinon.stub(), error: sinon.stub() };

                npmWrapper = proxyquire('./npmWrapper', {
                    child_process: fakeChildProcess,
                    fs: fakeFS,
                    './logger': { getLogger: () => fakeLogger },
                });
            });

            afterEach(() => {
                global.console = originalConsole;
            });

            function stubExecRejection(err) {
                fakeChildProcess.exec.yields(undefined, Promise.reject(err));
            }

            it('should call npm with expected arguments', async () => {
                fakeChildProcess.exec.yields(undefined, []); //resolve without errors
                const cwd = '/some/dir';
                const pkg = 'some-package';
                const expectedCmd = 'npm i some-package --no-save --no-prune --prefer-offline --no-audit --progress=false';
                const expectedExecParams = { cwd };

                await npmWrapper.installPackageLocally(cwd, pkg);

                expect(fakeChildProcess.exec).to.have.been.calledOnce;
                const [cmd, execParams] = fakeChildProcess.exec.firstCall.args;
                expect(cmd).to.eql(expectedCmd);
                expect(execParams).to.eql(expectedExecParams);
            });

            it('should throw an error if nothing was printed to stderr', async () => {
                const execErr = new ExecError(undefined);

                stubExecRejection(execErr);

                await expect(npmWrapper.installPackageLocally('/some/dir', 'some-package')).to.be.rejectedWith(execErr);
            });

            it('should throw an error if an error which isnt related to permissions occurred', async () => {
                const execErr = new ExecError('not related, really');

                stubExecRejection(execErr);

                await expect(npmWrapper.installPackageLocally('/some/dir', 'some-package')).to.be.rejectedWith(execErr);
            });

            it('should throw an error if stderr includes "EACCES", but the path was not specified', async () => {
                const execErr = new ExecError('EACCES permission denied, oh no');

                stubExecRejection(execErr);

                await expect(npmWrapper.installPackageLocally('/some/dir', 'some-package')).to.be.rejectedWith(execErr);
            });

            [
                {
                    stderr: 'EACCES\n\tpermission denied, access \'/some/path\'\n\t',
                    expectedPath: '/some/path',
                },
                {
                    stderr: `npm WARN @testim/testim-cli@3.108.0 No repository field.
npm WARN @testim/testim-cli@3.108.0 license should be a valid SPDX license expression

npm ERR! code EACCES
npm ERR! syscall access
npm ERR! path /usr/local/lib/node_modules/@testim/testim-cli/node_modules
npm ERR! errno -13
npm ERR! Error: EACCES: permission denied, access '/usr/local/lib/node_modules/@testim/testim-cli/node_modules'
npm ERR!  [Error: EACCES: permission denied, access '/usr/local/lib/node_modules/@testim/testim-cli/node_modules'] {
npm ERR!   errno: -13,
npm ERR!   code: 'EACCES',
npm ERR!   syscall: 'access',
npm ERR!   path: '/usr/local/lib/node_modules/@testim/testim-cli/node_modules'
npm ERR! }`,
                    expectedPath: '/usr/local/lib/node_modules/@testim/testim-cli/node_modules',
                },
            ].forEach(({ stderr, expectedPath }) => {
                it(`should throw an NpmPermissionsError if stderr is ${stderr}`, async () => {
                    const execErr = new ExecError(stderr);

                    stubExecRejection(execErr);

                    expect(npmWrapper.installPackageLocally('/some/dir', 'some-package')).to.be
                        .rejectedWith(NpmPermissionsError, `Testim had missing write access to ${expectedPath}`);
                });

                it(`should print the path to console error if stderr is ${stderr}`, async () => {
                    const execErr = new ExecError(stderr);
                    const packageName = 'some-package';
                    const expectedMessage = `

Testim failed installing the package ${packageName} due to insufficient permissions.
This is probably due to an installation of @testim/testim-cli with sudo, and running it without sudo.
Testim had missing write access to ${expectedPath}

`;

                    stubExecRejection(execErr);

                    try {
                        await npmWrapper.installPackageLocally('/some/dir', packageName);
                    } catch {
                        //it doesn't really matter if an error was thrown or not
                    } finally {
                        // eslint-disable-next-line no-console
                        expect(console.error).to.have.been.calledOnceWith(expectedMessage);
                    }
                });

                it(`should log the error if stderr is ${stderr}`, async () => {
                    const execErr = new ExecError(stderr);
                    const packageName = 'some-package';
                    const expectedInLog = {
                        package: packageName,
                        path: expectedPath,
                    };

                    stubExecRejection(execErr);

                    try {
                        await npmWrapper.installPackageLocally('/some/dir', packageName);
                    } catch {
                        //it doesn't really matter if an error was thrown or not
                    } finally {
                        // eslint-disable-next-line no-console
                        expect(fakeLogger.info).to.have.been.calledOnce;
                        const [message, body] = fakeLogger.info.firstCall.args;
                        expect(message).to.eql('Failed to install package due to insufficient write access');
                        expect(body).to.include(expectedInLog);
                    }
                });
            });
        });

        describe('integration', () => {
            const npmWrapper = require('./npmWrapper');

            it('should install a package on the designated folder', async () => {
                const dirToInstall = path.resolve(os.tmpdir(), `runnerTest_npmWrapper_${Date.now()}`);
                const pkg = 'map-obj';
                fs.mkdirSync(dirToInstall);
                const expectedFile = path.resolve(dirToInstall, 'node_modules', pkg, 'package.json');

                await npmWrapper.installPackageLocally(dirToInstall, pkg);

                expect(fs.existsSync(expectedFile), 'expected package.json file to be generated').to.be.true;
                // eslint-disable-next-line import/no-dynamic-require
                expect(require(expectedFile).name, 'unexpected package was installed').to.be.eql(pkg);
            }).timeout(20000);

            it('should throw an NpmPermissionsError if npm had permission issues', async () => {
                const dirToInstall = path.resolve(os.tmpdir(), `runnerTest_npmWrapper_${Date.now()}`);
                fs.mkdirSync(dirToInstall);
                const nodeModulesDir = path.resolve(dirToInstall, 'node_modules');
                fs.mkdirSync(nodeModulesDir);
                fs.chmodSync(nodeModulesDir, '000'); //no permissions at all
                const pkg = 'map-obj';
                const unexpectedDir = path.resolve(nodeModulesDir, pkg);

                await expect(npmWrapper.installPackageLocally(dirToInstall, pkg)).to.be.rejectedWith(NpmPermissionsError);

                expect(fs.existsSync(unexpectedDir), 'expected the package not to be installed - this could be a problem with the test itself, and not the tested class').to.be.false;
            }).timeout(20000);
        });

        describe('shirnkwrap handling', () => {
            let fakeChildProcess;
            let fakeLogger;
            let originalConsole;
            const shrinkwrapPath = '/some/dir/npm-shrinkwrap.json';
            const shrinkwrapDummyPath = '/some/dir/npm-shrinkwrap-dummy.json';
            beforeEach(() => {
                fakeChildProcess = { exec: sinon.stub() };
                fakeLogger = { warn: sinon.stub(), info: sinon.stub() };
                originalConsole = global.console;
                global.console = { log: sinon.stub(), error: sinon.stub() };
            });

            afterEach(() => {
                global.console = originalConsole;
            });

            it('does not call rename if access fails', async () => {
                const fakeFS = {
                    promises: {
                        access: sinon.stub(),
                        rename: sinon.stub(),
                    },
                };
                fakeFS.promises.access.rejects();
                const npmWrapper = proxyquire('./npmWrapper', {
                    child_process: fakeChildProcess,
                    fs: fakeFS,
                    './logger': { getLogger: () => fakeLogger },
                });

                fakeChildProcess.exec.yields(undefined, []); //resolve without errors
                const cwd = '/some/dir';
                const pkg = 'some-package';
                await npmWrapper.installPackageLocally(cwd, pkg);
                sinon.assert.calledOnce(fakeFS.promises.access);
                sinon.assert.notCalled(fakeFS.promises.rename);
                expect(fakeFS.promises.access.getCall(0).args[0]).to.be.equal(shrinkwrapPath);
            });

            it('calls rename once if rename fails on the first time', async () => {
                const fakeFS = {
                    promises: {
                        access: sinon.stub().resolves(),
                        rename: sinon.stub().rejects(),
                    },
                };

                const npmWrapper = proxyquire('./npmWrapper', {
                    child_process: fakeChildProcess,
                    fs: fakeFS,
                    './logger': { getLogger: () => fakeLogger },
                });

                fakeChildProcess.exec.yields(undefined, []); //resolve without errors
                const cwd = '/some/dir';
                const pkg = 'some-package';
                await npmWrapper.installPackageLocally(cwd, pkg);
                sinon.assert.calledOnce(fakeFS.promises.access);
                sinon.assert.calledOnce(fakeFS.promises.rename);
            });

            it('calls rename twice if first is success', async () => {
                const fakeFS = {
                    promises: {
                        access: sinon.stub().resolves(),
                        rename: sinon.stub().resolves(),
                    },
                };
                const npmWrapper = proxyquire('./npmWrapper', {
                    child_process: fakeChildProcess,
                    fs: fakeFS,
                    './logger': { getLogger: () => fakeLogger },
                });

                fakeChildProcess.exec.yields(undefined, []); //resolve without errors
                const cwd = '/some/dir';
                const pkg = 'some-package';

                await npmWrapper.installPackageLocally(cwd, pkg);
                sinon.assert.calledOnce(fakeFS.promises.access);
                sinon.assert.calledTwice(fakeFS.promises.rename);
                expect(fakeFS.promises.access.getCall(0).args[0]).to.be.equal(shrinkwrapPath);
                expect(fakeFS.promises.rename.getCall(0).args[0]).to.be.equal(shrinkwrapPath);
                expect(fakeFS.promises.rename.getCall(0).args[1]).to.be.equal(shrinkwrapDummyPath);
                expect(fakeFS.promises.rename.getCall(1).args[0]).to.be.equal(shrinkwrapDummyPath);
                expect(fakeFS.promises.rename.getCall(1).args[1]).to.be.equal(shrinkwrapPath);
            });

            it('doesn\'t throw if first rename fails', async () => {
                const fakeFS = {
                    promises: {
                        access: sinon.stub().resolves(true),
                        rename: sinon.stub().rejects(),
                    },
                };
                const npmWrapper = proxyquire('./npmWrapper', {
                    child_process: fakeChildProcess,
                    fs: fakeFS,
                    './logger': { getLogger: () => fakeLogger },
                });

                fakeChildProcess.exec.yields(undefined, []); //resolve without errors
                const cwd = '/some/dir';
                const pkg = 'some-package';
                await npmWrapper.installPackageLocally(cwd, pkg);
                sinon.assert.calledOnce(fakeFS.promises.access);
                sinon.assert.calledOnce(fakeFS.promises.rename);
                expect(fakeFS.promises.access.getCall(0).args[0]).to.be.equal(shrinkwrapPath);
                expect(fakeFS.promises.rename.getCall(0).args[0]).to.be.equal(shrinkwrapPath);
                expect(fakeFS.promises.rename.getCall(0).args[1]).to.be.equal(shrinkwrapDummyPath);
            });

            it('doesn\'t throw is second rename fails', async () => {
                const fakeFS = {
                    promises: {
                        access: sinon.stub().resolves(),
                        rename: sinon.stub().onFirstCall().resolves().onSecondCall()
                            .rejects(),
                    },
                };

                const npmWrapper = proxyquire('./npmWrapper', {
                    child_process: fakeChildProcess,
                    fs: fakeFS,
                    './logger': { getLogger: () => fakeLogger },
                });

                fakeChildProcess.exec.yields(undefined, []); //resolve without errors
                const cwd = '/some/dir';
                const pkg = 'some-package';
                await npmWrapper.installPackageLocally(cwd, pkg);
                sinon.assert.calledOnce(fakeFS.promises.access);
                sinon.assert.calledTwice(fakeFS.promises.rename);
                expect(fakeFS.promises.access.getCall(0).args[0]).to.be.equal(shrinkwrapPath);
                expect(fakeFS.promises.rename.getCall(0).args[0]).to.be.equal(shrinkwrapPath);
                expect(fakeFS.promises.rename.getCall(0).args[1]).to.be.equal(shrinkwrapDummyPath);
                expect(fakeFS.promises.rename.getCall(1).args[0]).to.be.equal(shrinkwrapDummyPath);
                expect(fakeFS.promises.rename.getCall(1).args[1]).to.be.equal(shrinkwrapPath);
            });

            it('calls rename even if exec fails', async () => {
                const fakeFS = {
                    promises: {
                        access: sinon.stub().resolves(),
                        rename: sinon.stub().onFirstCall().resolves().onSecondCall()
                            .rejects(),
                    },
                };

                fakeChildProcess.exec.throws();

                const npmWrapper = proxyquire('./npmWrapper', {
                    child_process: fakeChildProcess,
                    fs: fakeFS,
                    './logger': { getLogger: () => fakeLogger },
                });

                const cwd = '/some/dir';
                const pkg = 'some-package';
                await expect(npmWrapper.installPackageLocally(cwd, pkg)).to.be.rejected;
                sinon.assert.calledOnce(fakeFS.promises.access);
                sinon.assert.calledTwice(fakeFS.promises.rename);
                expect(fakeFS.promises.access.getCall(0).args[0]).to.be.equal(shrinkwrapPath);
                expect(fakeFS.promises.rename.getCall(0).args[0]).to.be.equal(shrinkwrapPath);
                expect(fakeFS.promises.rename.getCall(0).args[1]).to.be.equal(shrinkwrapDummyPath);
                expect(fakeFS.promises.rename.getCall(1).args[0]).to.be.equal(shrinkwrapDummyPath);
                expect(fakeFS.promises.rename.getCall(1).args[1]).to.be.equal(shrinkwrapPath);
            });
        });
    });
});

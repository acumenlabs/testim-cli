"use strict";

const Promise = require('bluebird');
const util = require('util');
const writeFileAsync = util.promisify(require('fs').writeFile);
const path = require('path');
const {fork} = require('child_process');
const os = require('os');
const {ClientError, PlaygroundCodeError} = require('../../../errors');
const CODE_TYPES = ['playwright', 'selenium', 'puppeteer'];

const runForks = {};

async function createTempFile(fileName, data, encoding = 'utf8') {
    const fullPath = path.join(os.tmpdir(), fileName);
    await writeFileAsync(fullPath, data, encoding);
    return fullPath;
}

const forkAsync = (fileFullPath) => {
    let gotResolved;
    const promise = new Promise(resolve => gotResolved = resolve);

    const child = fork(fileFullPath, {stdio: [ 'inherit', 'inherit', 'inherit', 'ipc' ]});
    promise.child = child;
    child.on('message', (message) => {
        if(!message) {
            return;
        }
        const {type, error} = message;
        if(error && ['uncaughtException', 'unhandledRejection'].includes(type)) {
            return gotResolved({error: Object.assign(new PlaygroundCodeError(), {innerStack: message.error.stack})})
        }
    });
    child.on('error', (error) => {
        gotResolved({error});
    });
    child.on('exit', (exitCode) => {
        gotResolved({exitCode});
    });

    return promise;
};

async function runCodeLocally({code}) {
    const forkId = Date.now();
    try {
        const codeWithExtra = `
        module.paths = ${JSON.stringify(module.paths)};
        process.on('unhandledRejection', (error) => {
            process.send({type: 'unhandledRejection', error: {message: error.message, stack: error.stack}});
            process.exit(1);
        });
        process.on('uncaughtException', (error) => {
            process.send({type: 'uncaughtException', error: {message: error.message, stack: error.stack}});
            process.exit(1);
        });
        ${code};
    `;
        const fileFullPath = await createTempFile(`tst-playground-${Date.now()}.js`, codeWithExtra);
        const promiseExec = forkAsync(fileFullPath);
        runForks[forkId] = promiseExec.child;
        const {error, exitCode} = await promiseExec;
        if(error) {
            throw error;
        }
        if(exitCode !== 0) {
            throw new Error(`Process exited with exit code: ${exitCode}`);
        }
        return undefined;
    } finally {
        if(runForks[forkId]) {
            runForks[forkId].kill();
            delete runForks[forkId];
        }
    }
}

async function runPlaygroundTest({code, type}) {
    if(['playwright', 'puppeteer', 'selenium'].includes(type)) {
        return runCodeLocally({code});
    }
    throw new ClientError();
}

async function stopPlaygroundTest() {
    Object.keys(runForks).forEach((forkId) => {
        runForks[forkId].kill();
        delete runForks[forkId];
    });
}

module.exports = {
    CODE_TYPES,
    runPlaygroundTest,
    stopPlaygroundTest,
};

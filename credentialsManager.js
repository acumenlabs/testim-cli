"use strict";

const fse = require('fs-extra');
const path = require('path');
const Promise = require('bluebird');
const YAML = require('yaml');
const os = require('os');
const { launchChrome } = require('./commons/chrome-launcher');

async function getProjectId() {
    return getCredentialProperty('projectId');
}

async function getToken() {
    return getCredentialProperty('token');
}

function timeout(promise, ms) {
    // we need this to time out even if we disabled timeouts system wide
    return Promise.race([promise, Promise.delay(ms).then(() => { throw new Promise.TimeoutError('timeout'); })]);
}

async function getCredentialsFromChrome() {
    const app = require('express')();
    const loginInfoFromChrome = (async function waitForChromeToSendData() {
        return timeout(new Promise(resolve => app.get('/loginInfo', (req, res) => {
            resolve(JSON.parse(Buffer.from(req.query.info, 'base64').toString()));
            res.status(200).end();
        })), 60000).catch(() => {
            return null;
        });
    })();
    await new Promise((resolve, reject) => {
        const server = app.listen(42543, (err) => {
            if (err) {
                reject(err);
            }
            resolve(server.address().port);
        });
    });

    const { getEditorUrl } = require('./commons/testimServicesApi');

    try {
        const url = await getEditorUrl();
        launchChrome(`${url}/#/new-test`);
    } catch (err) {
        console.log('Unable to open Testim automatically - please manually go to https://app.testim.io');
    }

    const data = await loginInfoFromChrome;
    return data;
}

async function doLogin({overwriteExisting = true, projects = null} = {}) {
    const homedir = os.homedir();

    const testimCredentialsFile = path.join(homedir, '.testim');

    const isExist = await fse.pathExists(testimCredentialsFile);

    if (isExist && !overwriteExisting) {
        return;
    }

    let credentials = {};

    const prompts = require('prompts');
    const ora = require('ora');

    let spinner = ora(`Getting credentials from Testim extension ...`).start();

    if (!projects) {
        projects = await timeout(Promise.resolve(getCredentialsFromChrome()), 62000).catch(e => {
            return null;
        });
    }

    if (projects && projects.token) { // V1(legacy) of the login extension API
        credentials.token = projects.token;
        credentials.projectId = projects.projectId;
        spinner.succeed();

        await writeCredentials(testimCredentialsFile, credentials);
        return;
    } else if (projects && projects.length) { // V2(current) of the login extension API

        spinner.succeed();

        const response = projects.length === 1 ?
            { project: projects[0]} :
            await prompts({
                type: 'select',
                name: 'project',
                message: 'There are multiple projects associated with your user account. Please select the project you would like to connect to:',
                choices: projects.map(p => ({title: p.name, value: p}))
            }
        );

        credentials.token = response.project.ci.token;
        credentials.projectId = response.project.id;
        await writeCredentials(testimCredentialsFile, credentials);
        return;
    }

    spinner.fail();
    console.log('Error getting credentials - please pass `--token` and `--project` to the CLI or try again');

}

async function writeCredentials(testimCredentialsFile, credentials) {
    await fse.writeFile(testimCredentialsFile, YAML.stringify(credentials));
    console.log(`Testim credentials saved in '${testimCredentialsFile}'`)
}

async function getCredentialProperty(property) {
    const homedir = os.homedir();

    const testimCredentialsFile = path.join(homedir, '.testim');

    const isExist = await fse.pathExists(testimCredentialsFile);

    let credentials = {};

    if (isExist) {
        try {
            credentials = YAML.parse((await fse.readFile(testimCredentialsFile)).toString());
        } catch (err) {
            // just use new credentials.
        }
    }

    // YAML.parse can return `null` or `undefined` if we fail with an empty/malformed file.
    credentials = credentials || {};

    return credentials[property];
}

module.exports = {
    getProjectId,
    getToken,
    doLogin
}

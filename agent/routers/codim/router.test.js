"use strict";

const router = require('./router');

const path = require('path');
const os = require('os');
const compression = require('compression');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const Promise = require('bluebird');
const superagent = require('superagent');
const { expect } = require('chai');

const fs = Promise.promisifyAll(require('fs'));

app.use(bodyParser.urlencoded({extended: false, limit: '50mb'}));
app.use(compression());
app.use(bodyParser.json({limit: '50mb'}));

app.use('/files', router.router);

describe('codim router', () => {
    let listener;
    async function saveLocators(locatorsObject) {
        const request = superagent.post(`http://localhost:${listener.address().port}/files/locators`)
                  .send(locatorsObject);
        await Promise.fromCallback((callback) => request.end(callback));
    }

    async function loadLocators() {
        const request = superagent.get(`http://localhost:${listener.address().port}/files/locators`);
        return await Promise.fromCallback((callback) => request.end(callback)).then(x => x.text).then(JSON.parse);
    }

    let tmpDir;
    before((done) => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdk-test-'));
        process.chdir(tmpDir);
        listener = app.listen(0, done);
    });

    after(async () => {
        await fs.unlinkAsync(tmpDir).catch(() => {});
    });

    it('saves locators', async () => {
        await saveLocators({
            locators: [{ id: 'foo', name: 'foo', body: {internal: 'bar' }}],
            mergeIntoExisting: false
        });
        const locators = await loadLocators();
        expect(locators).to.deep.eq({
            "contents": {},
            "locators": {
              "foo": "foo"
            },
            "success": true
        });
    });

});

const { ArgError } = require('../errors');
const express = require('express');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const lazyRequire = require('../commons/lazyRequire');

const DEFUALT_PATH = path.join(os.tmpdir(), 'testim/rca/');

const stepFileMap = {};
const resultFileMap = {};

const TYPE_RENAMES = {
    'test-log': 'consoleLogs',
    'har-file': 'networkLogs',
};
const TYPES = Object.keys(TYPE_RENAMES);

function mapFilesToLocalDrive(test, logger) {
    try {
        test.failurePath = (test.failurePath || []).map(f => Object.assign(f, stepFileMap[f.id] ? { screenshot: stepFileMap[f.id] } : {}));
        Object.keys(resultFileMap).forEach(type => {
            test.assets = test.assets || {};
            test.assets[TYPE_RENAMES[type]] = resultFileMap[type];
        });

        test.assets = test.assets || {};
        test.assets.screenshots = Object.values(stepFileMap);
    } catch (err) {
        if (logger) {
            logger.error('failed to map files to local drive', { err });
        }
        // set default values.
        test.failurePath = test.failurePath || [];
        test.assets = test.assets || {};
        test.assets.screenshots = test.assets.screenshots || [];
    }
}

async function initServer({ agentPort, agentBind, saveRCALocally }) {
    const multer = await lazyRequire('multer');
    saveRCALocally = typeof saveRCALocally === 'string' ? saveRCALocally : DEFUALT_PATH;

    await fs.mkdirp(saveRCALocally);

    const upload = multer({
        storage: multer.diskStorage({
            async destination(req, file, cb) {
                const metadata = JSON.parse(req.body.metadata || '{}');
                if (!metadata.testResultId) {
                    return cb(new Error('missing testResultId'));
                }
                const destination = path.join(saveRCALocally, metadata.testResultId);
                try {
                    await fs.mkdirp(destination);
                } catch (err) {
                    return cb(err);
                }
                return cb(null, destination);
            },
            filename(req, file, cb) {
                const { fileName } = req.body;
                const metadata = JSON.parse(req.body.metadata || '{}');
                if (!metadata.stepId && !fileName) {
                    return cb(new Error('missing stepId or fileName'));
                }
                if (metadata.stepId) {
                    const format = path.extname(fileName);
                    return cb(null, `step_${metadata.stepId}_${metadata.stepName || ''}${format}`.replace(/[/\\?%*:|"<>\s]/g, '-'));
                }
                return cb(null, fileName);
            },
        }),
    });

    const app = express();

    app.post('/', upload.single('file'), (req, res) => {
        const metadata = JSON.parse(req.body.metadata || '{}');
        if (metadata.stepId) {
            stepFileMap[metadata.stepId] = req.file.path;
        }
        if (metadata.testResultId && TYPES.includes(metadata.subType)) {
            resultFileMap[metadata.subType] = resultFileMap[metadata.subType] || [];
            resultFileMap[metadata.subType].push(req.file.path);
        }
        res.sendStatus(200);
    });
    app.use((req, res) => res.status(404).send('Endpoint Not Found'));

    return await new Promise((resolve, reject) => {
        const http = require('http');
        const server = http.createServer(app);
        server.listen(agentPort, agentBind);
        server.on('error', onError);
        server.on('listening', () => resolve(server.address()));

        function onError(error) {
            if (error.syscall !== 'listen') {
                return reject(error);
            }

            // handle specific listen errors with friendly messages
            switch (error.code) {
                case 'EACCES':
                case 'EPERM':
                    return reject(new ArgError(`Port ${agentPort} requires elevated privileges`));
                case 'EADDRINUSE':
                    return reject(new ArgError(`Port ${agentPort} is already in use`));
                default:
                    return reject(error);
            }
        }
    });
}

module.exports = {
    initServer,
    mapFilesToLocalDrive,
};

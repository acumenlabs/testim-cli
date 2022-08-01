"use strict";

const { getPackageVersion } = require('../../../testimNpmDriver');
const { doLogin } = require('../../../credentialsManager');
const { getStartedWithStart } = require('../../../cliAgentMode');

module.exports = (app) => {
    /**
     * root endpoint
     */
    app.get('/', (req, res) => {

        const isStartMode = getStartedWithStart();

        return res.status(200).json({success: true, isTestimAgent: true, startMode: isStartMode});

    });

    /**
     * Get version route
     */
    app.get('/version', (req, res) => {
        res.status(200).json({
            node: process.version,
            app: getPackageVersion()
        });
    });

    app.get('/loginInfo', (req, res) => {
        try {
            const projects = JSON.parse(Buffer.from(req.query.info, 'base64').toString());
            doLogin({overwriteExisting: false, projects });
            res.status(200).end();
        } catch (err) {
            res.status(400).end();
        }
    });

    
};

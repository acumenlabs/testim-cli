"use strict";

const router = require('./router');
const service = require('./service');
const logger = require('../../../commons/logger').getLogger("cli-service");

// clean local
service.cleanLocalPackageInstallFolder()
    .catch(err => logger.warn("failed to clean local package folder", {err}));

module.exports = {
    router: router
};

'use strict';

const winston = require('winston');
const os = require('os');

const hostname = os.hostname();
const runnerVersion = getRunnerVersion();
const config = require('./config');

const isLocal = 'false';


const loggerConfig = {
    privateKey: 'd0eb01da-f966-1663-63c6-8871225d7c39',
    applicationName: 'testim',
    subsystemName: 'runner',
};

function getRunnerVersion() {
    try {
        const pack = require(`${__dirname}/../package.json`);
        return pack.version;
    } catch (err) {
        return '';
    }
}

function getStreamsAndWaitForFlushPromise() {
    const transports = [];

    let waitForFlush = () => Promise.resolve();

    if (!config.IS_ON_PREM) {
        const { CoralogixTransport } = require('../lib/coralogix-winston.transport');

        CoralogixTransport.configure(loggerConfig);
        const loggerInstance = new CoralogixTransport({
            category: 'ROOT',
        });
        transports.push(loggerInstance);

        waitForFlush = () => loggerInstance.waitForFlush();
    }

    if (config.LOGGER_CONSOLE) {
        transports.push(new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
        }));
    }
    return [transports, waitForFlush];
}

const [transports, waitForFlush] = getStreamsAndWaitForFlushPromise();
const level = config.LOGGER_DEBUG ? 'debug' : 'info';
const defaultMeta = {};
if (isLocal.indexOf('@echo') === -1) {
    Object.assign(defaultMeta, devFlags());

} else {
    Object.assign(defaultMeta, localFlags());
}

const winstonMainLogger = winston.createLogger({
    levels: winston.config.syslog.levels,
    level,
    transports,
    defaultMeta: { name: 'runner', hostname, nodeVersion: process.version, runnerVersion, ...defaultMeta },
});

let executionId = null;
let projectId = null;

function setExecutionId(execId) {
    executionId = execId;
}

function setProjectId(projId) {
    projectId = projId;
}

function setProxyUri(proxyUri) {
    if (config.IS_ON_PREM || !proxyUri) {
        return;
    }
    const { CoralogixTransport } = require('../lib/coralogix-winston.transport');
    CoralogixTransport.configure({ ...loggerConfig, proxyUri });
}

function releaseFlags() {
    return {
        release: true,
        branch: 'production',
    };
}

function devFlags() {
    return {
        release: false,
        branch: 'test',
    };
}

function localFlags() {
    return {
        release: false,
        branch: 'local',
    };
}

function addExecutionMetadata(dataExecutionId) {
    const logData = {};
    if (executionId && !dataExecutionId) {
        logData.executionId = executionId;
    }

    logData.projectId = projectId;
    logData.time = (new Date()).toISOString();

    return logData;
}

class Logger {
    constructor(logger) {
        this._logger = logger;
        this.debug = this.debug.bind(this);
        this.info = this.info.bind(this);
        this.warn = this.warn.bind(this);
        this.error = this.error.bind(this);
        this.fatal = this.fatal.bind(this);
    }

    debug(msg, data = {}) {
        this.innerLog('debug', msg, data);
    }

    info(msg, data = {}) {
        this.innerLog('info', msg, data);
    }

    warn(msg, data = {}) {
        this.innerLog('warning', msg, data);
    }

    error(msg, data = {}) {
        this.innerLog('error', msg, data);
    }

    fatal(msg, data = {}) {
        this.innerLog('crit', msg, data);
    }

    innerLog(level, msg, data = {}) {
        try {
            this._logger.log(level, Object.assign({ meta: data }, { message: msg }, addExecutionMetadata(data.executionId)));
        } catch (err) {
            try {
                this._logger.log('crit', Object.assign({ message: `failed to log message ${err.message}, ${err.stack}` }, addExecutionMetadata(data.executionId)));
            } catch (err) {
                // well what can we do
            }
        }
    }

    waitForFlush() {
        return waitForFlush();
    }
}

function getLogger(loggerName) {
    return new Logger(winstonMainLogger.child({ category: loggerName }));
}

module.exports = {
    getLogger,
    setExecutionId,
    setProjectId,
    setProxyUri,
};

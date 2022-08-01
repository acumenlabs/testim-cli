const { Log, Severity, CoralogixLogger } = require('@testim/coralogix-logger');
const TransportStream = require('winston-transport');

const severityMap = {
    silly: Severity.verbose,
    verbose: Severity.verbose,
    info: Severity.info,
    http: Severity.info,
    warn: Severity.warning,
    warning: Severity.warning,
    error: Severity.error,
    silent: Severity.verbose,
    critical: Severity.critical,
    crit: Severity.critical,
    debug: Severity.debug,
};

const errorProps = ['err', 'error', 'reason', 'e'];

class CoralogixTransport extends TransportStream {
    constructor(options) {
        options = Object.assign({}, CoralogixTransport.options, options);
        super(options);
        this.options = options;
        this.logger = new CoralogixLogger(options.category);
        this.name = 'Coralogix Transport';
        if (options.timestamp) {
            this.timestamp = options.timestamp;
        }
    }

    log(info, callback) {
        const { category, level, message: msg, meta: infoMeta = {}, ...restMeta } = info;
        const meta = Object.assign({}, infoMeta, this.options.extraFields, restMeta);
        const log = new Log();

        log.severity = severityMap[level];
        log.text = msg;
        log.category = category;
        if (meta.className) {
            log.className = meta.className;
        }
        if (meta.methodName) {
            log.methodName = meta.methodName;
        }
        if (meta.threadId) {
            log.threadId = meta.threadId;
        }
        delete meta.className;
        delete meta.methodName;
        delete meta.threadId;
        delete meta.category;
        delete meta.level;
        delete meta.message;
        let errorOverride = false;
        if (infoMeta instanceof Error) {
            errorOverride = true;
            meta.msg = infoMeta.message + infoMeta.stack;
            if (msg) {
                meta.msg = `${msg}\n${meta.msg}`;
            }
        }

        for (const prop of errorProps) {
            if (infoMeta[prop] instanceof Error) {
                meta[prop] = {
                    message: infoMeta[prop].message,
                    stack: infoMeta[prop].stack,
                    name: infoMeta[prop].name,
                    type: infoMeta[prop].type,
                    cause: infoMeta[prop].cause,
                    ...infoMeta[prop],
                };
            }
        }

        // still have keys after deleting the above
        if (Object.keys(meta).length > 0) {
            if (msg && !errorOverride) {
                meta.msg = msg;
            }
            log.text = meta;
        }

        this.logger.addLog(log);
        callback(null, true);
    }

    waitForFlush() {
        return this.logger.waitForFlush();
    }

    static configure(config) {
        CoralogixLogger.configure(config);
        CoralogixTransport.options = config;
    }
}

module.exports.CoralogixTransport = CoralogixTransport;

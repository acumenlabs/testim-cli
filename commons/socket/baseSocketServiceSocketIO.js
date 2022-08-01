"use strict";

const Promise = require('bluebird');
const pRetry = require('p-retry');
const io = require('socket.io-client');
const config = require('../config');

const MAX_SOCKET_RECONNECT_ATTEMPT = 50;
const MAX_RECONNECT_ATTEMPT_BEFORE_SWITCH = 10;
const EMIT_PROMISE_TIMEOUT = 5000;
const POLLING_TRANSPORT_TIMEOUT_MS = 10 * 1000;

const logger = require('../logger').getLogger("base socket service");

class BaseSocketServiceSocketIO {

    constructor() {
        this.attempts = 0;
        this.rooms = {};
        this.emitPromisQueue = undefined;
    }

    joinToMultipleResults() {
        const testResultIds = Object.keys(this.rooms);
        logger.info("re-join all existing rooms", {testResultIds});
        testResultIds.map(resultId => {
            const testId = this.rooms[resultId];
            this.emitJoinRoom && this.emitJoinRoom(resultId, testId);
        });
    }

    joinRoom(resultId, testId) {
        this.rooms[resultId] = testId;
    }

    leaveRoom(resultId) {
        delete this.rooms[resultId];
    }

    addSocketHandlers() {
        const socketError = (method, err) => {
            let transport = 'websocket';
            try {
                transport = this._socket.io.engine.transport.name;
            } catch (e) {
            }
            logger.error(`Error in SocketService websocket _${method}_ socket ${this._socket.id} is ${this.url} over ${transport}. Reconnect attempts ${this.attempts}. Error is: ${err && err.message}`);
        };

        this._socket.on('reconnect_attempt', (attempt) => {
            socketError('reconnect_attempt', {message: 'reconnect attempt', attempt});
            this.attempts++;
            if (this.attempts === MAX_RECONNECT_ATTEMPT_BEFORE_SWITCH && !this.isAllowedWS) {
                this._socket.io.opts.transports = ['polling'];
                this._socket.io.opts.upgrade = false;
            }
            if (this.attempts >= MAX_SOCKET_RECONNECT_ATTEMPT) {
                throw new Error("Can't connect to Testim Servers.\n" +
                    "Action required: Please allow opening a websockets connection to " + config.SERVICES_HOST + " in your firewall/proxy");
            }
        });

        this._socket.on('connect_error', (err) => {
            socketError('connect_error', err);
        });

        this._socket.on('connect_timeout', (err) => {
            socketError('connect_timeout', err);
        });

        this._socket.on('error', err => {
            socketError('error', err);
        });

        this._socket.on('reconnect_error', err => {
            if (this.prevErr && this.prevErr.type === err.type) {
                return;
            }
            this.prevErr = err;
            socketError('reconnect_error', err);
        });

        this._socket.on('reconnect', () => {
            logger.info(`reconnect to socket and re-join to rooms`);
            this.joinToMultipleResults();
        });

        this._socket.on('connect', () => {
            this.attempts = 0;
            if(this.isAllowedWS === undefined) {
                this.isAllowedWS = this._socket.io.engine.transport && this._socket.io.engine.transport.name === "websocket";
            }
            if (this.onConnect) {
                this.onConnect();
            }
        });
    }

    initNewSocket(projectId, ns) {
        const opts = {
            query: {'projectId': projectId},
            requestTimeout: POLLING_TRANSPORT_TIMEOUT_MS,
            transports: ['websocket'],
            upgrade: false,
            forceNew: true,
            rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
        };

        if (global.caFileContent) {
            opts.ca = global.caFileContent;
        }

        if (global.proxyUri) {
            opts.agent = new global.ProxyAgent(global.proxyUri);
        }

        return new Promise(resolve => {
            this.url = `${config.SERVICES_HOST}/${ns}`;
            this._socket = io.connect(this.url, opts);
            this.addSocketHandlers();
            this._socket.on('connect', resolve);
            this._socket.open();
        });
    }

    init(projectId, ns) {
        const opts = {
            query: {'projectId': projectId},
            requestTimeout: POLLING_TRANSPORT_TIMEOUT_MS,
            transports: ['websocket'],
            upgrade: false,
            rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
        };

        if (global.caFileContent) {
            opts.ca = global.caFileContent;
        }

        if(global.proxyUri) {
            opts.agent = new global.ProxyAgent(global.proxyUri);
        }

        this.url = `${config.SERVICES_HOST}/${ns}`;
        this._socket = io.connect(this.url, opts);
        this.addSocketHandlers();
    }

    emitPromise(eventName, eventData) {
        let errorneousEvents = {};

        const emitAndWait = () => {
            return new Promise((resolve, reject) => {
                this._socket.emit(eventName, eventData, data => {
                    if (data && data.success) {
                        return resolve();
                    } else {
                        errorneousEvents[eventName] = eventData;

                        return reject(new Error("bad ack"));
                    }
                });
            }).timeout(EMIT_PROMISE_TIMEOUT);
        };

        this.emitPromisQueue = (this.emitPromisQueue || Promise.resolve())
            .then(() => pRetry(emitAndWait, { retries: 200, minTimeout: 3000 }))
            .finally(() => {
                if (Object.keys(errorneousEvents).length > 0) {
                    logger.error('Bad acknowledge from socket emit', { errorneousEvents });
                }
            });

        return this.emitPromisQueue;
    }
}

module.exports = BaseSocketServiceSocketIO;

"use strict";

const WebSocket = require('ws');
const {WEBSOCKET_HOST} = require('../config');
const utils = require('../../utils');
const logger = require('../logger').getLogger("socket-ng-service");
const {EventEmitter} = require('events');
const _ = require('lodash');
const Promise = require('bluebird');
const testimCustomToken = require('../testimCustomToken');

const WAIT_BETWEEN_RECONNECT_MS = 5000;

class SocketService extends EventEmitter {
    constructor() {
        super();
        this.clientId = utils.guid();
        this.ws = null;
        this.filterMap = {};
        this.listeners = {};
    }

    onReconnect(projectId) {
        logger.info(`test result websocket re-connect`);
        setTimeout(() => this.connect(projectId), WAIT_BETWEEN_RECONNECT_MS);
    }

    formatUrl(url) {
        if(_.startsWith(url, "http://")) {
            return _.replace(url, 'http://', 'ws://');
        }

        if(_.startsWith(url, "https://")) {
            return _.replace(url, 'https://', 'wss://');
        }

        return url;
    }

    parseEvent(event) {
        try {
            return JSON.parse(event);
        } catch (err) {
            logger.error(`failed to parse or trigger event`, {err});
        }
    }


    connect(projectId) {
        const wsBaseUrl = this.formatUrl(WEBSOCKET_HOST);
        return testimCustomToken.getCustomTokenV3()
            .then(token => {
                return new Promise((resolve) => {
                    const options = {};
                    if(global.proxyUri) {
                        options.agent = new global.ProxyAgent(global.proxyUri);
                    }
                    this.ws = new WebSocket(`${wsBaseUrl}?projectId=${projectId}&clientId=${this.clientId}&token=${token}`, options);

                    this.ws.on("open", () => {
                        logger.info(`websocket opened`);
                        this.reSendAllExistingFilters();
                        if (this.onConnect) {
                            this.onConnect();
                        }
                        return resolve();
                    });

                    this.ws.on("close", (event) => {
                        logger.info(`websocket closed`, {event});
                        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
                            this.onReconnect(projectId, token, wsBaseUrl);
                        }
                    });

                    this.ws.on("error", (event) => {
                        logger.info(`websocket error`, {event});
                    });

                    this.ws.on("message", (event) => {
                        const evObject = this.parseEvent(event);
                        if (evObject && evObject.type) {
                            this.emit(evObject.type, evObject.data);
                        }
                    });
                });
            });
    }

    // this is private because our sockets are supposed to be read-only to
    // external consumers and writes need to happen through the REST API
    // this is important since recovery of messages is the case of reconnects is
    // done in the code calling sendMessage and not in sendMessage itself
    sendMessage(msg) {
        if (!this.ws) {
            logger.warn('tried to send error when websocket was disconnected');
            return;
        }
        try {
            this.ws.send(JSON.stringify(msg));
        } catch (err) {
            logger.error('failed to stringify message for sending', {err});
        }
    }

    listenOnce(eventName, eventMatcher, listener) {
        const onEvent = (data) => {
            if (eventMatcher(data)) {
                listener(data);
                this.removeListener(eventName, onEvent);
            }
        };

        this.on(eventName, onEvent);
    }

    listenTo(key, eventName, eventMatcher, listener) {
        //TODO - Consider doing key:value event name subscriptions here, routing inside the .on('message' into an event name based on the key and removing the listeners array.
        function fireIfSameMatchEventMatcher(data) {
            if (eventMatcher(data)) {
                listener(data);
            }
        }

        const eventNameArray = Array.isArray(eventName) ? eventName : [eventName];
        eventNameArray.forEach(name => {
            this.listeners[`${key}:${name}`] = this.listeners[`${key}:${name}`] || [];
            const listener = fireIfSameMatchEventMatcher.bind(this);
            this.listeners[`${key}:${name}`].push(listener);
            this.on(name, listener);
        });
    }

    reSendAllExistingFilters() {
        Object.keys(this.filterMap).forEach(key => {
            const filter = this.filterMap[key];
            this.sendMessage({type: "add-filter", filter});
        });
    }

    addFilter(key, query, type, returnFullDocument = false) {
        return new Promise(resolve => {
            const filterId = utils.guid();
            const filter = {query, id: filterId, type, fullDocument: returnFullDocument};
            this.listenOnce("add-filter:done", data => data.id === filterId, resolve);
            this.sendMessage({type: "add-filter", filter});
            this.filterMap[key] = filter;
        });
    }

    removeListeners(key, typeArray) {
        if (Object.keys(this.listeners).length === 0) {
            return;
        }
        typeArray.forEach(name => {
            const listeners = this.listeners[`${key}:${name}`];
            if (listeners) {
                delete this.listeners[`${key}:${name}`];
                listeners.forEach(listener => this.removeListener(name, listener));
            }
        });
    }

    removeFilter(key, type) {
        const filter = this.filterMap[key];
        if (!filter) {
            return;
        }

        const typeArray = Array.isArray(type) ? type : [type];
        this.removeListeners(key, typeArray);
        delete this.filterMap[key];
        this.sendMessage({type: "remove-filter", filter});
    }
}

module.exports = new SocketService();

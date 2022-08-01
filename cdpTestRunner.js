const WebSocket = require('ws');
const Promise = require('bluebird');


class CDPTestRunner {
    constructor() {
        this._cdpUrl = null;
        this._cdpCallbacks = new Map();
    }

    async initSession(cdpUrl, timeout = 500) {
        await this.stopSession();
        this._cdpUrl = cdpUrl;
        await this.initCDPWebsocket(timeout);
    }

    async initCDPWebsocket(timeout = 500) {
        if (this._cdpWs) {
            return this._cdpWs;
        }
        const websocket = new WebSocket(this._cdpUrl, { timeout });

        const openPromise = Promise.fromCallback((cb) => {
            websocket.once('open', cb);
        });

        const errorPromise = Promise.fromCallback((cb) => {
            websocket.once('error', cb);
        }).catch(() => {
            websocket.close();
            websocket.removeAllListeners();
        });

        websocket.on('message', (message) => this.onCDPMessage(message));

        this._cdpWs = Promise.race([openPromise, errorPromise]).then(() => websocket);
        return this._cdpWs;
    }

    onCDPMessage(message) {
        const object = JSON.parse(message);
        const callback = this._cdpCallbacks.get(object.id);
        if (!callback) {
            return;
        }
        this._cdpCallbacks.delete(object.id);
        if (object.error) {
            callback.reject(new Error(object.error));
        } else if (object.result.exceptionDetails && object.result.exceptionDetails.exception) {
            callback.reject(new Error(object.result.exceptionDetails.exception.description));
        } else {
            callback.resolve(object.result);
        }
    }

    async stopSession() {
        const websocket = this._cdpWs;
        this._cdpUrl = null;
        this._cdpWs = null;
        this._cdpCallbacks.clear();
        if (websocket) {
            try {
                return await websocket.close();
            } catch (e) {
                return undefined;
            }
        }
        return undefined;
    }

    async cdpCommand(method, params, sessionId) {
        const websocket = await this.initCDPWebsocket();
        this._lastWsId = this._lastWsId || 0;
        const id = this._lastWsId++;
        const result = new Promise((resolve, reject) => {
            this._cdpCallbacks.set(id, { resolve, reject });
        });
        const msg = { method, params, id };
        if (sessionId) {
            Object.assign(msg, { sessionId });
        }
        websocket.send(JSON.stringify(msg));
        return result;
    }
}

module.exports = CDPTestRunner;

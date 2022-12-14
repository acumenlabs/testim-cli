var FormData = require('form-data');

(function () {
    var InvalidStateError, NetworkError, ProgressEvent, SecurityError, SyntaxError, XMLHttpRequest, XMLHttpRequestEventTarget, XMLHttpRequestUpload, http, https, os, url,
        extend = function (child, parent) {
            for (var key in parent) {
                if (hasProp.call(parent, key)) {
                    child[key] = parent[key];
                }
            }
            function ctor() {
                this.constructor = child;
            }

            ctor.prototype = parent.prototype;
            child.prototype = new ctor();
            child.__super__ = parent.prototype;
            return child;
        },
        hasProp = {}.hasOwnProperty;

    XMLHttpRequestEventTarget = (function () {
        function XMLHttpRequestEventTarget() {
            this.onloadstart = null;
            this.onprogress = null;
            this.onabort = null;
            this.onerror = null;
            this.onload = null;
            this.ontimeout = null;
            this.onloadend = null;
            this._listeners = {};
        }

        XMLHttpRequestEventTarget.prototype.onloadstart = null;

        XMLHttpRequestEventTarget.prototype.onprogress = null;

        XMLHttpRequestEventTarget.prototype.onabort = null;

        XMLHttpRequestEventTarget.prototype.onerror = null;

        XMLHttpRequestEventTarget.prototype.onload = null;

        XMLHttpRequestEventTarget.prototype.ontimeout = null;

        XMLHttpRequestEventTarget.prototype.onloadend = null;

        XMLHttpRequestEventTarget.prototype.addEventListener = function (eventType, listener) {
            var base;
            eventType = eventType.toLowerCase();
            (base = this._listeners)[eventType] || (base[eventType] = []);
            this._listeners[eventType].push(listener);
            return void 0;
        };

        XMLHttpRequestEventTarget.prototype.removeEventListener = function (eventType, listener) {
            var index;
            eventType = eventType.toLowerCase();
            if (this._listeners[eventType]) {
                index = this._listeners[eventType].indexOf(listener);
                if (index !== -1) {
                    this._listeners[eventType].splice(index, 1);
                }
            }
            return void 0;
        };

        XMLHttpRequestEventTarget.prototype.dispatchEvent = function (event) {
            var eventType, j, len, listener, listeners;
            event.currentTarget = event.target = this;
            eventType = event.type;
            if (listeners = this._listeners[eventType]) {
                for (j = 0, len = listeners.length; j < len; j++) {
                    listener = listeners[j];
                    listener.call(this, event);
                }
            }
            if (listener = this["on" + eventType]) {
                listener.call(this, event);
            }
            return void 0;
        };

        return XMLHttpRequestEventTarget;

    })();

    http = require('http');

    https = require('https');

    os = require('os');

    url = require('url');

    XMLHttpRequest = (function (superClass) {
        extend(XMLHttpRequest, superClass);

        function XMLHttpRequest(options) {
            XMLHttpRequest.__super__.constructor.call(this);
            this.onreadystatechange = null;
            this._anonymous = options && options.anon;
            this.readyState = XMLHttpRequest.UNSENT;
            this.response = null;
            this.responseText = '';
            this.responseType = '';
            this.status = 0;
            this.statusText = '';
            this.timeout = 0;
            this.upload = new XMLHttpRequestUpload(this);
            this._method = null;
            this._url = null;
            this._sync = false;
            this._headers = null;
            this._loweredHeaders = null;
            this._mimeOverride = null;
            this._request = null;
            this._response = null;
            this._responseParts = null;
            this._responseHeaders = null;
            this._aborting = null;
            this._error = null;
            this._loadedBytes = 0;
            this._totalBytes = 0;
            this._lengthComputable = false;
        }

        XMLHttpRequest.prototype.onreadystatechange = null;

        XMLHttpRequest.prototype.readyState = null;

        XMLHttpRequest.prototype.response = null;

        XMLHttpRequest.prototype.responseText = null;

        XMLHttpRequest.prototype.responseType = null;

        XMLHttpRequest.prototype.status = null;

        XMLHttpRequest.prototype.timeout = null;

        XMLHttpRequest.prototype.upload = null;

        XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
            var xhrUrl;
            method = method.toUpperCase();
            if (method in this._restrictedMethods) {
                throw new SecurityError("HTTP method " + method + " is not allowed in XHR");
            }
            xhrUrl = this._parseUrl(url);
            if (async === void 0) {
                async = true;
            }
            switch (this.readyState) {
                case XMLHttpRequest.UNSENT:
                case XMLHttpRequest.OPENED:
                case XMLHttpRequest.DONE:
                    null;
                    break;
                case XMLHttpRequest.HEADERS_RECEIVED:
                case XMLHttpRequest.LOADING:
                    null;
            }
            this._method = method;
            this._url = xhrUrl;
            this._sync = !async;
            this._headers = {};
            this._loweredHeaders = {};
            this._mimeOverride = null;
            this._setReadyState(XMLHttpRequest.OPENED);
            this._request = null;
            this._response = null;
            this.status = 0;
            this.statusText = '';
            this._responseParts = [];
            this._responseHeaders = null;
            this._loadedBytes = 0;
            this._totalBytes = 0;
            this._lengthComputable = false;
            return void 0;
        };

        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
            var loweredName;
            if (this.readyState !== XMLHttpRequest.OPENED) {
                throw new InvalidStateError("XHR readyState must be OPENED");
            }
            loweredName = name.toLowerCase();
            if (this._restrictedHeaders[loweredName] || /^sec\-/.test(loweredName) || /^proxy-/.test(loweredName)) {
                return void 0;
            }
            value = value.toString();
            if (loweredName in this._loweredHeaders) {
                name = this._loweredHeaders[loweredName];
                this._headers[name] = this._headers[name] + ', ' + value;
            } else {
                this._loweredHeaders[loweredName] = name;
                this._headers[name] = value;
            }
            return void 0;
        };

        XMLHttpRequest.prototype.send = function (data) {
            if (this.readyState !== XMLHttpRequest.OPENED) {
                throw new InvalidStateError("XHR readyState must be OPENED");
            }
            if (this._request) {
                throw new InvalidStateError("send() already called");
            }
            switch (this._url.protocol) {
                case 'file:':
                    this._sendFile(data);
                    break;
                case 'http:':
                case 'https:':
                    this._sendHttp(data);
                    break;
                default:
                    throw new NetworkError("Unsupported protocol " + this._url.protocol);
            }
            return void 0;
        };

        XMLHttpRequest.prototype.abort = function () {
            if (!this._request) {
                return;
            }
            this._request.abort();
            this._setError();
            this._dispatchProgress('abort');
            this._dispatchProgress('loadend');
            return void 0;
        };

        XMLHttpRequest.prototype.getResponseHeader = function (name) {
            var loweredName;
            if (!this._responseHeaders) {
                return null;
            }
            loweredName = name.toLowerCase();
            if (loweredName in this._responseHeaders) {
                return this._responseHeaders[loweredName];
            } else {
                return null;
            }
        };

        XMLHttpRequest.prototype.getAllResponseHeaders = function () {
            var lines, name, value;
            if (!this._responseHeaders) {
                return '';
            }
            lines = (function () {
                var ref, results;
                ref = this._responseHeaders;
                results = [];
                for (name in ref) {
                    value = ref[name];
                    results.push(name + ": " + value);
                }
                return results;
            }).call(this);
            return lines.join("\r\n");
        };

        XMLHttpRequest.prototype.overrideMimeType = function (newMimeType) {
            if (this.readyState === XMLHttpRequest.LOADING || this.readyState === XMLHttpRequest.DONE) {
                throw new InvalidStateError("overrideMimeType() not allowed in LOADING or DONE");
            }
            this._mimeOverride = newMimeType.toLowerCase();
            return void 0;
        };

        XMLHttpRequest.prototype.nodejsSet = function (options) {
            var baseUrl, parsedUrl;
            if ('httpAgent' in options) {
                this.nodejsHttpAgent = options.httpAgent;
            }
            if ('httpsAgent' in options) {
                this.nodejsHttpsAgent = options.httpsAgent;
            }
            if ('baseUrl' in options) {
                baseUrl = options.baseUrl;
                if (baseUrl !== null) {
                    parsedUrl = url.parse(baseUrl, false, true);
                    if (!parsedUrl.protocol) {
                        throw new SyntaxError("baseUrl must be an absolute URL");
                    }
                }
                this.nodejsBaseUrl = baseUrl;
            }
            return void 0;
        };

        XMLHttpRequest.nodejsSet = function (options) {
            XMLHttpRequest.prototype.nodejsSet(options);
            return void 0;
        };

        XMLHttpRequest.prototype.UNSENT = 0;

        XMLHttpRequest.UNSENT = 0;

        XMLHttpRequest.prototype.OPENED = 1;

        XMLHttpRequest.OPENED = 1;

        XMLHttpRequest.prototype.HEADERS_RECEIVED = 2;

        XMLHttpRequest.HEADERS_RECEIVED = 2;

        XMLHttpRequest.prototype.LOADING = 3;

        XMLHttpRequest.LOADING = 3;

        XMLHttpRequest.prototype.DONE = 4;

        XMLHttpRequest.DONE = 4;

        XMLHttpRequest.prototype.nodejsHttpAgent = http.globalAgent;

        XMLHttpRequest.prototype.nodejsHttpsAgent = https.globalAgent;

        XMLHttpRequest.prototype.nodejsBaseUrl = null;

        XMLHttpRequest.prototype._restrictedMethods = {
            CONNECT: true,
            TRACE: true,
            TRACK: true
        };

        XMLHttpRequest.prototype._restrictedHeaders = {
            'accept-charset': true,
            'accept-encoding': true,
            'access-control-request-headers': true,
            'access-control-request-method': true,
            connection: true,
            'content-length': true,
            cookie: true,
            cookie2: true,
            date: true,
            dnt: true,
            expect: true,
            host: true,
            'keep-alive': true,
            origin: true,
            referer: true,
            te: true,
            trailer: true,
            'transfer-encoding': true,
            upgrade: true,
            'user-agent': true,
            via: true
        };

        XMLHttpRequest.prototype._privateHeaders = {
            'set-cookie': false,
            'set-cookie2': false
        };

        XMLHttpRequest.prototype._userAgent = ("Mozilla/5.0 (" + (os.type()) + " " + (os.arch()) + ") ") + ("node.js/" + process.versions.node + " v8/" + process.versions.v8);

        XMLHttpRequest.prototype._setReadyState = function (newReadyState) {
            var event;
            this.readyState = newReadyState;
            event = new ProgressEvent('readystatechange');
            this.dispatchEvent(event);
            return void 0;
        };

        XMLHttpRequest.prototype._sendFile = function () {
            if (this._url.method !== 'GET') {
                throw new NetworkError('The file protocol only supports GET');
            }
            throw new Error("Protocol file: not implemented");
        };

        XMLHttpRequest.prototype._sendHttp = function (data) {
            if (this._sync) {
                throw new Error("Synchronous XHR processing not implemented");
            }
            if ((data != null) && (this._method === 'GET' || this._method === 'HEAD')) {
                data = null;
            } else {
                data || (data = '');
            }
            this.upload._setData(data);
            this._finalizeHeaders(data);
            this._sendHxxpRequest(data);
            return void 0;
        };

        XMLHttpRequest.prototype._sendHxxpRequest = function (data) {
            var agent, hxxp, request;
            if (this._url.protocol === 'http:') {
                hxxp = http;
                agent = this.nodejsHttpAgent;
            } else {
                hxxp = https;
                agent = this.nodejsHttpsAgent;
            }
            request = hxxp.request({
                hostname: this._url.hostname,
                port: this._url.port,
                path: this._url.path,
                auth: this._url.auth,
                method: this._method,
                headers: this._headers,
                agent: agent
            });

            if (typeof data === 'object' && data instanceof FormData) {
                data.pipe(request);
            }

            this._request = request;
            if (this.timeout) {
                request.setTimeout(this.timeout, (function (_this) {
                    return function () {
                        return _this._onHttpTimeout(request);
                    };
                })(this));
            }
            request.on('response', (function (_this) {
                return function (response) {
                    return _this._onHttpResponse(request, response);
                };
            })(this));
            request.on('error', (function (_this) {
                return function (error) {
                    return _this._onHttpRequestError(request, error);
                };
            })(this));
            this.upload._startUpload(request);
            if (this._request === request) {
                this._dispatchProgress('loadstart');
            }
            return void 0;
        };

        XMLHttpRequest.prototype._finalizeHeaders = function (data) {
            if (typeof data === 'object' && data instanceof FormData) {
                Object.assign(this._headers, data.getHeaders());
            }
            this._headers['Connection'] = 'keep-alive';
            this._headers['Host'] = this._url.host;
            if (this._anonymous) {
                this._headers['Referer'] = 'about:blank';
            }
            this._headers['User-Agent'] = this._userAgent;
            this.upload._finalizeHeaders(this._headers, this._loweredHeaders);
            return void 0;
        };

        XMLHttpRequest.prototype._onHttpResponse = function (request, response) {
            var lengthString;
            if (this._request !== request) {
                return;
            }
            switch (response.statusCode) {
                case 301:
                case 302:
                case 303:
                case 307:
                case 308:
                    this._url = this._parseUrl(response.headers['location']);
                    this._method = 'GET';
                    if ('content-type' in this._loweredHeaders) {
                        delete this._headers[this._loweredHeaders['content-type']];
                        delete this._loweredHeaders['content-type'];
                    }
                    if ('Content-Type' in this._headers) {
                        delete this._headers['Content-Type'];
                    }
                    delete this._headers['Content-Length'];
                    this.upload._reset();
                    this._finalizeHeaders();
                    this._sendHxxpRequest();
                    return;
            }
            this._response = response;
            this._response.on('data', (function (_this) {
                return function (data) {
                    return _this._onHttpResponseData(response, data);
                };
            })(this));
            this._response.on('end', (function (_this) {
                return function () {
                    return _this._onHttpResponseEnd(response);
                };
            })(this));
            this._response.on('close', (function (_this) {
                return function () {
                    return _this._onHttpResponseClose(response);
                };
            })(this));
            this.status = this._response.statusCode;
            this.statusText = http.STATUS_CODES[this.status];
            this._parseResponseHeaders(response);
            if (lengthString = this._responseHeaders['content-length']) {
                this._totalBytes = parseInt(lengthString);
                this._lengthComputable = true;
            } else {
                this._lengthComputable = false;
            }
            return this._setReadyState(XMLHttpRequest.HEADERS_RECEIVED);
        };

        XMLHttpRequest.prototype._onHttpResponseData = function (response, data) {
            if (this._response !== response) {
                return;
            }
            this._responseParts.push(data);
            this._loadedBytes += data.length;
            if (this.readyState !== XMLHttpRequest.LOADING) {
                this._setReadyState(XMLHttpRequest.LOADING);
            }
            return this._dispatchProgress('progress');
        };

        XMLHttpRequest.prototype._onHttpResponseEnd = function (response) {
            if (this._response !== response) {
                return;
            }
            this._parseResponse();
            this._request = null;
            this._response = null;
            this._setReadyState(XMLHttpRequest.DONE);
            this._dispatchProgress('load');
            return this._dispatchProgress('loadend');
        };

        XMLHttpRequest.prototype._onHttpResponseClose = function (response) {
            var request;
            if (this._response !== response) {
                return;
            }
            request = this._request;
            this._setError();
            request.abort();
            this._setReadyState(XMLHttpRequest.DONE);
            this._dispatchProgress('error');
            return this._dispatchProgress('loadend');
        };

        XMLHttpRequest.prototype._onHttpTimeout = function (request) {
            if (this._request !== request) {
                return;
            }
            this._setError();
            request.abort();
            this._setReadyState(XMLHttpRequest.DONE);
            this._dispatchProgress('timeout');
            return this._dispatchProgress('loadend');
        };

        XMLHttpRequest.prototype._onHttpRequestError = function (request, error) {
            if (this._request !== request) {
                return;
            }
            this._setError();
            request.abort();
            this._setReadyState(XMLHttpRequest.DONE);
            this._dispatchProgress('error');
            return this._dispatchProgress('loadend');
        };

        XMLHttpRequest.prototype._dispatchProgress = function (eventType) {
            var event;
            event = new ProgressEvent(eventType);
            event.lengthComputable = this._lengthComputable;
            event.loaded = this._loadedBytes;
            event.total = this._totalBytes;
            this.dispatchEvent(event);
            return void 0;
        };

        XMLHttpRequest.prototype._setError = function () {
            this._request = null;
            this._response = null;
            this._responseHeaders = null;
            this._responseParts = null;
            return void 0;
        };

        XMLHttpRequest.prototype._parseUrl = function (urlString) {
            var absoluteUrlString, index, password, user, xhrUrl;
            if (this.nodejsBaseUrl === null) {
                absoluteUrlString = urlString;
            } else {
                absoluteUrlString = url.resolve(this.nodejsBaseUrl, urlString);
            }
            xhrUrl = url.parse(absoluteUrlString, false, true);
            xhrUrl.hash = null;
            if (xhrUrl.auth && ((typeof user !== "undefined" && user !== null) || (typeof password !== "undefined" && password !== null))) {
                index = xhrUrl.auth.indexOf(':');
                if (index === -1) {
                    if (!user) {
                        user = xhrUrl.auth;
                    }
                } else {
                    if (!user) {
                        user = xhrUrl.substring(0, index);
                    }
                    if (!password) {
                        password = xhrUrl.substring(index + 1);
                    }
                }
            }
            if (user || password) {
                xhrUrl.auth = user + ":" + password;
            }
            return xhrUrl;
        };

        XMLHttpRequest.prototype._parseResponseHeaders = function (response) {
            var loweredName, name, ref, value;
            this._responseHeaders = {};
            ref = response.headers;
            for (name in ref) {
                value = ref[name];
                loweredName = name.toLowerCase();
                if (this._privateHeaders[loweredName]) {
                    continue;
                }
                if (this._mimeOverride !== null && loweredName === 'content-type') {
                    value = this._mimeOverride;
                }
                this._responseHeaders[loweredName] = value;
            }
            if (this._mimeOverride !== null && !('content-type' in this._responseHeaders)) {
                this._responseHeaders['content-type'] = this._mimeOverride;
            }
            return void 0;
        };

        XMLHttpRequest.prototype._parseResponse = function () {
            var arrayBuffer, buffer, i, j, jsonError, ref, view;
            if (Buffer.concat) {
                buffer = Buffer.concat(this._responseParts);
            } else {
                buffer = this._concatBuffers(this._responseParts);
            }
            // temporary workaround for transport encoding parsing
            if (this._responseHeaders['content-encoding'] && this._responseHeaders['content-encoding'] === 'gzip') {
                buffer = require('zlib').gunzipSync(buffer);
            }
            this._responseParts = null;
            switch (this.responseType) {
                case 'text':
                    this._parseTextResponse(buffer);
                    break;
                case 'json':
                    this.responseText = null;
                    try {
                        this.response = JSON.parse(buffer.toString('utf-8'));
                    } catch (_error) {
                        jsonError = _error;
                        this.response = null;
                    }
                    break;
                case 'buffer':
                    this.responseText = null;
                    this.response = buffer;
                    break;
                case 'arraybuffer':
                    this.responseText = null;
                    arrayBuffer = new ArrayBuffer(buffer.length);
                    view = new Uint8Array(arrayBuffer);
                    for (i = j = 0, ref = buffer.length; 0 <= ref ? j < ref : j > ref; i = 0 <= ref ? ++j : --j) {
                        view[i] = buffer[i];
                    }
                    this.response = arrayBuffer;
                    break;
                default:
                    this._parseTextResponse(buffer);
            }
            return void 0;
        };

        XMLHttpRequest.prototype._parseTextResponse = function (buffer) {
            var e;
            try {
                this.responseText = buffer.toString(this._parseResponseEncoding());
            } catch (_error) {
                e = _error;
                this.responseText = buffer.toString('binary');
            }
            this.response = this.responseText;
            return void 0;
        };

        XMLHttpRequest.prototype._parseResponseEncoding = function () {
            var contentType, encoding, match;
            encoding = null;
            if (contentType = this._responseHeaders['content-type']) {
                if (match = /\;\s*charset\=(.*)$/.exec(contentType)) {
                    return match[1];
                }
            }
            return 'utf-8';
        };

        XMLHttpRequest.prototype._concatBuffers = function (buffers) {
            var buffer, j, k, len, len1, length, target;
            if (buffers.length === 0) {
                return Buffer.alloc(0);
            }
            if (buffers.length === 1) {
                return buffers[0];
            }
            length = 0;
            for (j = 0, len = buffers.length; j < len; j++) {
                buffer = buffers[j];
                length += buffer.length;
            }
            target = Buffer.alloc(length);
            length = 0;
            for (k = 0, len1 = buffers.length; k < len1; k++) {
                buffer = buffers[k];
                buffer.copy(target, length);
                length += buffer.length;
            }
            return target;
        };

        return XMLHttpRequest;

    })(XMLHttpRequestEventTarget);

    module.exports = XMLHttpRequest;

    XMLHttpRequest.XMLHttpRequest = XMLHttpRequest;

    SecurityError = (function (superClass) {
        extend(SecurityError, superClass);

        function SecurityError() {
            SecurityError.__super__.constructor.apply(this, arguments);
        }

        return SecurityError;

    })(Error);

    XMLHttpRequest.SecurityError = SecurityError;

    InvalidStateError = (function (superClass) {
        extend(InvalidStateError, superClass);

        function InvalidStateError() {
            InvalidStateError.__super__.constructor.apply(this, arguments);
        }

        return InvalidStateError;

    })(Error);

    InvalidStateError = (function (superClass) {
        extend(InvalidStateError, superClass);

        function InvalidStateError() {
            return InvalidStateError.__super__.constructor.apply(this, arguments);
        }

        return InvalidStateError;

    })(Error);

    XMLHttpRequest.InvalidStateError = InvalidStateError;

    NetworkError = (function (superClass) {
        extend(NetworkError, superClass);

        function NetworkError() {
            NetworkError.__super__.constructor.apply(this, arguments);
        }

        return NetworkError;

    })(Error);

    XMLHttpRequest.SyntaxError = SyntaxError;

    SyntaxError = (function (superClass) {
        extend(SyntaxError, superClass);

        function SyntaxError() {
            SyntaxError.__super__.constructor.apply(this, arguments);
        }

        return SyntaxError;

    })(Error);

    ProgressEvent = (function () {
        function ProgressEvent(type) {
            this.type = type;
            this.target = null;
            this.currentTarget = null;
            this.lengthComputable = false;
            this.loaded = 0;
            this.total = 0;
        }

        ProgressEvent.prototype.bubbles = false;

        ProgressEvent.prototype.cancelable = false;

        ProgressEvent.prototype.target = null;

        ProgressEvent.prototype.loaded = null;

        ProgressEvent.prototype.lengthComputable = null;

        ProgressEvent.prototype.total = null;

        return ProgressEvent;

    })();

    XMLHttpRequest.ProgressEvent = ProgressEvent;

    XMLHttpRequestUpload = (function (superClass) {
        extend(XMLHttpRequestUpload, superClass);

        function XMLHttpRequestUpload(request) {
            XMLHttpRequestUpload.__super__.constructor.call(this);
            this._request = request;
            this._reset();
        }

        XMLHttpRequestUpload.prototype._reset = function () {
            this._contentType = null;
            this._body = null;
            return void 0;
        };

        XMLHttpRequestUpload.prototype._setData = function (data) {
            var body, i, j, k, offset, ref, ref1, view;
            if (typeof data === 'undefined' || data === null) {
                return;
            }
            if (typeof data === 'string') {
                if (data.length !== 0) {
                    this._contentType = 'text/plain;charset=UTF-8';
                }
                this._body = Buffer.from(data, 'utf8');
            } else if (Buffer.isBuffer(data)) {
                this._body = data;
            } else if (data instanceof ArrayBuffer) {
                body = Buffer.alloc(data.byteLength);
                view = new Uint8Array(data);
                for (i = j = 0, ref = data.byteLength; 0 <= ref ? j < ref : j > ref; i = 0 <= ref ? ++j : --j) {
                    body[i] = view[i];
                }
                this._body = body;
            } else if (data.buffer && data.buffer instanceof ArrayBuffer) {
                body = Buffer.alloc(data.byteLength);
                offset = data.byteOffset;
                view = new Uint8Array(data.buffer);
                for (i = k = 0, ref1 = data.byteLength; 0 <= ref1 ? k < ref1 : k > ref1; i = 0 <= ref1 ? ++k : --k) {
                    body[i] = view[i + offset];
                }
                this._body = body;
            } else if (typeof data === 'object' && data instanceof FormData) {
                this._body = null;
            } else {
                throw new Error("Unsupported send() data " + data);
            }
            return void 0;
        };

        XMLHttpRequestUpload.prototype._finalizeHeaders = function (headers, loweredHeaders) {
            if (this._contentType) {
                if (!('content-type' in loweredHeaders)) {
                    headers['Content-Type'] = this._contentType;
                }
            }
            if (this._body) {
                headers['Content-Length'] = this._body.length.toString();
            }
            return void 0;
        };

        XMLHttpRequestUpload.prototype._startUpload = function (request) {
            if (this._body) {
                request.write(this._body);
            }
            request.end();
            return void 0;
        };

        return XMLHttpRequestUpload;

    })(XMLHttpRequestEventTarget);

    XMLHttpRequest.XMLHttpRequestUpload = XMLHttpRequestUpload;

}).call(this);

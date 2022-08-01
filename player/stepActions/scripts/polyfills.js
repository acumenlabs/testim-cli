"use strict";

var polyfills = function () {
    if (!Array.from) {
        Array.from = (function () {
            var toStr = Object.prototype.toString;
            var isCallable = function (fn) {
                return typeof fn === 'function' || toStr.call(fn) === '[object Function]';
            };
            var toInteger = function (value) {
                var number = Number(value);
                if (isNaN(number)) {
                    return 0;
                }
                if (number === 0 || !isFinite(number)) {
                    return number;
                }
                return (number > 0 ? 1 : -1) * Math.floor(Math.abs(number));
            };
            var maxSafeInteger = Math.pow(2, 53) - 1;
            var toLength = function (value) {
                var len = toInteger(value);
                return Math.min(Math.max(len, 0), maxSafeInteger);
            };

            // The length property of the from method is 1.
            return function from(arrayLike/*, mapFn, thisArg */) {
                // 1. Let C be the this value.
                var C = this;

                // 2. Let items be ToObject(arrayLike).
                var items = Object(arrayLike);

                // 3. ReturnIfAbrupt(items).
                if (arrayLike === null) {
                    throw new TypeError("Array.from requires an array-like object - not null or undefined");
                }

                // 4. If mapfn is undefined, then let mapping be false.
                var mapFn = arguments.length > 1 ? arguments[1] : void undefined;
                var T;
                if (typeof mapFn !== 'undefined') {
                    // 5. else
                    // 5. a If IsCallable(mapfn) is false, throw a TypeError exception.
                    if (!isCallable(mapFn)) {
                        throw new TypeError('Array.from: when provided, the second argument must be a function');
                    }

                    // 5. b. If thisArg was supplied, let T be thisArg; else let T be undefined.
                    if (arguments.length > 2) {
                        T = arguments[2];
                    }
                }

                // 10. Let lenValue be Get(items, "length").
                // 11. Let len be ToLength(lenValue).
                var len = toLength(items.length);

                // 13. If IsConstructor(C) is true, then
                // 13. a. Let A be the result of calling the [[Construct]] internal method
                // of C with an argument list containing the single item len.
                // 14. a. Else, Let A be ArrayCreate(len).
                var A = isCallable(C) ? Object(new C(len)) : new Array(len);

                // 16. Let k be 0.
                var k = 0;
                // 17. Repeat, while k < len… (also steps a - h)
                var kValue;
                while (k < len) {
                    kValue = items[k];
                    if (mapFn) {
                        A[k] = typeof T === 'undefined' ? mapFn(kValue, k) : mapFn.call(T, kValue, k);
                    } else {
                        A[k] = kValue;
                    }
                    k += 1;
                }
                // 18. Let putStatus be Put(A, "length", len, true).
                A.length = len;
                // 20. Return A.
                return A;
            };
        }());
    }

    if (!window.JSON) {
        window.JSON = {
            parse: function(sJSON) { return eval('(' + sJSON + ')'); },
            stringify: (function () {
                var toString = Object.prototype.toString;
                var isArray = Array.isArray || function (a) { return toString.call(a) === '[object Array]'; };
                var escMap = {'"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t'};
                var escFunc = function (m) { return escMap[m] || '\\u' + (m.charCodeAt(0) + 0x10000).toString(16).substr(1); };
                var escRE = /[\\"\u0000-\u001F\u2028\u2029]/g;
                return function stringify(value) {
                    if (value == null) {
                        return 'null';
                    } else if (typeof value === 'number') {
                        return isFinite(value) ? value.toString() : 'null';
                    } else if (typeof value === 'boolean') {
                        return value.toString();
                    } else if (typeof value === 'object') {
                        if (typeof value.toJSON === 'function') {
                            return stringify(value.toJSON());
                        } else if (isArray(value)) {
                            var res = '[';
                            for (var i = 0; i < value.length; i++)
                                res += (i ? ', ' : '') + stringify(value[i]);
                            return res + ']';
                        } else if (toString.call(value) === '[object Object]') {
                            var tmp = [];
                            for (var k in value) {
                                if (value.hasOwnProperty(k))
                                    tmp.push(stringify(k) + ': ' + stringify(value[k]));
                            }
                            return '{' + tmp.join(', ') + '}';
                        }
                    }
                    return '"' + value.toString().replace(escRE, escFunc) + '"';
                };
            })()
        };
    }

    if (typeof Object.assign != 'function') {
        Object.assign = function (target, varArgs) { // .length of function is 2
            'use strict';
            if (target == null) { // TypeError if undefined or null
                throw new TypeError('Cannot convert undefined or null to object');
            }

            var to = Object(target);

            for (var index = 1; index < arguments.length; index++) {
                var nextSource = arguments[index];

                if (nextSource != null) { // Skip over if undefined or null
                    for (var nextKey in nextSource) {
                        // Avoid bugs when hasOwnProperty is shadowed
                        if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
                            to[nextKey] = nextSource[nextKey];
                        }
                    }
                }
            }
            return to;
        };
    }

    if(!window.Promise) {
        (function () {

            // Store setTimeout reference so promise-polyfill will be unaffected by
            // other code modifying setTimeout (like sinon.useFakeTimers())
            var setTimeoutFunc = setTimeout;

            function noop() {}

            // Polyfill for Function.prototype.bind
            function bind(fn, thisArg) {
                return function () {
                    fn.apply(thisArg, arguments);
                };
            }

            function Promise(fn) {
                if (typeof this !== 'object') throw new TypeError('Promises must be constructed via new');
                if (typeof fn !== 'function') throw new TypeError('not a function');
                this._state = 0;
                this._handled = false;
                this._value = undefined;
                this._deferreds = [];

                doResolve(fn, this);
            }

            function handle(self, deferred) {
                while (self._state === 3) {
                    self = self._value;
                }
                if (self._state === 0) {
                    self._deferreds.push(deferred);
                    return;
                }
                self._handled = true;
                Promise._immediateFn(function () {
                    var cb = self._state === 1 ? deferred.onFulfilled : deferred.onRejected;
                    if (cb === null) {
                        (self._state === 1 ? resolve : reject)(deferred.promise, self._value);
                        return;
                    }
                    var ret;
                    try {
                        ret = cb(self._value);
                    } catch (e) {
                        reject(deferred.promise, e);
                        return;
                    }
                    resolve(deferred.promise, ret);
                });
            }

            function resolve(self, newValue) {
                try {
                    // Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
                    if (newValue === self) throw new TypeError('A promise cannot be resolved with itself.');
                    if (newValue && (typeof newValue === 'object' || typeof newValue === 'function')) {
                        var then = newValue.then;
                        if (newValue instanceof Promise) {
                            self._state = 3;
                            self._value = newValue;
                            finale(self);
                            return;
                        } else if (typeof then === 'function') {
                            doResolve(bind(then, newValue), self);
                            return;
                        }
                    }
                    self._state = 1;
                    self._value = newValue;
                    finale(self);
                } catch (e) {
                    reject(self, e);
                }
            }

            function reject(self, newValue) {
                self._state = 2;
                self._value = newValue;
                finale(self);
            }

            function finale(self) {
                if (self._state === 2 && self._deferreds.length === 0) {
                    Promise._immediateFn(function() {
                        if (!self._handled) {
                            Promise._unhandledRejectionFn(self._value);
                        }
                    });
                }

                for (var i = 0, len = self._deferreds.length; i < len; i++) {
                    handle(self, self._deferreds[i]);
                }
                self._deferreds = null;
            }

            function Handler(onFulfilled, onRejected, promise) {
                this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
                this.onRejected = typeof onRejected === 'function' ? onRejected : null;
                this.promise = promise;
            }

            /**
             * Take a potentially misbehaving resolver function and make sure
             * onFulfilled and onRejected are only called once.
             *
             * Makes no guarantees about asynchrony.
             */
            function doResolve(fn, self) {
                var done = false;
                try {
                    fn(function (value) {
                        if (done) return;
                        done = true;
                        resolve(self, value);
                    }, function (reason) {
                        if (done) return;
                        done = true;
                        reject(self, reason);
                    });
                } catch (ex) {
                    if (done) return;
                    done = true;
                    reject(self, ex);
                }
            }

            Promise.prototype['catch'] = function (onRejected) {
                return this.then(null, onRejected);
            };

            Promise.prototype.then = function (onFulfilled, onRejected) {
                var prom = new (this.constructor)(noop);

                handle(this, new Handler(onFulfilled, onRejected, prom));
                return prom;
            };

            Promise.all = function (arr) {
                var args = Array.prototype.slice.call(arr);

                return new Promise(function (resolve, reject) {
                    if (args.length === 0) return resolve([]);
                    var remaining = args.length;

                    function res(i, val) {
                        try {
                            if (val && (typeof val === 'object' || typeof val === 'function')) {
                                var then = val.then;
                                if (typeof then === 'function') {
                                    then.call(val, function (val) {
                                        res(i, val);
                                    }, reject);
                                    return;
                                }
                            }
                            args[i] = val;
                            if (--remaining === 0) {
                                resolve(args);
                            }
                        } catch (ex) {
                            reject(ex);
                        }
                    }

                    for (var i = 0; i < args.length; i++) {
                        res(i, args[i]);
                    }
                });
            };

            Promise.resolve = function (value) {
                if (value && typeof value === 'object' && value.constructor === Promise) {
                    return value;
                }

                return new Promise(function (resolve) {
                    resolve(value);
                });
            };

            Promise.reject = function (value) {
                return new Promise(function (resolve, reject) {
                    reject(value);
                });
            };

            Promise.race = function (values) {
                return new Promise(function (resolve, reject) {
                    for (var i = 0, len = values.length; i < len; i++) {
                        values[i].then(resolve, reject);
                    }
                });
            };

            // Use polyfill for setImmediate for performance gains
            Promise._immediateFn = (typeof setImmediate === 'function' && function (fn) { setImmediate(fn); }) ||
                function (fn) {
                    setTimeoutFunc(fn, 0);
                };

            Promise._unhandledRejectionFn = function _unhandledRejectionFn(err) {
                if (typeof console !== 'undefined' && console) {
                    console.warn('Possible Unhandled Promise Rejection:', err); // eslint-disable-line no-console
                }
            };

            /**
             * Set the immediate function to execute callbacks
             * @param fn {function} Function to execute
             * @deprecated
             */
            Promise._setImmediateFn = function _setImmediateFn(fn) {
                Promise._immediateFn = fn;
            };

            /**
             * Change the function to execute on unhandled rejection
             * @param {function} fn Function to execute on unhandled rejection
             * @deprecated
             */
            Promise._setUnhandledRejectionFn = function _setUnhandledRejectionFn(fn) {
                Promise._unhandledRejectionFn = fn;
            };

            window.Promise = Promise;

        })(this);
    }

    if(!Element.prototype.remove) {
        (function (arr) {
            arr.forEach(function (item) {
                item.remove = item.remove || function () {
                        this.parentNode.removeChild(this);
                    };
            });
        })([Element.prototype, CharacterData.prototype, DocumentType.prototype]);
    }
};

module.exports = polyfills;

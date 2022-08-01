/* eslint-disable prefer-template, no-mixed-operators, no-unused-expressions, no-unused-vars, max-len, prefer-rest-params, no-restricted-syntax, guard-for-in, block-scoped-var, no-var */

'use strict';

const runCode = function (eventData, preCompiledCode) {
    typeof Object.tstassign !== 'function' && (Object.tstassign = function (n, t) {
        'use strict';

        if (n == null) throw new TypeError('Cannot convert undefined or null to object'); for (var r = Object(n), e = 1; e < arguments.length; e++) { var o = arguments[e]; if (o != null) for (var a in o)Object.prototype.hasOwnProperty.call(o, a) && (r[a] = o[a]); } return r;
    });
    Object.assign = typeof Object.assign !== 'function' ? Object.tstassign : Object.assign;

    function appendToStorage(name, data) {
        const sessionItem = 'data-testim-' + name;

        const nativeFuncErrMsg = 'Native sessionStorage is not available';
        function isNativeFunction(fn) {
            if (!fn || !fn.toString) {
                return false;
            }
            return fn.toString().indexOf('[native code]') > -1;
        }
        try {
            if (![window.sessionStorage.setItem, window.sessionStorage.getItem].every(isNativeFunction)) {
                throw new Error(nativeFuncErrMsg);
            }
            const oldData = JSON.parse(window.sessionStorage.getItem(sessionItem) || '{}');
            const newData = Object.tstassign({}, oldData, data);
            window.sessionStorage.setItem(sessionItem, JSON.stringify(newData));
        } catch (err) {
            // any variation QuotaExceededError from browsers
            const isQuotaExceededError = err.message.toLowerCase().indexOf('quota') > -1;
            const isNativeFunctionError = err.message === nativeFuncErrMsg;

            if (err.message.indexOf('sessionStorage') > -1 || // Chrome + Firefox
                err.message.indexOf('The operation is insecure') > -1 || // Safari
                err.message.indexOf('SecurityError') > -1 || // Edge
                isQuotaExceededError ||
                isNativeFunctionError
            ) {
                var storage = document.head.querySelector('#testim-storage-backup');
                if (!storage) {
                    storage = document.createElement('meta');
                    storage.id = 'testim-storage-backup';
                    document.head.append(storage);
                }
                const oldData = JSON.parse(storage.getAttribute(sessionItem) || '{}');
                const newData = Object.tstassign({}, oldData, data);
                storage.setAttribute(sessionItem, JSON.stringify(newData));
                if (isQuotaExceededError || isNativeFunctionError) {
                    try {
                        window.sessionStorage.removeItem(sessionItem);
                    } catch (e) {
                        // Prevents future retries from looking in sessionStorage with old data
                    }
                    (window.TSTA = window.TSTA || {}).useFallbackStorage = true;
                }
                return;
            }
            throw err;
        }
    }

    function getExecutionArguments(eventData) {
        // New code with stepParamsBuilder
        if (eventData.function) {
            return eventData.function.args
                .map(function (arg) { return (arg && arg.locatedElement) ? getLocatedElement(arg.locatedElement) : arg; });
        }

        // Old code
        return eventData.directParams
            .map(function (p) { return p.selector ? document.querySelector(p.selector) : p.value; })
            .concat(eventData.otherParams);
    }

    function constructWithArguments(constructor, args) {
        function F() {
            return constructor.apply(this, args);
        }

        F.prototype = constructor.prototype;
        return new F();
    }

    var exportedData = {};
    var exportedTestData = {};
    var exportedGlobalData = {};

    var functionParams = eventData.functionParams;
    var transactionId = eventData.transactionId;

    try {
        var args = getExecutionArguments(eventData);

        args.push(exportedData);
        args.push(exportedTestData);
        args.push(exportedGlobalData);

        var params = eventData.function && eventData.function.params || functionParams;

        var functionToRun = preCompiledCode || constructWithArguments(Function, params);
        var result = functionToRun.apply(null, args);

        if (typeof Promise !== 'undefined' && result instanceof Promise) {
            appendToStorage(transactionId, { type: 'promise' });
            result.then(function (res) {
                appendToStorage(transactionId, {
                    status: 'done',
                    success: true,
                    result: {
                        resultValue: res,
                        exports: exportedData,
                        exportsTest: exportedTestData,
                        exportsGlobal: exportedGlobalData,
                    },
                });
            }, function (res) {
                appendToStorage(transactionId, {
                    status: 'failed',
                    success: false,
                    result: {
                        resultValue: res.toString(),
                        exports: exportedData,
                        exportsTest: exportedTestData,
                        exportsGlobal: exportedGlobalData,
                    },
                });
            });
        } else {
            appendToStorage(transactionId, {
                status: 'done',
                success: true,
                result: {
                    resultValue: result,
                    exports: exportedData,
                    exportsTest: exportedTestData,
                    exportsGlobal: exportedGlobalData,
                },
            });
        }
    } catch (e) {
        appendToStorage(transactionId, {
            status: 'failed',
            success: false,
            result: {
                resultValue: e.toString(),
                exports: exportedData,
                exportsTest: exportedTestData,
                exportsGlobal: exportedGlobalData,
            },
        });
    }
};

module.exports = runCode;

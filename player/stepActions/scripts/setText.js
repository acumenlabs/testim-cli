/* globals getLocatedElement, dispatchFocus */

'use strict';

/*global KeyboardEvent */
var setText = function (eventData, done) {
    var eventConstructorSupported = typeof Event === 'function';
    var element = eventData.isRoot ? document.documentElement : getLocatedElement(eventData.locatedElement);
    var context = {
        eventIndex: 0,
        element: element,
        events: eventData.events,
        eventType: eventData.eventType,
        quirks: eventData.quirks
    };

    if(!element) {
        throw new Error('element not found');
    }

    window.__unloadNavigator = function () {
        resolve();
    };

    window.addEventListener("unload", window.__unloadNavigator);

    var keyboardEventNames = ["keydown", "keyup", "keypress"];
    var MAX_KEYBOARD_EVENT_TIMEOUT = 15; //max msec between keyboard events

    function getTextInputEventObject(userEvent) {
        try {
            if (!eventConstructorSupported) {
                return undefined;
            }

            var event = new CustomEvent("textInput", {
                bubbles: true,
                cancelable: true
            });
            if (userEvent.eventData) {
                event.data = userEvent.eventData.data;
            }
            return event;
        } catch (err) {
        }
    }

    function initTextInputEvent(userEvent) {
        try {
            var event = document.createEvent('TextEvent');
            event.data = userEvent.eventData.data;
            var method = 1; // keyboard
            var locale = userEvent.eventData.locale || 'en-US';
            event.initTextEvent('textInput', true, true, window, userEvent.eventData.data, method, locale);
            return event;
        } catch (err) {
        }
    }

    function getTextInputEvent(userEvent) {
        return getTextInputEventObject(userEvent) || initTextInputEvent();
    }

    function createKeyboardEventObject(eventType, eventData, modifiers) {
        try {
            return new KeyboardEvent(eventType, {
                bubbles: true,
                cancelable: true,
                location: eventData.location || 0,
                key: eventData.key || "",
                ctrlKey: Boolean(modifiers.ctrl),
                shiftKey: Boolean(modifiers.shift),
                altKey: Boolean(modifiers.alt),
                metaKey: Boolean(modifiers.meta)
            });
        } catch (err) {
        }
    }

    function initKeyboardEvent(eventType, eventData, modifiers) {
        try {
            var event = document.createEvent('KeyboardEvent');

            event.initKeyEvent(eventType,// typeArg,
                true,// canBubbleArg,
                true,// cancelableArg,
                null,// viewArg,  Specifies UIEvent.view. This value may be null.
                Boolean(modifiers.ctrl),
                Boolean(modifiers.alt),
                Boolean(modifiers.shift),
                Boolean(modifiers.meta),
                eventData.key || "",
                0);// charCodeArg);

            return event;
        } catch (err) {
        }
    }

    function createKeyboardEvents(eventType, eventData, modifiers) {
        try {
            var event = document.createEvent('Events');
            event.initEvent(eventType, true, true);
            event.altKey = Boolean(modifiers.alt);
            event.ctrlKey = Boolean(modifiers.ctrl);
            event.metaKey = Boolean(modifiers.meta);
            event.shiftKey = Boolean(modifiers.shift);
            event.keyCode = eventData.key || "";
            return event;
        } catch (err) {
        }
    }

    function createKeyboardEvent(eventType, eventData, modifiers) {
        return createKeyboardEventObject(eventType, eventData, modifiers) ||
            initKeyboardEvent(eventType, eventData, modifiers) ||
            createKeyboardEvents(eventType, eventData, modifiers);
    }

    function getKeyboardEvent(userEvent) {
        // some apps override Array.indexOf to return undefined if element not found (like Arkia)
        var index = keyboardEventNames.indexOf(userEvent.event);
        if ((typeof index !== "number") || (index < 0)) {
            return null;
        }

        var eventData = userEvent.eventData;
        var modifiers = eventData.modifiers || {};

        var event = createKeyboardEvent(userEvent.event, eventData, modifiers);

        // workaround for chromium bugs which make keycode etc readonly
        Object.defineProperties(event, {
            keyCode: {
                enumerable: true,
                get: function () {
                    return this._keyCode_;
                }
            },
            charCode: {
                enumerable: true,
                get: function () {
                    return this._charCode_;
                }
            },
            which: {
                enumerable: true,
                get: function () {
                    return this._keyCode_;
                }
            }
        });
        event._keyCode_ = eventData.keyCode;
        event._charCode_ = eventData.charCode || 0;
        return event;
    }

    function getEvent(userEvent) {
        return userEvent.event === "textInput" ?
            getTextInputEvent(userEvent) :
            getKeyboardEvent(userEvent);
    }

    function shouldSkipEvent(currentEvent, context) {
        var isTextInputAuth0Form = function () {
            return currentEvent.event === "textInput" && !(context.quirks && context.quirks.isAuth0Form);
        };
        return isTextInputAuth0Form();
    }

    function getTextEventTimeout(currentEvent, nextEvent) {
        return ((currentEvent.event === "keyup") && (nextEvent.event === "keydown")) ?
            MAX_KEYBOARD_EVENT_TIMEOUT :
            0;
    }

    function getTimeBetweenFiringEvents(context, currentEvent, nextEvent) {
        var maxTimeout = getTextEventTimeout(currentEvent, nextEvent);
        return Math.min(nextEvent.timeStamp - currentEvent.timeStamp, maxTimeout);
    }

    function handleReactFormFocus(element) {
        // solution taken partially from https://github.com/vitalyq/react-trigger-change
        var descriptor = Object.getOwnPropertyDescriptor(element, 'value');
        if (!descriptor) {
            return;
        }
        var initialValue = element.value;
        element.value = initialValue + '#';
        if (descriptor.configurable) {
            delete element.value;
        }
        element.value = initialValue;
        var event = document.createEvent('HTMLEvents');
        event.initEvent('input', true, false);
        element.dispatchEvent(event);
        Object.defineProperty(element, 'value', descriptor);
    }

    function handleChangeEventIfNeeded(context) {
        if (!context.isInput) {
            return;
        }
        try {
            handleReactFormFocus(context.element);
            if (eventConstructorSupported) {
                context.element.dispatchEvent(new Event("change"));
            } else {
                var event = document.createEvent("HTMLEvents");
                event.initEvent("change", false, true);
                context.element.dispatchEvent(event);
            }
        } catch (e) {
        }

    }

    function nextAsyncEvent(context, currentEvent, nextEvent) {
        if (nextEvent) {
            setTimeout(function () {
                executeAsyncNext(context);
            }, getTimeBetweenFiringEvents(context, currentEvent, nextEvent));
        } else {
            if (window.__unloadNavigator) {
                window.removeEventListener("unload", window.__unloadNavigator);
            }
            handleChangeEventIfNeeded(context);
            resolve();
        }
    }

    function shouldDispatchOnParentElement(eventType, context) {
        return (eventType === "change" || eventType === "blur") && context.element.tagName === "OPTION";
    }

    function getElement(event, context, currentEvent) {
        if (shouldDispatchOnParentElement(event.type, context)) {
            return context.element.parentElement;
        } else if (currentEvent.locatedElement) {
            return getLocatedElement(currentEvent.locatedElement);
        } else {
            return context.element;
        }
    }

    function findTextNode(element, offsetData) {
        var child = element.firstChild,
            innerChild;
        while (child) {
            if (child.nodeType === 3) {
                if (offsetData.offset-- <= 0) {
                    return child;
                }
            }
            else if (child.nodeType === 1) {
                innerChild = findTextNode(child, offsetData);
                if (innerChild) {
                    return innerChild;
                }
            }
            child = child.nextSibling;
        }
        return null;
    }

    function setSelection(element, selection) {
        if (!element || !selection) {
            return;
        }
        if (!isNaN(selection.start)) {
            element.selectionStart = selection.start;
            element.selectionEnd = selection.end;
        }
        else if (!isNaN(selection.nodeOffset)) {
            var startNode;
            if (element.firstChild) {
                startNode = findTextNode(element, { offset: selection.nodeOffset });
            }
            else {
                startNode = element;
            }
            if (startNode) {
                var sel = window.getSelection(),
                    range = document.createRange();

                try { // until we get our act together regarding contenteditable, this may throw when the numbers in the recorded data don't match the current text
                    sel.removeAllRanges();
                    range.setStart(startNode, selection.textOffset);
                    range.setEnd(startNode, selection.textOffset);
                    sel.addRange(range);
                }
                catch (ignore) {
                }
            }
        }
    }

    function executeAsyncEvent(event, context, currentEvent) {
        if (context.isFocusable && context.isSelectable(event) && event.type !== "submit") {
            try {
                setSelection(context.element, currentEvent.eventData.selection);
            } catch (ignore) {
            }
        }
        var element = getElement(event, context, currentEvent);
        if (!element) {
            throw new Error('could not find element');
        }
        if (event.type === "submit" && element.action) {
            element.submit();
        } else {
            element.dispatchEvent(event);
        }
    }

    function executeAsyncNext(context) {
        var event;
        var currentEvent = context.events[context.eventIndex];
        var nextEvent = context.events[++context.eventIndex];
        try {
            event = getEvent(currentEvent);
        } catch (err) {
            return reject("exception in get event in text step:" + err.message);
        }

        if (shouldSkipEvent(currentEvent, context)) {
            return nextAsyncEvent(context, currentEvent, nextEvent);
        } else if (event) {
            try {
                executeAsyncEvent(event, context, currentEvent);
            } catch (err) {
                return reject("exception in executeEvent in text step:" + err.message);
            }
        } else if (context.noEventExecuter) {
            context.noEventExecuter(context, currentEvent);
        } else {
            return reject("cannot execute event " + currentEvent.event);
        }
        nextAsyncEvent(context, currentEvent, nextEvent);
    }

    function isFocusableInput(target) {
        var tagName = target.tagName;
        return (tagName === "INPUT" || tagName === "TEXTAREA");
    }

    function isContentEditable(target) {
        return target.getAttribute ?
            Boolean(target.getAttribute("contenteditable") === "true") :
            false;
    }

    function executeSetValue(context, userEvent) {
        if (context.isInput) {
            context.element.value = userEvent.eventData.text;
            var inputEvent = document.createEvent("Event");
            inputEvent.initEvent("input", true, false);
            context.element.dispatchEvent(inputEvent);
        }
        else if (context.isContentEditable) {
            context.element.innerHTML = userEvent.eventData.text;
        }
    }

    function findEffectiveActiveElement() {
        var activeElement = document.activeElement;
        while (activeElement.shadowRoot && activeElement.shadowRoot.activeElement) {
            activeElement = activeElement.shadowRoot.activeElement;
        }
        return activeElement;
    }

    function resolve(result) {
        var status = {
            status: 'done',
            result: result,
            success: true
        };
        if (context.isNonTextableElemnet) {
            status.reason = "Set text on non input element";
        }

        done(status);
    }

    function reject(result) {
        result = result || {};
        var status = {
            status: 'failed',
            result: result,
            success: false
        };
        if (context.isNonTextableElemnet) {
            status.reason = "Set text on non input element";
        }

        done(status);
    }

    try {
        context.isInput = isFocusableInput(context.element);
        context.isContentEditable = isContentEditable(context.element);
        if (!context.isInput && !context.isContentEditable) {
            context.isNonTextableElemnet = true;
        }
        context.isFocusable = context.isInput || context.isContentEditable;
        context.isSelectable = function (event) {
            return event.type !== "keyup";
        };
        context.noEventExecuter = executeSetValue;
    } catch (err) {
        return reject("exception in set text step:" + err.message);
    }

    var oldActiveElement = findEffectiveActiveElement();
    dispatchFocus(eventData.elementToFocusLocatedElement, oldActiveElement);
    executeAsyncNext(context);
};

module.exports = setText;

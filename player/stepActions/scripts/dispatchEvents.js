"use strict";

var dispatchEvents = function (eventData, done) {
    function getParents(el) {
        return el ? [el].concat(getParents(el.parentNode)) : [];
    }

    function handleReactSelectFocusQuirk(context, event) {
        function focusReactSelect(element) {

            function getReactSelectRoot(element) {
                return getParents(element).filter(function (el) {
                    return Array.apply(null, el.classList || []).indexOf("Select-control") !== -1;
                })[0];
            }

            function getReactSelectInput(element) {
                var root = getReactSelectRoot(element);
                return root ? root.querySelector("INPUT") : null;
            }

            var reactSelectInput = getReactSelectInput(element);
            if (reactSelectInput) {
                reactSelectInput.focus();
            }
        }

        var isReactSelectElement = context.quirks && context.quirks.isReactSelect;
        if (event.type === "mousedown" && isReactSelectElement) {
            focusReactSelect(context.element);
        }
    }

    function handleCKEditorQuirk(context, event) {
        var isCKEditorFrame = context.quirks && context.quirks.isCKEditorFrame;
        if (event.type === "click" && isCKEditorFrame) {
            document.body.focus();
        }
    }

    function dispatchMouseOver() {
        var event = document.createEvent('Events');
        event.initEvent('mouseover', true, true);
        context.element.dispatchEvent(event);
    }

    function dispatchMouseMove() {
        var userEvent = {
            event: 'mousemove',
            modifiers: {},
            button: 0
        };
        var event = createMouseEvent(userEvent);
        context.element.dispatchEvent(event);
    }

    function getEventPosition(userEvent, element) {
        function isWithinBounds(start, end, point) {
            return (point > start) && (point < end);
        }

        var pointerPosition = userEvent.pointerPosition || {};
        var rect = element.getBoundingClientRect();
        var clientX = pointerPosition.originX && isWithinBounds(rect.left, rect.left + rect.width, pointerPosition.originX) ? pointerPosition.originX : rect.left + (rect.width / 2);
        var clientY = pointerPosition.originY && isWithinBounds(rect.top, rect.top + rect.height, pointerPosition.originY) ? pointerPosition.originY : rect.top + (rect.height / 2);
        return {x: clientX, y: clientY};
    }

    function createMouseEvent(userEvent) {
        var position = getEventPosition(userEvent, context.element);
        var modifiers = userEvent.modifiers || context.modifiers || {};
        var button = userEvent.button || context.button || 0;
        var eventType = userEvent.event;

        var event = document.createEvent("MouseEvents");
        event.initMouseEvent(
            eventType,
            true, /* bubbles */
            true, /* cancelable */
            document.defaultView, /* view */
            1, /* detail */
            0, /* screenX */
            0, /* screenY */
            position.x, /* clientX */
            position.y, /* clientY */
            Boolean(modifiers.ctrl), /* ctrl */
            Boolean(modifiers.alt), /* alt */
            Boolean(modifiers.shift), /* shift */
            Boolean(modifiers.meta), /* meta */
            button, /* button */
            document.body ? document.body.parentNode : document.documentElement,
        );
        return event;
    }

    function createPointerEvent(userEvent) {
        var position = getEventPosition(userEvent, context.element);
        var modifiers = userEvent.modifiers || context.modifiers || {};
        var eventType = userEvent.event;

        if (!window.PointerEvent) {
            return;
        }
        return new window.PointerEvent(eventType, {
            screenX: 0,
            screenY: 0,
            clientX: position.x,
            clientY: position.y,
            ctrlKey: Boolean(modifiers.ctrl),
            altKey: Boolean(modifiers.alt),
            shiftKey: Boolean(modifiers.shift),
            metaKey: Boolean(modifiers.meta),
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerType: "mouse",
            isPrimary: true,
        });
    }

    function createFocusEvent(userEvent) {
        var event = document.createEvent("FocusEvent");
        // TODO we want to use new Event, but mootools (used by zuora which is used by jfrog)
        //  overrides window.Event and throws an error
        event.initEvent(userEvent.event, true, false);
        return event;
    }

    function createEvent(userEvent) {
        var eventType = userEvent.event;
        var event = document.createEvent("HTMLEvents");
        event.initEvent(eventType, true, false);
        return event;
    }

    function dispatchSyncEvent(event) {
        console.log("dispatching: " + event.type);
        console.log(event);

        context.element.dispatchEvent(event);
        handleReactSelectFocusQuirk(context, event);
        handleCKEditorQuirk(context, event);
    }

    function dispatchSyncEventSequence() {
        context.events
            .map(function (userEvent) {
                try {
                    if(MOUSE_EVENTS.includes(userEvent.event)) {
                        return createMouseEvent(userEvent);
                    } else if (POINTER_EVENTS.includes(userEvent.event)) {
                        return createPointerEvent(userEvent);
                    } else if(FOCUS_EVENTS.includes(userEvent.event)) {
                        return createFocusEvent(userEvent);
                    } else {
                        return createEvent(userEvent);
                    }
                } catch (e) {
                    // pointer events not supported in ie11
                    return;
                }
            })
            .filter(Boolean)
            .forEach(function (event) {
                dispatchSyncEvent(event);
            });

        if (window.__unloadNavigator) {
            window.removeEventListener("unload", window.__unloadNavigator);
        }
    }

    function findEffectiveActiveElement() {
        var activeElement = document.activeElement;
        while (activeElement.shadowRoot && activeElement.shadowRoot.activeElement) {
            activeElement = activeElement.shadowRoot.activeElement;
        }
        return activeElement;
    }

    function handleFocus() {
        var oldActiveElement = findEffectiveActiveElement();
        var quirks = context.quirks;
        var isReactSelectElement = quirks && quirks.isReactSelect;
        var isCKEditorFrame = quirks && quirks.isCKEditorFrame;
        if (!isReactSelectElement && !isCKEditorFrame) {
            dispatchFocus(eventData.elementToFocusLocatedElement, oldActiveElement);
        }
    }

    function handleSelect() {
        if(context.element.tagName !== OPTION_TAG_NAME) {
            return;
        }

        var selectEl;
        if(context.element.parentElement.tagName === SELECT_TAG_NAME) {
            selectEl = context.element.parentElement;
        } else if(context.element.parentElement.parentElement.tagName === SELECT_TAG_NAME) {
            selectEl = context.element.parentElement.parentElement;
        }
        selectEl.blur();
        selectEl.selectedIndex = 0;
        context.element.selected = true;
    }

    function fulfill(success, status, result) {
        result = result || {};
        var status = {
            success: success,
            status: status,
            result: result,
        };

        if(isDoneFnSupplied) {
            return done(status);
        }

        return status;
    }

    function resolve(result) {
        return fulfill(true, 'done', result);
    }

    function reject(result) {
        return fulfill(false, 'failed', result);
    }

    var OPTION_TAG_NAME = "OPTION";
    var SELECT_TAG_NAME = "SELECT";

    var MOUSE_EVENTS = ["auxclick", "click", "contextmenu", "dblclick", "mousedown", "mouseenter", "mouseleave", "mousemove", "mouseover", "mouseout", "mouseup", "pointerlockchange", "pointerlockerror", "select", "wheel",];
    var POINTER_EVENTS = ["pointerover", "pointerenter", "pointerdown", "pointermove", "pointerup", "pointercancel", "pointerout", "pointerleave", "gotpointercapture", "lostpointercapture",];
    var FOCUS_EVENTS = ["focus", "blur", "focusin", "focusout",];
    var KEYBOARD_EVENTS = ["keydown", "keypress", "keyup",]; // future use

    var isEventConstructorSupported = typeof Event === 'function';
    var isDoneFnSupplied = typeof done !== 'undefined';

    window.__unloadNavigator = resolve;
    window.addEventListener("unload", window.__unloadNavigator);

    var element = eventData.isRoot ? document.documentElement : getLocatedElement(eventData.locatedElement);
    if (!element) {
        return reject("element not found");
    }

    var context = {
        element: element,
        events: eventData.events,
        quirks: eventData.quirks,
        modifiers: eventData.modifiers,
    };

    try {
        var doMousePreparation = eventData.withMousePreparation ? eventData.withMousePreparation : true;
        if(doMousePreparation) {
            dispatchMouseOver();
            dispatchMouseMove();
        }
        handleSelect();
        dispatchSyncEventSequence();
        handleFocus();
        return resolve();
    } catch (e) {
        return reject(e.toString());
    }
};

module.exports = dispatchEvents;

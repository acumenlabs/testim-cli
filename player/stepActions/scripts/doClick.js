/* globals getLocatedElement, dispatchFocus */

'use strict';

var doClick = function (eventData, done) {
    var eventConstructorSupported = typeof Event === 'function';

    window.__unloadNavigator = resolve;

    window.addEventListener("unload", window.__unloadNavigator);

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

    function getParents(el) {
        return el ? [el].concat(getParents(el.parentNode)) : [];
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

        done(status);
    }

    function dispatchMouseOver(element) {
        var event = eventConstructorSupported ? new Event("mouseover", { composed: true }) : document.createEvent('Events');
        event.initEvent('mouseover', true, true);
        element.dispatchEvent(event);
    }

    function dispatchMouseMove(element) {
        var modifiers = {};
        var rect = element.getBoundingClientRect();
        var clientX = rect.left + (rect.width / 2);
        var clientY = rect.top + (rect.height / 2);
        var button = 0;
        var eventType = 'mousemove';
        var event = createMouseEvent(eventType, modifiers, clientX, clientY, button);
        element.dispatchEvent(event);
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

    function getEventDictionary(modifiers, clientX, clientY) {
        return {
            screenX: 0,
            screenY: 0,
            clientX: clientX,
            clientY: clientY,
            ctrlKey: Boolean(modifiers.ctrl),
            altKey: Boolean(modifiers.alt),
            shiftKey: Boolean(modifiers.shift),
            metaKey: Boolean(modifiers.meta),
            bubbles: true,
            cancelable: true,
            composed: true
        };
    }

    function createPointerEvent(eventType, modifiers, clientX, clientY) {
        if (!window.PointerEvent) {
            return;
        }
        var eventProperties = getEventDictionary(modifiers, clientX, clientY);
        eventProperties.pointerType = "mouse";
        eventProperties.isPrimary = true;
        return new window.PointerEvent(eventType, eventProperties);
    }

    function createMouseEvent(eventType, modifiers, clientX, clientY, button) {
        var event = eventConstructorSupported ? new MouseEvent("click", { composed: true }) : document.createEvent("MouseEvents");
        event.initMouseEvent(
            eventType,
            true, /* bubbles */
            true, /* cancelable */
            document.defaultView, /* view */
            1, /* detail */
            0, /* screenX */
            0, /* screenY */
            clientX, /* clientX */
            clientY, /* clientY */
            Boolean(modifiers.ctrl), /* ctrl */
            Boolean(modifiers.alt), /* alt */
            Boolean(modifiers.shift), /* shift */
            Boolean(modifiers.meta), /* meta */
            button, /* button */
            document.body ? document.body.parentNode : document.documentElement);
        return event;
    }

    function getMouseEvent(userEvent, context) {
        var pointerEvents = ["pointerup", "pointerdown", "pointermove"];
        var modifiers = context.modifiers || {};
        var pos = getEventPosition(userEvent, context.element);
        var button = context.button || 0;
        var eventType = userEvent.event;
        if (pointerEvents.indexOf(eventType) > -1) {
            return createPointerEvent(eventType, modifiers, pos.x, pos.y);
        }
        return createMouseEvent(eventType, modifiers, pos.x, pos.y, button);
    }

    function executeSyncEvent(event) {
        context.element.dispatchEvent(event);
        handleReactSelectFocusQuirk(context, event);
        handleCKEditorQuirk(context, event);
    }

    function findEffectiveActiveElement() {
        var activeElement = document.activeElement;
        while (activeElement.shadowRoot && activeElement.shadowRoot.activeElement) {
            activeElement = activeElement.shadowRoot.activeElement;
        }
        return activeElement;
    }

    function executeSynchronousEventSequence(context) {
        context.events
            .map(function (userEvent) {
                try {
                    return getMouseEvent(userEvent, context);
                } catch (e) {
                    // pointer events not supported in ie11
                    return;
                }
            })
            .filter(Boolean)
            .forEach(function (event) {executeSyncEvent(event);});

        if (window.__unloadNavigator) {
            window.removeEventListener("unload", window.__unloadNavigator);
        }
    }

    var element = eventData.isRoot ? document.documentElement : getLocatedElement(eventData.locatedElement);
    var context = {
        element: element,
        events: eventData.events,
        quirks: eventData.quirks,
        modifiers: eventData.modifiers,
        button: eventData.button
    };

    if (!context.element) {
        return reject("element not found");
    }

    dispatchMouseOver(context.element);
    dispatchMouseMove(context.element);
    try {
        executeSynchronousEventSequence(context);
        var oldActiveElement = findEffectiveActiveElement();
        var quirks = context.quirks;
        var isReactSelectElement = quirks && quirks.isReactSelect;
        var isCKEditorFrame = quirks && quirks.isCKEditorFrame;
        if (!isReactSelectElement && !isCKEditorFrame) {
            dispatchFocus(eventData.elementToFocusLocatedElement, oldActiveElement);
        }
        resolve();
    } catch (e) {
        return reject(e.toString());
    }
};

module.exports = doClick;

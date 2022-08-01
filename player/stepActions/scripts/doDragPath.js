"use strict";


var doDragPath = function (eventData, done) {
    var eventConstructorSupported = typeof Event === 'function';
    var pointerEventConstructorSupported = typeof PointerEvent === 'function';
    var MAX_EVENT_TIMEOUT = 40; //max msec between events

    window.__unloadNavigator = resolve;

    window.addEventListener("unload", window.__unloadNavigator);

    function resolve(result) {
        var status = {
            status: 'done',
            result: result,
            success: true
        };
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
        if (context.isDrag) {
            return { x: pointerPosition.originX || 0, y: pointerPosition.originY || 0 };
        }
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

    function createPointerEvent(eventType, modifiers, clientX, clientY, button) {
        if (pointerEventConstructorSupported) {
            var eventProperties = getEventDictionary(modifiers, clientX, clientY);
            eventProperties.pointerType = "mouse";
            eventProperties.isPrimary = true;
            return new window.PointerEvent(eventType, eventProperties);

        } else {
            var event = document.createEvent("PointerEvent");
            event.initPointerEvent(
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
                document.body ? document.body.parentNode : document.documentElement,
                0, /* offsetYArg */
                0, /* offsetXArg */
                0, /* widthArg */
                0, /* heightArg */
                0, /* pressure */
                0, /* rotation */
                0, /* tiltX */
                0, /* tiltY */
                0, /* pointerIdArg */
                "mouse", /* pointerType */
                0, /* hwTimestampArg */
                true) /* isPrimary */

            return event;
        }
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
            return createPointerEvent(eventType, modifiers, pos.x, pos.y, button);
        }
        return createMouseEvent(eventType, modifiers, pos.x, pos.y, button);
    }

    function shouldSkipEvent(currentEvent, context) {
        function isClickInDragAndDrop() {
            return currentEvent.event === 'click' &&
                context.isDrag &&
                !context.allEventsOnSameElement;
        }
        return isClickInDragAndDrop();
    }

    function executeAsyncNextEventRecursive(index, context, done){
        try {
            var event = getMouseEvent(context.events[index], context);
            if (!shouldSkipEvent(event, context)) {
                context.element.dispatchEvent(event);
            }
        } catch(ignore) {}

        if (index + 1 === context.events.length) {
            done();
        } else {
            var delay = Math.min(context.events[index+1].timeStamp - context.events[index].timeStamp, MAX_EVENT_TIMEOUT);
            setTimeout(function() {
                executeAsyncNextEventRecursive(index+1, context, done);
            }, delay);
        }
    }

    function executeAsyncEventSequence(context, done) {
        executeAsyncNextEventRecursive(0, context, function() {

            if (window.__unloadNavigator) {
                window.removeEventListener("unload", window.__unloadNavigator);
            }
            done();
        });
    }

    var element = eventData.isRoot ? document.documentElement : getLocatedElement(eventData.locatedElement);

    var context = {
        eventIndex: 0,
        element: element,
        events: eventData.events,
        eventType: eventData.eventType,
        eventData: eventData.eventData,
        stepId: eventData.id,
        testResultId: eventData.testResultId,
        quirks: eventData.quirks,
        isDoubleClick: eventData.isDoubleClick,
        isDrag: eventData.isDrag,
        useRecordedMousedown: eventData.useRecordedMousedown,
        trackActiveElement: eventData.trackActiveElement,
        allEventsOnSameElement: eventData.allEventsOnSameElement,
    };

    if (!context.element) {
        return reject("element not found");
    }

    dispatchMouseOver(context.element);
    dispatchMouseMove(context.element);

    executeAsyncEventSequence(context, function() {
        resolve();
    });

};

module.exports = doDragPath;

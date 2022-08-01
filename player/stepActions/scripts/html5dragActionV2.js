/* global getLocatedElement */

'use strict';

var html5dndAction = function (eventData, done) {
    var mouseEventConstructorSupported = typeof MouseEvent === 'function';
    var dragEventConstructorSupported = typeof DragEvent === 'function';
    var pointerEventConstructorSupported = typeof PointerEvent === 'function';
    var data = {};

    window.__unloadNavigator = resolve;

    window.addEventListener("unload", window.__unloadNavigator);

    function resolve(result) {
        var status = {
            status: 'done',
            result: result,
            success: true,
        };
        done(status);
    }

    function reject(result) {
        result = result || {};
        var status = {
            status: 'failed',
            result: result,
            success: false,
            keep: true,
        };

        done(status);
    }

    function convertType(type) {
        if (!type || !type.toLowerCase) {
            return type;
        }
        type = type.toLowerCase();
        if (type === 'text') {
            return 'text/plain';
        }
        if (type === 'url') {
            return 'text/uri-list'
        }
        return type;
    }

    function createDataTransfer() {
        try {
            return new DataTransfer();
        } catch (err) {
            return {
                data: {},
                setData: function (type, val) {
                    data[convertType(type)] = val;
                },
                getData: function (type) {
                    return data[convertType(type)];
                }
            };
        }
    }

    const dragFromElementEvents = ['drag', 'dragstart', 'dragend'];
    const pointerEvents = ['pointerup', 'pointerdown', 'pointermove'];
    const dragEvents = dragFromElementEvents.concat(['drop', 'dragenter', 'dragover']);

    function findClosestDraggable(element) {
        // drag events are always fired on the closest element with draggable=true
        // rather than on the target mouse element - so when dispatching a drag
        // event we need to fire the correct target
        var current = element;
        while (current && current !== document.documentElement) {
            if (current.draggable) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    function getElement(event, context, currentEvent) {
        const element = context.element;
        const dispatchDragEventsOnClosestDraggable = currentEvent.dispatchDragEventsOnClosestDraggable;
        if (dragFromElementEvents.indexOf(event.type) > -1 && dispatchDragEventsOnClosestDraggable) {
            if (!element && context.lastDraggedElement) {
                // fallback for elements being removed from DOM, but parent draggable still being there
                return context.lastDraggedElement;
            }

            const draggable = findClosestDraggable(element);
            if (draggable) {
                context.lastDraggedElement = draggable;
                return draggable;
            }
        }
        return element;
    }

    function getEventPosition(userEvent, isDrag, element) {
        function isWithinBounds(start, end, point) {
            return (point > start) && (point < end);
        }

        var pointerPosition = userEvent.pointerPosition || {};
        // Technically should always be true here.
        if (isDrag) {
            return { x: pointerPosition.originX || 0, y: pointerPosition.originY || 0 };
        }
        var rect = element.getBoundingClientRect();
        var clientX = pointerPosition.originX && isWithinBounds(rect.left, rect.left + rect.width, pointerPosition.originX) ? pointerPosition.originX : rect.left + (rect.width / 2);
        var clientY = pointerPosition.originY && isWithinBounds(rect.top, rect.top + rect.height, pointerPosition.originY) ? pointerPosition.originY : rect.top + (rect.height / 2);
        return { x: clientX, y: clientY };
    }

    function getMouseEvent(userEvent, eventData, context) {
        const modifiers = (eventData && eventData.modifiers) || {};
        const pos = getEventPosition(userEvent, context.isDrag, context.element);
        const button = (eventData && eventData.button) || 0;
        const eventType = userEvent.event;
        if (pointerEvents.indexOf(eventType) > -1) {
            return createPointerEvent(eventType, modifiers, pos.x, pos.y, button);
        }
        if (dragEvents.indexOf(eventType) > -1) {
            return createDragEvent(eventType, modifiers, pos.x, pos.y, button);
        }
        return createMouseEvent(eventType, modifiers, pos.x, pos.y, button);
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

        }
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

    function createMouseEvent(eventType, modifiers, clientX, clientY, button) {
        var event = mouseEventConstructorSupported ? new MouseEvent("click", { composed: true }) : document.createEvent("MouseEvents");
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

    function createDragEvent(eventType, modifiers, clientX, clientY) {
        if (eventType === 'dragstart') {
            if (!window.TSTA) {
                window.TSTA = {};
            }
            window.TSTA.dataTransfer = createDataTransfer();
        }

        if (!dragEventConstructorSupported) {
            const event = document.createEvent("CustomEvent");
            event.initCustomEvent(eventType, true, true, null);
            event.dataTransfer = window.TSTA.dataTransfer;
            return event;
        }

        const eventProperties = getEventDictionary(modifiers, clientX, clientY);
        const event = new window.DragEvent(eventType, eventProperties);
        Object.defineProperties(event, {
            dataTransfer: { get: function () { return window.TSTA.dataTransfer } },
        });
        return event;
    }

    function executeAsyncEvent(event, context, currentEvent) {
        const element = getElement(event, context, currentEvent);
        if (element) {
            element.dispatchEvent(event);
        }
    }

    function shouldSkipEvent(currentEvent, context) {
        function isClickInDragAndDrop() {
            return currentEvent.event === 'click' &&
                context.isDrag &&
                !context.allEventsOnSameElement;
        }
        return isClickInDragAndDrop();
    }

    function nextAsyncEvent(context, currentEvent, nextEvent) {
        if (nextEvent) {
            var delay = Math.min(nextEvent.timeStamp - currentEvent.timeStamp, 40);
            setTimeout(function () {
                executeAsyncNext(context);
            }, delay);
        } else {
            if (window.__unloadNavigator) {
                window.removeEventListener('unload', window.__unloadNavigator);
            }
            resolve();
        }
    }

    function executeAsyncNext(context) {
        var event;
        const currentEvent = context.events[context.eventIndex];
        // eslint-disable-next-line no-param-reassign
        const nextEvent = context.events[++context.eventIndex];
        try {
            context.element = getLocatedElement(currentEvent.locatedElement);
            event = getMouseEvent(currentEvent, eventData, context);
        } catch (err) {
            return reject('exception in get event in drag step:' + err.message);
        }

        if (shouldSkipEvent(currentEvent, context)) {
            return nextAsyncEvent(context, currentEvent, nextEvent);
        }

        if (event) {
            try {
                executeAsyncEvent(event, context, currentEvent);
            } catch (err) {
                return reject('exception in executeEvent in drag step:' + err.message);
            }
        } else {
            return reject('cannot execute event ' + currentEvent.event);
        }
        nextAsyncEvent(context, currentEvent, nextEvent);
        return undefined;
    }

    const context = {
        eventIndex: 0,
        allEventsOnSameElement: eventData.allEventsOnSameElement,
        events: eventData.events,
        eventType: eventData.eventType,
        eventData: eventData.eventData,
        stepId: eventData.id,
        testResultId: eventData.testResultId,
        isDrag: eventData.isDrag,
        useRecordedMousedown: eventData.useRecordedMousedown,
        trackActiveElement: eventData.trackActiveElement,
    };

    setTimeout(function () {
        try {
            executeAsyncNext(context);
        } catch (err) {
            reject(err);
        }
    }, 0);

};
module.exports = html5dndAction;

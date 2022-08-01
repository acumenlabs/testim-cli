"use strict";
/*global WheelEvent */
var wheel = function (eventData, done) {
    var MAX_WHEEL_EVENT_TIMEOUT = 200;

    function getEventPosition(userEvent, element) {
        function isWithinBounds(start, end, point) {
            return (point > start) && (point < end);
        }
        var pointerPosition = userEvent.pointerPosition || {};
        var rect = element.getBoundingClientRect();
        var clientX = pointerPosition.originX && isWithinBounds(rect.left, rect.left + rect.width, pointerPosition.originX) ? pointerPosition.originX : rect.left + (rect.width/2);
        var clientY = pointerPosition.originY && isWithinBounds(rect.top,  rect.top + rect.height, pointerPosition.originY) ? pointerPosition.originY : rect.top + (rect.height/2);
        return {x: clientX, y: clientY};
    }

    function getWheelEvent(userEvent, eventData, element) {
        var isIE = (navigator.appVersion.indexOf('Trident/') > 0) || (navigator.userAgent.indexOf('MSIE') !== -1);
        return isIE ?
            getWheelEventIE(userEvent, eventData, element) :
            getWheelEventNonIE(userEvent, eventData, element);
    }

    function getWheelEventIE(userEvent, eventData, element) {
        var pos = getEventPosition(userEvent, element);
        var modifiers = (eventData && eventData.modifiers) || {};
        var modifiersString = Object.keys(modifiers).join(" ");
        var event = document.createEvent('WheelEvent');
        event.initWheelEvent('wheel', true, true, window, 0, 0, 0, pos.x, pos.y, 0, null, modifiersString, userEvent.deltaX, userEvent.deltaY, userEvent.deltaZ, userEvent.deltaMode);
        return event;
    }

    function getWheelEventNonIE(userEvent, eventData, element) {
        var pos = getEventPosition(userEvent, element);
        var modifiers = (eventData && eventData.modifiers) || {};
        var dict = {
            deltaX: userEvent.deltaX,
            deltaY: userEvent.deltaY,
            deltaZ: userEvent.deltaZ,
            deltaMode: userEvent.deltaMode,
            clientX: pos.x,
            clientY: pos.y,
            bubbles: true,
            cancelable: true,
            ctrl: Boolean(modifiers.ctrl),
            alt: Boolean(modifiers.alt),
            shift: Boolean(modifiers.shift),
            meta: Boolean(modifiers.meta)
        };
        return new WheelEvent('wheel', dict);
    }

    function executeEvents(events, element) {
        if (events.length === 0) {
            return done({state: "success"});
        }
        if (!element) {
            throw new Error('element not found');
        }

        var event = events.shift();
        var currentEvent = getWheelEvent(event, eventData.eventData, element);
        var timeout = events[0] ? Math.min(events[0].timeStamp - event.timeStamp, MAX_WHEEL_EVENT_TIMEOUT) : MAX_WHEEL_EVENT_TIMEOUT;
        element.dispatchEvent(currentEvent);
        setTimeout(function () {
            executeEvents(events, element);
        }, timeout);
    }

    var element = getLocatedElement(eventData.locatedElement);
    executeEvents(eventData.events, element);
};

module.exports = wheel;

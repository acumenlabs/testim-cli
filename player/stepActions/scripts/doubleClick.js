var doubleClick = function (eventData, done) {
    var POINTER_EVENTS = ["pointerup", "pointerdown", "pointermove"];
    var element = getLocatedElement(eventData.locatedElement);

    if (!element) {
        throw new Error('element not found');
    }
    var events = eventData.events;

    var successObject = {
        status: 'done',
        success: true
    };

    window.__unloadNavigator = function () { done(successObject); };

    var getEventPosition = function(userEvent) {
        function isWithinBounds(start, end, point) {
            return (point > start) && (point < end);
        }

        var pointerPosition = userEvent.pointerPosition || {};
        var rect = element.getBoundingClientRect();
        var clientX = pointerPosition.originX && isWithinBounds(rect.left, rect.left + rect.width, pointerPosition.originX) ? pointerPosition.originX : rect.left + (rect.width / 2);
        var clientY = pointerPosition.originY && isWithinBounds(rect.top, rect.top + rect.height, pointerPosition.originY) ? pointerPosition.originY : rect.top + (rect.height / 2);
        return {x: clientX, y: clientY};
    };

    var getPointerEventDictionary = function(clientX, clientY) {
        return {
            screenX: 0,
            screenY: 0,
            clientX: clientX,
            clientY: clientY,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerType: "mouse",
            isPrimary: true
        };
    };

    var createPointerEvent = function(eventType, clientX, clientY) {
        if (!window.PointerEvent) {
            return;
        }
        var eventProperties = getPointerEventDictionary(clientX, clientY);
        return new window.PointerEvent(eventType, eventProperties);
    };

    var createMouseEvent = function(eventType, clientX, clientY) {
        var event = document.createEvent("MouseEvents");
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
            false, /* ctrl */
            false, /* alt */
            false, /* shift */
            false, /* meta */
            0, /* button */
            document.body ? document.body.parentNode : document.documentElement);
        return event;
    };

    var findEffectiveActiveElement = function() {
        var activeElement = document.activeElement;
        while (activeElement.shadowRoot && activeElement.shadowRoot.activeElement) {
            activeElement = activeElement.shadowRoot.activeElement;
        }
        return activeElement;
    }

    var getEvent = function (userEventData) {
        var pos = getEventPosition(userEventData);
        var eventType = userEventData.event;
        if (POINTER_EVENTS.indexOf(eventType) !== -1) {
            return createPointerEvent(eventType, pos.x, pos.y);
        }
        return createMouseEvent(eventType, pos.x, pos.y);
    };
    try {
        events
            .map(function (userEventData) {return getEvent(userEventData);})
            .filter(Boolean)
            .forEach(function (event) {return element.dispatchEvent(event);});
        var oldActiveElement = findEffectiveActiveElement();
        dispatchFocus(eventData.elementToFocusLocatedElement, oldActiveElement);
        if (window.__unloadNavigator) {
            window.removeEventListener("unload", window.__unloadNavigator);
            window.__unloadNavigator = null;
        }
        done(successObject);
    } catch (e) {
        if (window.__unloadNavigator) {
            window.removeEventListener("unload", window.__unloadNavigator);
            window.__unloadNavigator = null;
        }
        done({
            status: 'done',
            result: e.toString(),
            success: false
        });
    }
};

module.exports = doubleClick;

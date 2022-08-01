module.exports = function dispatchFocus(targetElement, oldActiveElement) {
    function createFocusEvent(eventName) {
        var event = document.createEvent("HTMLEvents");
        // TODO we want to use new Event, but mootools (used by zuora which is used by jfrog)
        //  overrides window.Event and throws an error
        event.initEvent(eventName, true, false);
        return event;
    }

    function findEffectiveActiveElement() {
        var activeElement = document.activeElement;
        while (activeElement.shadowRoot && activeElement.shadowRoot.activeElement) {
            activeElement = activeElement.shadowRoot.activeElement;
        }
        return activeElement;
    }

    function setFocus(element, oldActiveElement) {
        if (oldActiveElement) {
            oldActiveElement.dispatchEvent(createFocusEvent('focusout'));
            oldActiveElement.dispatchEvent(createFocusEvent('blur'));
        }
        element.dispatchEvent(createFocusEvent('focusin'));
        element.dispatchEvent(createFocusEvent('focus'));
        if (typeof element.focus === 'function') {
            element.focus();
        }
        var currentActiveElement = findEffectiveActiveElement();
        if (oldActiveElement && currentActiveElement === oldActiveElement) {
            if (typeof oldActiveElement.blur === 'function') {
                oldActiveElement.blur();
            }
        }
    }

    if (targetElement) {
        var elementToFocus = getLocatedElement(targetElement);
        if (elementToFocus && (elementToFocus !== oldActiveElement)) {
            try {
                setFocus(elementToFocus, oldActiveElement);
            } catch (e) {
                // ignore
            }
        }
    } else {
        if (oldActiveElement && typeof oldActiveElement.blur === 'function') {
            oldActiveElement.blur();
        }
    }
};

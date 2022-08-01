/* eslint-disable no-restricted-syntax */ // This code only runs in Safari, not in IE.
module.exports = function (locatedElement, dispatchEventOnSelectElement) {
    function closest(el, selectors) {
        var originalMatches = Element.prototype.matches;
        /* eslint-disable-next-line no-proto, no-undef */ // Some customers override the native Element prototype, so we need to create a new one if they messed it up.
        var matches = originalMatches && isNativeFunction(originalMatches) ? originalMatches : document.createElement(el.tagName).__proto__.matches;
        do {
            if (matches.call(el, selectors)) return el;
            el = el.parentElement || el.parentNode;
        } while (el !== null && el.nodeType === 1);
        return null;
    }

    try {
        /* eslint-disable-next-line no-undef */ // This code depends on pre-injecting this function as well.
        var optionEl = getLocatedElement(locatedElement);
        if (!optionEl) {
            return { success: false, status: 'failed', result: 'option element not found' };
        }

        var selectEl = closest(optionEl, 'select');
        if (!selectEl) {
            return { success: false, status: 'failed', result: 'select element not found' };
        }
        selectEl.focus();
        if (optionEl.selected) {
            return { success: true, status: 'done' };
        }
        optionEl.selected = true;

        var events = [
            'input',
            'change',
        ];
        events.map((userEvent) => {
            var event = document.createEvent('HTMLEvents');
            event.initEvent(userEvent, true, false);
            return event;
        }).forEach((event) => {
            if (dispatchEventOnSelectElement) {
                selectEl.dispatchEvent(event);
                return;
            }
            optionEl.dispatchEvent(event);
        });

        return { success: true, status: 'done' };
    } catch (err) {
        return { success: false, status: 'failed', result: err.toString() };
    }
};

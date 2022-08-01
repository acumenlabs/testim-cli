/* globals getLocatedElement, elementScrollTo */

'use strict';

var scroll = function (elementToScrollOn, elementToScrollTo, isScrollToElement, isDynamicScroll, expectedX, expectedY, shouldScrollLeft, shouldScrollTop) {
    function doScroll(expectedPosition, element) {
        if (!element) {
            return { success: false };
        }

        elementScrollTo(element, expectedPosition.x, expectedPosition.y);

        var actualX = element.scrollLeft;
        var actualY = element.scrollTop;

        var success = (Math.abs(actualY - expectedPosition.y) < 1) && (Math.abs(actualX - expectedPosition.x) < 1);
        return { success: success, actualX: actualX, actualY: actualY };
    }

    function getExpectedPosition(parentElement, locatedElement, isScrollToElement, expectedX, expectedY, shouldScrollLeft, shouldScrollTop) {
        if (!isScrollToElement) {
            return { x: expectedX, y: expectedY };
        }

        var target = getLocatedElement(locatedElement);

        if (isDynamicScroll && !target) {
            return { x: parentElement.scrollWidth, y: parentElement.scrollHeight };
        }

        if (!target) {
            throw new Error('could not find target element');
        }

        var targetRect = target.getBoundingClientRect();


        var yScroll = 0,
            xScroll = 0,
            MAX_HEIGHT = Math.max(window.innerHeight - (targetRect.height + 10), 0),
            MAX_WIDTH = Math.max(window.innerWidth - (targetRect.width + 10), 0);

        yScroll = shouldScrollTop
            ? parentElement.scrollTop + targetRect.top - Math.min(expectedY, MAX_HEIGHT)
            : parentElement.scrollTop;

        xScroll = shouldScrollLeft
            ? parentElement.scrollLeft + targetRect.left - Math.min(expectedX, MAX_WIDTH)
            : parentElement.scrollLeft;

        return { x: Math.round(xScroll), y: Math.round(yScroll) };
    }

    var isDocument = !elementToScrollOn;
    var elementToScrollOn = !isDocument ? getLocatedElement(elementToScrollOn) : (document.scrollingElement || document.documentElement);

    if (!elementToScrollOn) {
        throw new Error('could not find target to scroll on');
    }
    var positionBeforeScroll = { top: elementToScrollOn.scrollTop, left: elementToScrollOn.scrollLeft };
    var expectedPosition = getExpectedPosition(elementToScrollOn, elementToScrollTo, isScrollToElement, expectedX, expectedY, shouldScrollLeft, shouldScrollTop);

    var result = doScroll(expectedPosition, elementToScrollOn);

    if (isDocument && (!document.scrollingElement) && (!result.success) && (positionBeforeScroll.top === elementToScrollOn.scrollTop) && (positionBeforeScroll.left === elementToScrollOn.scrollLeft)) {
        elementToScrollOn = document.body;
        expectedPosition = getExpectedPosition(elementToScrollOn, elementToScrollTo, isScrollToElement, expectedX, expectedY, shouldScrollLeft, shouldScrollTop);
        result = doScroll(expectedPosition, elementToScrollOn);
    }

    var actualXString = result.actualX;
    var actualYString = result.actualY;
    var actualScrollToElement = getLocatedElement(elementToScrollTo);

    if (isScrollToElement && isDynamicScroll && !actualScrollToElement) {
        return { success: false, expectedPosition: expectedPosition };
    }

    if (isScrollToElement) {
        if (!actualScrollToElement) {
            throw new Error('could not find target to scroll to');
        }
        var rect = actualScrollToElement.getBoundingClientRect();
        actualXString = rect.left;
        actualYString = rect.top;
    }
    return { success: result.success, actualX: actualXString, actualY: actualYString };
};

module.exports = scroll;

"use strict";
const StepAction = require('./stepAction');
const { codeSnippets, commonConstants } = require('../../commons/getSessionPlayerRequire');
const scroll = require('./scripts/scroll');
const constants = commonConstants.stepResult;

class ScrollStepAction extends StepAction {

    getFailureString(step, expectedX, expectedY, actualX, actualY){
        if (!step.isScrollToElement) {
            return `Scrolling limit reached. Expected:(y: ${expectedY}, x: ${expectedX}); Actual:(y:${actualY}, x: ${actualX})`;
        }
        let failureMessage = "Scrolling limit reached";
        if (step.shouldScrollTop) {
            failureMessage += `. Expected top margin: ${expectedY}, actual: ${actualY}`;
        }
        if (step.shouldScrollLeft) {
            failureMessage += `. Expected left margin: ${expectedX}, actual: ${actualX}`;
        }
        return failureMessage;
    }

    scroll(elementToScrollTo, step, elementToScrollOn) {
        const expectedY = Math.round(Number(step.isScrollToElement ? step.marginTop : step.y));
        const expectedX = Math.round(Number(step.isScrollToElement ? step.marginLeft : step.x));

        // in Firefox setting scrollTop and scrollLeft propeties simultaneously takes only the lates,
        const elementScrollTo = this.driver.isFirefox() ? function (element, x, y) {
            element.scrollTo(x, y);
        } : function (element, x, y) {
            element.scrollTop = y;
            element.scrollLeft = x;
        };
        const scrollCode = `
            var getLocatedElement = ${codeSnippets.getLocatedElementCode};
            var elementScrollTo = ${elementScrollTo.toString()};
            var scroll = ${scroll.toString()};
            return scroll.apply(null, arguments)
        `;

        return this.driver.executeJSWithArray(scrollCode, [elementToScrollOn, elementToScrollTo, Boolean(step.isScrollToElement), Boolean(step.isDynamicScroll), expectedX, expectedY, step.shouldScrollLeft, step.shouldScrollTop])
            .then((res) => {
                if(!res || !res.value) {
                    return {
                        errorType: constants.SCROLL_ACTION_FAILURE,
                        success: false,
                    }
                }

                const {success, actualX, actualY} = res.value;

                if(success) {
                    return {success: true};
                }

                return {
                    errorType: constants.SCROLL_ACTION_FAILURE,
                    success: false,
                    resultInfo: {error: this.getFailureString(step, expectedX, expectedY, actualX, actualY)}
                };
            })
            .catch(() => {
                return {
                    errorType: constants.SCROLL_ACTION_FAILURE,
                    success: false,
                };
            });
    }

    scrollOnDocument(step, elementToScrollTo) {
        return this.scroll(elementToScrollTo, step);
    }

    scrollOnElement(step, elementToScrollTo) {
        return this.scroll(elementToScrollTo, step, this.getTarget().locatedElement);
    }

    execute() {
        const context = this.context;
        const step = this.step;
        const elementToScrollTo = step.isScrollToElement ? context.data.scrollToElement.locatedElement : null;

        return step.element.isDocument ?
            this.scrollOnDocument(step, elementToScrollTo) :
            this.scrollOnElement(step, elementToScrollTo);
    }

}

module.exports = ScrollStepAction;

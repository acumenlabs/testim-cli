const StepAction = require('./stepAction');
const Promise = require('bluebird');
const html5dndAction = require('./scripts/html5dragAction');
const html5dndActionV2 = require('./scripts/html5dragActionV2');
const doClickScript = require('./scripts/doClick');
const doDragPathScript = require('./scripts/doDragPath');
const dispatchFocus = require('./scripts/focusElement');
const { codeSnippets } = require('../../commons/getSessionPlayerRequire');
const featureFlagService = require('../../commons/featureFlags');
const _ = require('lodash');

class MouseStepAction extends StepAction {
    getDnDRectsAndOffsets(target, destTarget, clickOffset, toClickOffset) {
        const fromOffsets = this.stepActionUtils.getClickOffset(clickOffset, target.rectWithoutFrameOffset);
        const toOffsets = this.stepActionUtils.getClickOffset(toClickOffset, destTarget.rectWithoutFrameOffset);
        return {
            fromRect: target.rectWithoutFrameOffset,
            fromX: fromOffsets.xOffset,
            fromY: fromOffsets.yOffset,
            toRect: destTarget.rectWithoutFrameOffset,
            toX: toOffsets.xOffset,
            toY: toOffsets.yOffset,
        };
    }

    clickJs() {
        const step = this.step;
        const context = this.context;
        const target = context.data[step.targetId || 'targetId'];
        const timeout = context.data.timeToPlayStep + 3000;
        const events = step.events;

        if (!events || !events.length) {
            return Promise.resolve();
        }

        const eventMessage = {
            isRoot: target.isRoot,
            locatedElement: target.locatedElement,
            events,
            quirks: step.quirks,
            modifiers: step.modifiers,
            button: step.button,
        };

        const doClickCode = `
            var getLocatedElement = ${codeSnippets.getLocatedElementCode};
            var dispatchFocus = ${dispatchFocus.toString()};
            var doClick = ${doClickScript.toString()};
            var eventData = ${this.driver.isEdge() ? 'JSON.parse(arguments[0])' : 'arguments[0]'};
            var done = arguments[1];
            return doClick.call(null, eventData, done);
        `;

        // hack for Edge (17/18) which does not accept properties with negative (throws Unknown Error)
        // values between 0 and -1 -_-.
        const eventParam = this.driver.isEdge() ? JSON.stringify(eventMessage) : eventMessage;

        return this.driver.executeCodeAsync(doClickCode, timeout, eventParam)
            .then(result => {
                if (result.value && result.value.success) {
                    return Promise.resolve({ success: true });
                }
                return Promise.resolve({ success: false });
            })
            .catch(err => Promise.resolve({
                success: false,
                reason: err.message,
                exception: err,
            }));
    }

    isWithinBounds(start, end, point) {
        return (point > start) && (point < end);
    }

    getEventSequenceOffset() {
        const initialPosition = (this.step.events[0] || {}).pointerPosition;
        if (!initialPosition) {
            return { xOffset: 0, yOffset: 0 };
        }

        const target = this.context.data[this.step.targetId || 'targetId'];
        const targetElementRect = target.rectWithoutFrameOffset;
        const isXWithinBounds = this.isWithinBounds(targetElementRect.left, targetElementRect.left + targetElementRect.width, initialPosition.originX);
        const isYWithinBounds = this.isWithinBounds(targetElementRect.top, targetElementRect.top + targetElementRect.height, initialPosition.originY);
        const xOffset = isXWithinBounds ? 0 : targetElementRect.left + targetElementRect.width / 2 - initialPosition.originX;
        const yOffset = isYWithinBounds ? 0 : targetElementRect.top + targetElementRect.height / 2 - initialPosition.originY;
        return { xOffset, yOffset };
    }

    addOffsetToEvents(offsetFromElement) {
        this.step.events.forEach(event => {
            if (event && event.pointerPosition) {
                event.pointerPosition.originX += offsetFromElement.xOffset;
                event.pointerPosition.originY += offsetFromElement.yOffset;
            }
        });
    }

    generateEventOfType(baseEvent, type) {
        const cloneEvent = _.cloneDeep(baseEvent);
        cloneEvent.event = type;
        return cloneEvent;
    }

    fixAbsoluteDragEventSequence() {
        const downEvent = this.step.events.find(event => ['mousedown', 'pointerdown'].includes(event.event));
        if (downEvent) {
            const mousedownEventIndex = this.step.events.indexOf(downEvent);
            this.step.events.splice(mousedownEventIndex, 0, this.generateEventOfType(downEvent, 'mouseover'));
        }

        const { recordPointerMoveEvents = false } = this.context.project.defaults || {};
        const mouseUpEvent = this.step.events.find(event => event.event === 'mouseup') || (recordPointerMoveEvents && this.step.events.find(event => event.event === 'pointerup'));
        const lastMouseMoveEventIndex = _.findLastIndex(this.step.events, event => event.event === 'mousemove') || (recordPointerMoveEvents && _.findLastIndex(this.step.events, event => event.event === 'pointermove'));
        if (mouseUpEvent && lastMouseMoveEventIndex > 0 && !this.step.allEventsOnSameElement) {
            this.step.events.splice(lastMouseMoveEventIndex + 1, 0, this.generateEventOfType(mouseUpEvent, 'mouseover'));
        }

        if (this.step.isHTML5Drag && !this.step.toElement) {
            this.step.events = this.addDragendIfNeeded(this.step.events);
        }

        this.addOffsetToEvents(this.getEventSequenceOffset());
    }

    dragPathJs() {
        const step = this.step;
        const context = this.context;
        const target = context.data[step.targetId || 'targetId'];
        const timeout = context.data.timeToPlayStep + 3000;

        if (!this.step.events || !this.step.events.length) {
            return Promise.resolve();
        }

        this.fixAbsoluteDragEventSequence();

        const events = step.events;

        const eventMessage = {
            isRoot: target.isRoot,
            locatedElement: target.locatedElement,
            events,
            quirks: step.quirks,
            modifiers: step.modifiers,
            button: step.button,
            isDrag: true,
            allEventsOnSameElement: step.allEventsOnSameElement,
        };

        const doDragPathCode = `
            var getLocatedElement = ${codeSnippets.getLocatedElementCode};
            var dispatchFocus = ${dispatchFocus.toString()};
            var doDragPath = ${doDragPathScript.toString()};
            return doDragPath.apply(null, arguments);
        `;

        return this.driver.executeCodeAsync(doDragPathCode, timeout, eventMessage)
            .then(result => {
                if (result.value && result.value.success) {
                    return Promise.resolve({ success: true });
                }
                return Promise.resolve({ success: false });
            })
            .catch(err => Promise.resolve({
                success: false,
                reason: err.message,
                exception: err,
            }));
    }

    chooseAndRunAction() {
        const target = this.getTarget();
        const {
            locatedElement, seleniumElement, rectWithoutFrameOffset, rect,
        } = target;
        const { xOffset, yOffset } = this.stepActionUtils.getClickOffset(this.step.element.clickOffset, rectWithoutFrameOffset);

        // used for fallback native click
        const offsets = {
            frameOffset: {
                x: rect.left - rectWithoutFrameOffset.left,
                y: rect.top - rectWithoutFrameOffset.top,
            },
            rect: rectWithoutFrameOffset,
            clickOffset: { x: xOffset, y: yOffset },
        };
        // will skip left click and double click on Edge.
        const skipFileInputClick =
            (this.driver.isEdge() || featureFlagService.flags.skipFileInputClicks.isEnabled()) &&
            target.tagName === 'INPUT' &&
            (target.elementSymbol.includes('type="file"') ||
                target.elementSymbol.includes('type=\'file\'') ||
                target.elementSymbol.includes('type=file'));

        if (skipFileInputClick) {
            return Promise.resolve({
                keep: true,
                success: 'skipped',
                reason: 'Clicking on input type=file is disabled',
            });
        }

        if (this.step.isDoubleClick) {
            const eventData = {
                elementToFocusLocatedElement: target.elementToFocusLocatedElement,
                locatedElement,
                events: this.step.events,
                timeout: this.context.data.timeToPlayStep + 3000,
            };
            return this.driver.doubleClick(seleniumElement, eventData, offsets);
        }
        if (this.step.isDrag) {
            if (this.step.toElement) {
                const destTarget = this.context.data.toElement;
                if (this.step.isHTML5Drag) {
                    const isIE = this.driver.isIE();
                    if (!isIE && featureFlagService.flags.usePortedHtml5DragDrop.isEnabled()) {
                        const events = this.generateHTML5DragEventSequence();
                        const timeout = this.context.data.timeToPlayStep + 3000;
                        const target = this.context.data[this.step.targetId || 'targetId'];
                        const eventMessage = {
                            transactionId: `${this.context.testResultId}:${this.step.id}`,
                            id: this.step.id,
                            testResultId: this.context.testResultId,
                            eventType: this.step.type,
                            events,
                            eventData: {
                                modifiers: this.step.modifiers,
                                button: this.step.button,
                            },
                            quirks: this.step.quirks,
                            isDrag: this.step.isDrag,
                            useRecordedMousedown: this.step.useRecordedMousedown,
                            allEventsOnSameElement: this.step.allEventsOnSameElement,
                            elementToFocusLocatedElement: target.elementToFocusLocatedElement,
                            trackActiveElement: this.step.trackActiveElement,
                            locatedElement: target.locatedElement,
                            isRoot: target.isRoot,
                        };
                        // hack for Edge (17/18) which does not accept properties with negative (throws Unknown Error)
                        // values between 0 and -1 -_-.
                        const eventParam = this.driver.isEdge() ? JSON.stringify(eventMessage) : eventMessage;
                        const html5DNDCode = `
                        var getLocatedElement = ${codeSnippets.getLocatedElementCode};
                        var dnd = ${html5dndActionV2.toString()};
                        var eventData = ${this.driver.isEdge() ? 'JSON.parse(arguments[0])' : 'arguments[0]'};
                        var done = arguments[1];
                        return dnd.call(null, eventData, done);
                    `;
                        return this.driver.executeCodeAsync(html5DNDCode, timeout, eventParam);
                    }

                    const html5DNDCode = `
                        var getLocatedElement = ${codeSnippets.getLocatedElementCode};
                        var dnd = ${html5dndAction.toString()};
                        var eventData = ${this.driver.isEdge() ? 'JSON.parse(arguments[0])' : 'arguments[0]'};
                        return dnd.call(null, eventData);
                    `;

                    const eventMessage = { fromLocatedElement: locatedElement, toLocatedElement: destTarget.locatedElement };

                    // hack for Edge (17/18) which does not accept properties with negative (throws Unknown Error)
                    // values between 0 and -1 -_-.
                    const eventParam = this.driver.isEdge() ? JSON.stringify(eventMessage) : eventMessage;
                    return this.driver.executeJS(html5DNDCode, eventParam);
                }

                const rectsAndOffsets = this.getDnDRectsAndOffsets(target, destTarget, this.step.element.clickOffset, this.step.toElement.clickOffset);
                return this.driver.dragAndDrop(seleniumElement, destTarget.seleniumElement, rectsAndOffsets);
            }
            return this.dragPathJs();

            // This is the old way, which uses selenium action (AKA "native" drag).
            // return this.driver.drag(seleniumElement, rectWithoutFrameOffset, xOffset, yOffset, this.step.events);
        }
        const useRightClickJS = (this.driver.isSafari() || this.driver.isIE()) && this.step.button === 2;
        const forceNativeEvent = this.driver.isSafari() && target.tagName === 'SELECT';

        if (this.driver.isSafari() && forceNativeEvent) {
            // NOTE:
            // We want to skip click on SELECT elements because of a safari driver bug
            // that not allowing to set the selected option after this click.
            return Promise.resolve({
                keep: true, success: 'skipped', forceTreatAsWarning: true, reason: 'Safari does not support clicking on select elements',
            });
        }
        if (!forceNativeEvent && (!this.step.nativeEvents || useRightClickJS)) {
            return this.clickJs();
        }
        if (this.step.button === 2) {
            return this.driver.rightClick(seleniumElement, offsets);
        }
        return this.driver.leftClick(seleniumElement, offsets);
    }

    performAction() {
        return this.chooseAndRunAction()
            .then(res => {
                if (!res.status && res.value && res.value.keep) {
                    res = res.value;
                }
                if (res.keep) {
                    delete res.keep;
                    return res;
                }
                return undefined;
            });
    }

    addDragendIfNeeded(events) {
        if (events.find(event => event.event === 'dragend')) {
            return events;
        }
        const dragendDefaultEvent = {
            event: 'dragend',
            eventInfo: {
                detail: 0,
            },
            pointerPosition: this.getToElementPosition(),
        };
        return events.concat(dragendDefaultEvent);
    }

    getToElementPosition() {
        if (!(this.context.data && this.context.data.toElement && this.context.data.toElement.rect)) {
            return undefined;
        }
        const { rect } = this.context.data.toElement;
        return {
            originX: rect.left + (rect.width / 2),
            originY: rect.top + (rect.height / 2),
        };
    }

    addDragOverBeforeDragEnd(events) {
        const dropOrEndEventIndex = events.findIndex(e => ['dragend', 'drop'].includes(e.event));
        const oneBeforeLastEvent = events[dropOrEndEventIndex - 1];
        if (!oneBeforeLastEvent || (oneBeforeLastEvent.event !== 'dragover')) {
            const dragenterDefaultEvent = {
                event: 'dragover',
                eventInfo: {
                    detail: 0,
                },
                pointerPosition: this.getToElementPosition(),
                fireOnTarget: true,
            };
            events.splice(dropOrEndEventIndex, 0, dragenterDefaultEvent);
        } else {
            oneBeforeLastEvent.fireOnTarget = true;
        }
        return events;
    }

    fixEventSequence(events) {
        const withDragEnd = this.addDragendIfNeeded(events);
        return this.addDragOverBeforeDragEnd(withDragEnd);
    }

    addElementLocatedElementToDragEvents(events, fromElementLocatedElement, toElementLocatedElement) {
        const isOnToElement = e => e.fireOnTarget || ['drop', 'dragenter'].includes(e.event);
        events.forEach(event => (event.locatedElement = isOnToElement(event) ? toElementLocatedElement : fromElementLocatedElement));
        return events;
    }

    generateHTML5DragEventSequence() {
        const fromElement = this.context.data.targetId;
        const toElement = this.context.data.toElement;
        let events = this.step.events.filter(event => event.event !== 'mousemove' && event.event !== 'pointermove');
        events = this.fixEventSequence(events);
        events = this.addElementLocatedElementToDragEvents(events, fromElement.locatedElement, toElement.locatedElement);
        if (this.step.dispatchDragEventsOnClosestDraggable) {
            events.forEach(event => (event.dispatchDragEventsOnClosestDraggable = true));
        }
        return events;
    }
}

module.exports = MouseStepAction;

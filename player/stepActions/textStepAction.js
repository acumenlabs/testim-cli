'use strict';

const StepAction = require('./stepAction');
const setTextScript = require('./scripts/setText');
const Promise = require('bluebird');
const { codeSnippets } = require('../../commons/getSessionPlayerRequire');
const dispatchFocus = require('./scripts/focusElement');
const sessionPlayer = require('../../commons/getSessionPlayerRequire');
const { extractElementId } = require('../../utils');
const util = require('util');

const constants = sessionPlayer.commonConstants.stepResult;
const setTextDraftJs = codeSnippets && codeSnippets.setTextDraftJs;
const delay = util.promisify(setTimeout);
class TextStepAction extends StepAction {
    setValueNative() {
        const context = this.context;
        const target = this.getTarget();
        if (!this.step.delayBetweenChars) {
            return this.driver.setValue(target.seleniumElement, context.stepText);
        }

        return this.driver.elementIdClear(extractElementId(target.seleniumElement)).then(async () => await this.setTextDelayed());
    }

    setValueJS() {
        const step = this.step;
        const context = this.context;
        const target = context.data[step.targetId || 'targetId'];
        const timeout = context.data.timeToPlayStep + 3000;
        const events = step.events;

        if (target.isDraftEditor && setTextDraftJs) {
            return this.driver.executeJS(setTextDraftJs(target.locatedElement, context.stepText));
        }

        if (!events || !events.length) {
            return Promise.resolve();
        }

        const eventMessage = {
            eventType: step.type,
            events,
            quirks: step.quirks,
            locatedElement: target.locatedElement,
            isRoot: target.isRoot,
            elementToFocusLocatedElement: target.elementToFocusLocatedElement,
        };

        const setTextCode = `
            var getLocatedElement = ${codeSnippets.getLocatedElementCode};
            var dispatchFocus = ${dispatchFocus};
            var setText = ${setTextScript.toString()};
            var eventData = ${this.driver.isEdge() ? 'JSON.parse(arguments[0])' : 'arguments[0]'};
            var done = arguments[1];
            return setText.call(null, eventData, done);
        `;

        // hack for Edge (17/18) which does not accept properties with negative (throws Unknown Error)
        // values between 0 and -1 -_-.
        const eventParam = this.driver.isEdge() ? JSON.stringify(eventMessage) : eventMessage;

        return this.driver.executeCodeAsync(setTextCode, timeout, eventParam)
            .then(result => {
                if (result.value && result.value.success) {
                    return Promise.resolve({ success: true });
                }
                return Promise.resolve({ success: false });
            });
    }

    async setTextDelayed() {
        const letters = this.context.stepText;
        const target = this.getTarget();
        for (let i = 0; i < letters.length; i++) {
            await this.driver.elementIdValue(extractElementId(target.seleniumElement), letters[i]);
            // don't delay on last step.
            if (i < letters.length - 1) {
                await delay(this.step.delayBetweenChars);
            }
        }
    }

    setValueAppendNative() {
        const keys = [];
        const context = this.context;
        const target = this.getTarget();

        if (target && target.seleniumElement) {
            if (!this.step.delayBetweenChars) {
                keys.push(Array.from(context.stepText));
                return this.driver.elementIdValue(extractElementId(target.seleniumElement), keys);
            }

            return Promise.resolve(this.setTextDelayed());
        }
        return Promise.reject(new Error('missing selenium element'));
    }

    performAction() {
        const target = this.getTarget();
        const forceJsEvent = this.driver.isSafari() &&
            target.locatedElement && target.locatedElement.shadowPath &&
            Array.isArray(target.locatedElement.shadowPath) && target.locatedElement.shadowPath.length > 1;

        if (this.step.appendText) {
            if (this.step.nativeEvents) {
                return this.setValueAppendNative();
            }
            return Promise.resolve({
                success: false,
                errorType: constants.TEXT_ACTION_FAILURE,
                resultInfo: { error: "'Append Text' is only supported in Native Mode" },
            });
        }
        if (this.step.nativeEvents && !forceJsEvent) {
            return this.setValueNative();
        }
        return this.setValueJS();
    }
}

module.exports = TextStepAction;

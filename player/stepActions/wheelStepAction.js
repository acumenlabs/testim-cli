"use strict";
const Promise = require('bluebird');
const StepAction = require('./stepAction');
const wheelScript = require('./scripts/wheel');
const { codeSnippets } = require('../../commons/getSessionPlayerRequire');

class WheelStepAction extends StepAction {

    performAction() {
        const step = this.step;
        const context = this.context;
        const events = step.events;

        if (!events || !events.length) {
            return Promise.resolve();
        }

        const eventMessage = {
            events: events,
            eventData: {
                modifiers: step.modifiers,
                button: step.button
            },
            locatedElement: this.getTarget().locatedElement
        };

        const timeout = context.data.timeToPlayStep + 3000;

        const wheelCode = `
            var getLocatedElement = ${codeSnippets.getLocatedElementCode};
            var wheel = ${wheelScript.toString()};
            var eventData = ${this.driver.isEdge() ? `JSON.parse(arguments[0])` : `arguments[0]`};
            var done = arguments[1];
            return wheel.call(null, eventData, done);
        `;

        // hack for Edge (17/18) which does not accept properties with negative (throws Unknown Error)
        // values between 0 and -1 -_-.
        const eventParam = this.driver.isEdge() ? JSON.stringify(eventMessage) : eventMessage;

        return this.driver.executeCodeAsync(wheelCode, timeout, eventParam)
            .then(result => {
                if (result.value && result.value.state === "success") {
                    return Promise.resolve({ success: true });
                }
                return Promise.resolve({ success: false });
            });
    }

}

module.exports = WheelStepAction;


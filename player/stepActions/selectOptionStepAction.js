'use strict';

const StepAction = require('./stepAction');
const { extractElementId } = require('../../utils');
const { codeSnippets, utils } = require('../../commons/getSessionPlayerRequire');
const selectOption = require('./scripts/selectOption');
const featureFlags = require('../../commons/featureFlags');

class SelectOptionStepAction extends StepAction {
    async performAction() {
        const target = this.context.data[this.step.targetId || 'targetId'];
        const { seleniumElement, locatedElement } = target;

        const browserAndOS = await this.driver.getBrowserAndOS();

        const browserMajor = browserAndOS.browserMajor;
        const isSafari = this.driver.isSafari();
        const isShadowed = Boolean(this.step.element && this.step.element.isShadowed);

        // TODO: Remove the special handling for safari < 12 after we upgrade our grid to safari 13.
        // force use js code when element is shadow dom
        if (!isSafari || (isSafari && browserMajor >= 13 && !isShadowed)) {
            try {
                const res = await this.driver.elementIdClick(extractElementId(seleniumElement));
                return res;
            } catch (err) {
                // If customer overrides the native Element prototype, this click will fail for this reason. in such a case, fallback to use js code.
                if (!err.message.includes('Cannot check the displayedness of a non-Element argument')) {
                    throw err;
                }
            }
        }

        const safariSelectOptionDispatchEventOnSelectElement = featureFlags.flags.safariSelectOptionDispatchEventOnSelectElement.isEnabled();
        const selectOptionCode = `
            var getLocatedElement = ${codeSnippets.getLocatedElementCode};
            var isNativeFunction = ${utils.isNativeFunction.toString()};
            var selectOption = ${selectOption.toString()};
            return selectOption.apply(null, arguments);
        `;

        const result = await this.driver.executeJSWithArray(selectOptionCode, [locatedElement, safariSelectOptionDispatchEventOnSelectElement]);
        if (result.value && result.value.success) {
            return { success: true };
        }
        return { success: false };
    }
}

module.exports = SelectOptionStepAction;

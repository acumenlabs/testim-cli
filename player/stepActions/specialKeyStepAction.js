"use strict";

const { extractElementId } = require('../../utils');
const StepAction = require('./stepAction');
const Promise = require('bluebird');
const keyMap = {
    8: '\uE008',  // (Backspace)
    9: '\uE004',  // (tab)
    13: '\uE007', // (enter)
    27: '\uE00C', // (esc)
    33:	'\uE00E', // (page up)
    34: '\uE00F', // (page down)
    35: '\uE010', // (end)
    36: '\uE011', // (home)
    45:	'\uE016', // (insert)
    112: '\uE031', // (f1)
    113: '\uE032', // (f2)
    114: '\uE033', // (f3)
    115: '\uE034', // (f4)
    116: '\uE035', // (f5)
    117: '\uE036', // (f6)
    118: '\uE037', // (f7)
    119: '\uE038', // (f8)
    120: '\uE039', // (f9)
    121: '\uE03A', // (f10)
    122: '\uE03B', // (f11)
    123: '\uE03C' // (f12)
};

class SpecialKeyStepAction extends StepAction {

    setWithValueApi(keys) {
        const target = this.getTarget();
        if (target && target.seleniumElement) {
            return this.driver.elementIdValue(extractElementId(target.seleniumElement), keys);
        }
        return Promise.reject(new Error("missing selenium element"));
    }

    performAction() {
        const keys = [];
        const keyCode = this.step.events[0].eventData.keyCode;
        
        if (keyCode >= 32 && keyCode <= 127) {
            keys.push(String.fromCharCode(keyCode));
        } else {
            keys.push(keyMap[keyCode]);
        }
        return this.setWithValueApi(keys);
    }

}

module.exports = SpecialKeyStepAction;


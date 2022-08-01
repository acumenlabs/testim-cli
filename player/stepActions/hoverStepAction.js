const StepAction = require('./stepAction');

const { utils } = require('../../commons/getSessionPlayerRequire');

const toDOMRect = (height, width, x, y) => ({
    x,
    y,
    width,
    height,
    get top() { return this.y; },
    get left() { return this.x; },
    get right() { return this.x + this.width; },
    get bottom() { return this.y + this.height; },
    toJSON() { },
});

class HoverStepAction extends StepAction {
    getRect() {
        return this.driver.isFirefox() ?
            this.getTarget().rectWithoutFrameOffset :
            this.getTarget().rect;
    }

    performAction() {
        const target = this.getTarget();
        const { seleniumElement, rectWithoutFrameOffset, rect } = target;

        const { width, height } = rect;

        let clickOffsetX = width / 2;
        let clickOffsetY = height / 2;

        const offset = this.step.element.clickOffset;
        if (offset && this.step.shouldAccountForMouseOffsetInHover) {
            const { x, y } = offset;

            if (utils.isWithinTargetRect(toDOMRect(height, width, 0, 0), x, y)) {
                clickOffsetX = x;
                clickOffsetY = y;
            }
        }

        const offsets = {
            frameOffset: {
                x: rect.left - rectWithoutFrameOffset.left,
                y: rect.top - rectWithoutFrameOffset.top,
            },
            rect: rectWithoutFrameOffset,
            clickOffset: { x: Math.floor(clickOffsetX), y: Math.floor(clickOffsetY) },
        };

        return this.driver.hover(seleniumElement, offsets)
            .then(() => ({ success: true }));
    }
}

module.exports = HoverStepAction;


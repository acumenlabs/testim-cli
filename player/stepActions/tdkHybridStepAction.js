'use strict';

const StepAction = require('./stepAction');

const { execute } = require('../../stepPlayers/hybridStepPlayback')

class TdkHybridStepAction extends StepAction {

    async performAction() {
       return await execute(
           this.step,
           this.context,
           this.driver,
           this.stepActionUtils.testimServicesApi.authenticationManager.getLoggedUserInfo(),
           this.frameHandler.frameManager
        );
    }
}

module.exports = TdkHybridStepAction;

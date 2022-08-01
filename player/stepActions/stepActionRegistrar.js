'use strict';

const LocateStepAction = require('./locateStepAction');
const ScrollStepAction = require('./scrollStepAction');
const MouseStepAction = require('./mouseStepAction');
const TextValidationStepAction = require('./textValidationStepAction');
const EvaluateExpressionStepAction = require('./evaluateExpressionStepAction');
const TextStepAction = require('./textStepAction');
const JsCodeStepAction = require('./jsCodeStepAction');
const JsConditionStepAction = require('./jsConditionStepAction');
const SpecialKeyStepAction = require('./specialKeyStepAction');
const SelectOptionStepAction = require('./selectOptionStepAction');
const SubmitStepAction = require('./submitStepAction');
const HoverStepAction = require('./hoverStepAction');
const WheelStepAction = require('./wheelStepAction');
const DropFileStepAction = require('./dropFileStepAction');
const InputFileStepAction = require('./inputFileStepAction');
const NavigationStepAction = require('./navigationStepAction');
const SleepStepAction = require('./sleepStepAction');
const RefreshStepAction = require('./RefreshStepAction');
const ApiStepAction = require('./apiStepAction');
const ExtractTextStepAction = require('./extractTextStepAction');
const TdkHybridStepAction = require('./tdkHybridStepAction');
const PixelValidationStepAction = require('./pixelValidationStepAction');

const CliJsStepAction = require('./cliJsStepAction');
const CliConditionStepAction = require('./cliConditionStepAction');
const NodePackageStepAction = require('./nodePackageStepAction');
const ExtensionOnlyStepAction = require('./extensionOnlyStepAction');
const SfdcStepAction = require('./sfdcStepAction');
const SfdcRecordedStepAction = require('./sfdcRecordedStepAction');

function register(stepActionByType, stepActionFactory) {
    Object.keys(stepActionByType).forEach(type => {
        stepActionFactory.registerStepAction(type, stepActionByType[type]);
    });
}

module.exports = function (driver, stepActionFactory, runMode) {
    const STEP_ACTION_MAPPING = {
        locate: LocateStepAction,
        scroll: ScrollStepAction,
        mouse: MouseStepAction,
        submit: SubmitStepAction,
        text: TextStepAction,
        'special-key': SpecialKeyStepAction,
        'user-code': JsCodeStepAction,
        'validation-code-step': JsCodeStepAction,
        'wait-for-code-step': JsCodeStepAction,
        'action-code-step': JsCodeStepAction,
        'condition-step': JsConditionStepAction,
        'skip-code-step': JsConditionStepAction,
        'element-code-step': JsConditionStepAction,
        'evaluate-expression': EvaluateExpressionStepAction,
        'text-validation': TextValidationStepAction,
        'wait-for-text-validation': TextValidationStepAction,
        'select-option': SelectOptionStepAction,
        'drop-file': DropFileStepAction,
        'input-file': InputFileStepAction,
        hover: HoverStepAction,
        navigation: NavigationStepAction,
        wheel: WheelStepAction,
        sleep: SleepStepAction,
        refresh: RefreshStepAction,
        'api-validation': ApiStepAction,
        'api-action': ApiStepAction,
        'api-code-step': JsCodeStepAction,
        'extract-text': ExtractTextStepAction,
        'simple-ui-verification': PixelValidationStepAction,
        'wait-for-simple-ui-verification': PixelValidationStepAction,

        'cli-validation-download-file': ExtensionOnlyStepAction,
        'cli-wait-for-download-file': ExtensionOnlyStepAction,
        'network-validation-step': ExtensionOnlyStepAction,

        'cli-validation-code-step': CliJsStepAction,
        'cli-wait-for-code-step': CliJsStepAction,
        'cli-action-code-step': CliJsStepAction,
        'cli-api-code-step': CliJsStepAction,

        'cli-condition-step': CliConditionStepAction,
        'node-package': NodePackageStepAction,

        'email-code-step': JsCodeStepAction,
        'cli-email-code-step': CliJsStepAction,
        'tdk-hybrid': TdkHybridStepAction,

        'sfdc-recorded-step': SfdcRecordedStepAction,
        'sfdc-step-login': SfdcStepAction,
        'sfdc-step-logout': SfdcStepAction,
        'sfdc-step-sobjectcreate': SfdcStepAction,
        'sfdc-step-sobjectdelete': SfdcStepAction,
        'sfdc-step-findrecord': SfdcStepAction,
        'sfdc-step-quickaction': SfdcStepAction,
        'sfdc-step-sobjectedit': SfdcStepAction,
        'sfdc-step-sobjectvalidate': SfdcStepAction,
        'sfdc-step-launchapp': SfdcStepAction,
        'sfdc-step-closeconsoletabs': SfdcStepAction,
        'sfdc-step-relatedlistaction': SfdcStepAction,
    };

    register(STEP_ACTION_MAPPING, stepActionFactory);
    if (stepActionFactory.registerLocateStepActionUtils) {
        stepActionFactory.registerLocateStepActionUtils(LocateStepAction.getUtils(driver));
    }
};


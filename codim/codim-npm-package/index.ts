/**
 * Happens when you call a test from node directly (node myFile.js) instead of through the Testim CLI (testim run myFile.js)
 */
class StubError extends Error {
    constructor(name: string) { super(`Error calling ${name} stub. Codim needs to run through the Testim CLI`); }
}

/**
 * Represents the Testim Dev Kit step locator.
 * @see https://help.testim.io/docs/working-with-locators
 */
class TDKStepLocator {
    public elementLocator?: any;
    public selector?: string;
    public nthChildIndex?: number;
    public id?: string;
    public name?: string;
    public innerLocator?: TDKStepLocator;
    public parentLocator?: TDKStepLocator;
    public find(selector: any): TDKStepLocator {
        throw new StubError('TDKStepLocator.find');
    }
    public nthChild(index: number): TDKStepLocator {
        throw new StubError('TDKStepLocator.nthChild');
    }
    public childWithText(text: string): TDKStepLocator {
        throw new StubError('TDKStepLocator.childWithText');
    }
    /**
     * Sets the locator confidence threshold
     * @param threshold the locator conidence score
     */
    withConfidence(threshold: number): TDKStepLocator {
        throw new StubError('TDKStepLocator.withThreshold');
    }
}

/**
 * Represents the options passed to a click.
 * @see https://help.testim.io/docs/click
 */
type ClickOptions = { button?: 'left' | 'right'; offset?: { x: number; y: number } };

/**
 * Represents the return value from a getCookie or setCookie call.
 * @see https://help.testim.io/docs/get-cookie
 */
class CookieData {
    name?: string;
    value?: string;
    domain?: string;
    expires?: number;
    httpOnly? = true;
    secure? = false;
    path?: string;
}
/**
 * Represents an x/y point - passed to Drag and Drop
 */
type Point = {
    x: number;
    y: number;
}
/**
 * A CSS selector used to select an element. This is usually a string like `'.foo'` and the syntax is whatever
 * the browser and JSDOM's `document.querySelector` understand.
 * @see https://www.w3.org/TR/selectors-3/#selectors
 */
type Selector = string;
/**
 * All Testim methods that work on an element work on either a Selector or TDKStepLocator
 */
type SelectParam = Selector | TDKStepLocator;
/**
 * The options passed to a scrollToElement command
 * @see https://help.testim.io/docs/scroll-to-element
 */
type ScrollOptions = {
    scrollTarget?: SelectParam;
}
/** The options passed to a hover command
 * @see https://help.testim.io/docs/hover
 */
type HoverOptions = {
    offset?: { x: number; y: number };
}
/** The options passed to a waitForCode command
 * @see https://help.testim.io/docs/wait-for-code
 */
type WaitForCodeOptions = {
    pollInterval: number;
}
/** The options passed to a resize command
 * @see https://help.testim.io/docs/resize
 */
type ResizeOptions = {
    width: number;
    height: number;
}
/** the options passed to a waitForElement command
 * @see https://help.testim.io/docs/wait-for-element
 */
type WaitForElementOptions = {
    checkVisibility?: boolean;
}

/** the options passed to a waitForText command
 * @see https://help.testim.io/docs/wait-for-text
 */
type WaitForTextOptions = {
    checkVisibility?: boolean;
}

type Headers = { [key: string]: string };
type RequestMethods = 'GET' | 'POST' | 'PUT' | 'PATH' | 'DELETE' | 'COPY' | 'HEAD' | 'OPTIONS';

type ApiCallOptions = {
    method?: RequestMethods;
    headers?: Headers;
    body?: string;
    sendViaWebApp?: boolean;
    omitCookies?: boolean;
}

export enum GeneratedValueTypes {
    LettersOnly = 'Letters Only',
    NumbersOnly = 'Numbers Only',
    Mixed = 'Mixed'
}

/**
 * Clicks the given element on the screen, clicks on the element in its center by default.
 * @see https://help.testim.io/docs/click
 */
export async function click(selector: SelectParam, options: ClickOptions = {}): Promise<void> { throw new StubError('click'); }

/**
 * Clicks the given element on the screen, clicks on the element in its center by default.
 * @see https://help.testim.io/docs/dblclick
 */
export async function dblclick(selector: SelectParam, options: ClickOptions = {}): Promise<void> { throw new StubError('dblclick'); }


/**
 * Sleeps a specified duration. Basically the same as
 * const sleep = require('util').promisify(setTimeout);
 * Except that it adds a sleep step to the UI
 * @param ms milliseconds to sleep
 */
export async function sleep(ms: number): Promise<void> { throw new StubError('sleep'); }
/**
 * Api call
 */
export async function apiCall(url: string, options?: ApiCallOptions): Promise<{statusCode: number; statusText: string; requestDuration: number; responseBody: any; responseHeaders: any}> { throw new StubError('apiCall'); }
/**
 * Get latest download item work only in Chrome extension mode
 */
export async function downloadFile(): Promise<{fileName: string; fileType: string; sizeInBytes: number; fileBlob: any}> { throw new StubError('downloadFile'); }
/**
 * Generate random value letters/numbers/mixed
 */
export async function generateRandomValue(generatedLength = 12, valueType = GeneratedValueTypes.Mixed, prefixValue = ''): Promise<string> { throw new StubError('generateRandomValue'); }
/**
 * Generate Testim random email - PRO feature
 */
export async function generateTestimEmail(): Promise<string> { throw new StubError('generateTestimEmail'); }
/**
 * Get email messages from Testim email inbox - PRO feature
 */
export async function getTestimInbox(emailAddress: string): Promise<any[]> { throw new StubError('getTestimInbox'); }
/**
 * Get document element outer html
 */
export async function html(): Promise<string> { throw new StubError('html'); }
/**
 * This method used to simulate upload file on <input type="file">
 */
export async function inputFile(selector: SelectParam, inputFileUrls: string | string[]): Promise<void> { throw new StubError('inputFile'); }
/**
 * This method used to simulate drop file on drop zone
 */
export async function dropFile(selector: SelectParam, inputFileUrls: string | string[]): Promise<void> { throw new StubError('dropFile'); }
/**
 * Refresh current page
 */
export async function refresh(): Promise<void> { throw new StubError('refresh'); }
/**
 * Get current page title
 */
export async function title(): Promise<void> { throw new StubError('title'); }
/**
 * Get current page url
 */
export async function url(): Promise<void> { throw new StubError('url'); }
/**
 * This method is used to extract an element's text content.
 * @see https://help.testim.io/docs/text
 */
export async function text(selector: SelectParam): Promise<string> { throw new StubError('text'); }
/**
 * Scroll to a given element on the screen.
 * @see https://help.testim.io/docs/scroll-to-element
 */
export async function scrollToElement(selector: SelectParam, options: ScrollOptions = {}): Promise<void> { throw new StubError('scrollToElement'); }
/**
 * This method is used to set an element's text content. If the element already has text content it overrides it.
 * @see https://help.testim.io/docs/type
 */
export async function type(selector: SelectParam, textValue: string): Promise<void> { throw new StubError('type'); }
/**
 * This method is used to run custom JavaScript in the browser application page. This is useful as an escape hatch and in order to implement interactions that are not available out of the box with Testim or in order to interact with the page JavaScript.
 * @see https://help.testim.io/docs/evaluate
 */
export async function evaluate<R, U extends any[]>(fn: (...any: U) => R | Promise<R>, ...parameters: U): Promise<R> { throw new StubError('evaluate'); }
/**
 * This method is used to execute an arbitrary command that runs in Node.js from within the test
 * @see https://help.testim.io/docs/cli-action
 */
export async function cliAction<R, U extends any[]>(fn: (...any: U) => R | Promise<R>, ...parameters: U): Promise<R> { throw new StubError('cliAction'); }
/**
 * The go command navigates to a given web page in the controlled browser.
 * @see https://help.testim.io/docs/go
 */
export async function go(url: string): Promise<void> { throw new StubError('go'); }
/**
 * Sets a cookie on a given page.
 * @see https://help.testim.io/docs/set-cookie
 */
export async function setCookie(cookieData: CookieData): Promise<void> { throw new StubError('setCookie'); }
/**
 * Gets a cookie by a specific name.
 * @see https://help.testim.io/docs/get-cookie
 */
export async function getCookie(name: string): Promise<CookieData> { throw new StubError('getCookie'); }
/**
 * Hovers over the given element on the screen, on the element center by default.
 * @see https://help.testim.io/docs/hover
 */
export async function hover(selector: SelectParam, options: HoverOptions): Promise<void> { throw new StubError('hover'); }
/**
 * This method checks that an element matching the given selector exists on the page
 * @see https://help.testim.io/docs/exists
 */
export async function exists(selector: SelectParam): Promise<boolean> { throw new StubError('exists'); }
/**
 * This method is used to check if a checkbox element is checked or not.
 * @see https://help.testim.io/docs/checkbox
 */
export async function checkbox(selector: SelectParam): Promise<boolean> { throw new StubError('checkbox'); }
/**
 * This method is used to check if a radio element is checked or not.
 * @see https://help.testim.io/docs/radio
 */
export async function radio(selector: SelectParam): Promise<void> { throw new StubError('radio'); }
/**
 * This method selects a given <option> element from an HTML <select> element.
 * @see https://help.testim.io/docs/select
 */
export async function selectOption(selector: SelectParam): Promise<void> { throw new StubError('selectOption'); }
/**
 * Send a given key to the browser (for example tab).
 * @see https://help.testim.io/docs/send-character
 */
export async function sendCharacter(selector: SelectParam, keyCode: number): Promise<void> { throw new StubError('sendCharacter'); }
/**
 * Drags and drops on the given element onto another element on the page using HTML5 drag and drop events.
 * @see https://help.testim.io/docs/drag-and-drop
 */
export async function dragAndDrop(sourceSelector: SelectParam, targetSelector: SelectParam): Promise<void> { throw new StubError('dragAndDrop'); }
/**
 * Dragged the given element alongside the given x/y path.
 * @see https://help.testim.io/docs/drag
 */
export async function drag(selector: SelectParam, dragPath: Point[]): Promise<void> { throw new StubError('drag'); }
/**
 * https://help.testim.io/docs/scroll-to-position
 * @see https://help.testim.io/docs/scroll-to-position
 */
export async function scrollToPosition(x: number, y: number, options: ScrollOptions = {}): Promise<void> { throw new StubError('scrollToPosition'); }
/**
 * This method submits the given form element.
 * @see https://help.testim.io/docs/submit
 */
export async function submit(selector: SelectParam): Promise<void> { throw new StubError('submit'); }
/**
 * This method polls the page every 100 (default ms) until a passed JavaScript value is true (well, truthy).
 * @see https://help.testim.io/docs/wait-for-code
 */
export async function waitForCode(fn: Function, options? : WaitForCodeOptions): Promise<void> { throw new StubError('waitForCode'); }
/**
 * Waits for an element to exist on the screen and be visible.
 * @see https://help.testim.io/docs/resize
 */

export async function resize(options: ResizeOptions): Promise<void> { throw new StubError('resize'); }
/**
 * Waits for an element to exist on the screen.
 * @see https://help.testim.io/docs/wait-for-element
 */
export async function waitForElement(selector: SelectParam, options: WaitForElementOptions = { checkVisibility: true }): Promise<void> { throw new StubError('waitForElement'); }
/**
 * Waits for an element to exist on the screen.
 * @see https://help.testim.io/docs/wait-for-element
 */
export async function waitForNoElement(selector: SelectParam, options: WaitForElementOptions = { checkVisibility: true }): Promise<void> { throw new StubError('waitForNoElement'); }
/**
 * Waits for an element to exist on the screen and its text equal to expected value.
 * @see https://help.testim.io/docs/wait-for-text
 */
export async function waitForText(selector: SelectParam, expectedValue: string | RegExp, options: WaitForTextOptions = { checkVisibility: true }): Promise<void> { throw new StubError('waitForText'); }

export const screenshot = {
    /**
     * Takes a screenshot of the whole screen
     */
    viewport: async function viewport(): Promise<string> { throw new StubError('screenshotViewport'); },
    /**
     * Takes a screenshot of the whole page by scrolling down and taking screenshots of the different parts and stitching them together
     */
    stitch: async function stitch(): Promise<string> { throw new StubError('screenshotStitch'); },
    /**
     * Takes a screenshot of a specific element
     */
    element: async function element(selector: SelectParam): Promise<string> { throw new StubError('screenshotElement'); },
};


/**
 * Defines a test to run.
 * @see https://help.testim.io/docs/getting-started
 */
export function it(name: string | Function, fn?: Function): void { throw new StubError('it'); }
/**
 * Defines a test to run.
 * @see https://help.testim.io/docs/getting-started
 */
export function test(name: string | Function, fn?: Function): void { throw new StubError('test'); }
/**
 * Defines a test suite to run.
 * @see https://help.testim.io/docs/getting-started
 */
export function describe(name: string, fn: Function): void { throw new StubError('describe'); }
/**
 * Defines a piece of code to run before all tests in this file.
 * @see https://help.testim.io/docs/getting-started
 */
export function before(fn: Function): void { throw new StubError('before'); }
/**
 * Defines a piece of code to run before each test in this file.
 * @see https://help.testim.io/docs/getting-started
 */
export function beforeEach(fn: Function): void { throw new StubError('beforeEach'); }
/**
 * Defines a piece of code to run after  all tests in this file.
 * @see https://help.testim.io/docs/getting-started
 */
export function after(fn: Function): void { throw new StubError('after'); }
/**
 * Defines a piece of code to run after each test in this file.
 * @see https://help.testim.io/docs/getting-started
 */
export function afterEach(fn: Function): void { throw new StubError('afterEach'); }
/**
 * Skips the given test.
 * @see https://help.testim.io/docs/getting-started
 */
export function skip(name: string | Function, fn?: Function): void { throw new StubError('skip'); }
/**
 * Runs only the current test or test suite in this file.
 * @see https://help.testim.io/docs/getting-started
 */
export function only(name: string | Function, fn?: Function): void { throw new StubError('only'); }
/**
 * Skips the given suite.
 * @see https://help.testim.io/docs/getting-started
 */
export function describeSkip(name: string, fn: Function): void { throw new StubError('describeSkip'); }
/**
 * Runs only given suite.
 * @see https://help.testim.io/docs/getting-started
 */
export function describeOnly(name: string, fn: Function): void { throw new StubError('describeOnly'); }
it.skip = test.skip = skip;
it.only = test.only = only;
describe.skip = describeSkip;
describe.only = describeOnly;
/**
 * A SmartLocator is like a stable selector. It contains a ton of interesting metadata and it's one of the bits Testim's AI
 * runs reinforcement learning on. It selects each element in thousands of ways and runs a consensus algorithm on the results.
 * @see https://help.testim.io/docs/working-with-locators
 */
export class Locator {
    public static fromSelector(selector: string): TDKStepLocator {
        throw new StubError('Locator.fromSelector');
    }
    public static set(locators: any) {}
    public static for(locatorId: string): TDKStepLocator {
        throw new StubError('Locator.for');
    }
    /**
     * Sets the locator confidence threshold
     * @param threshold the locator conidence score
     */
    setConfidenceThreshold(threshold: number) {
        throw new StubError('setConfidenceThreshold');
    }
}
/**
 * Finds a Smart Locator by name
 * @see https://help.testim.io/docs/working-with-locators
 */
export function l(locatorId: string): TDKStepLocator {
    return Locator.for(locatorId);
}
/**
 * Create Locator from CSS selector
 * @see https://help.testim.io/docs/working-with-locators
 */
export function fromSelector(selector: string): TDKStepLocator {
    return Locator.fromSelector(selector);
}

/**
 * Changes the tab or frame context
 * @see https://help.testim.io/docs/with-context
 */
export function withContext(contextOptions: any): any { throw new StubError('withContext'); }

const DEFAULT_SELECTOR = 'css selector';
const DIRECT_SELECTOR_REGEXP = /^(id|css selector|xpath|link text|partial link text|name|tag name|class name|-android uiautomator|-ios uiautomation|-ios predicate string|-ios class chain|accessibility id):(.+)/;

module.exports = function (...args) {
    let value = args[0];
    let relative = (args.length > 1 ? args[1] : false);
    let xpathPrefix = relative ? './/' : '//';

    /**
     * set default selector
     */
    let using = DEFAULT_SELECTOR;

    if (typeof value !== 'string') {
        throw new Error('selector needs to be typeof `string`');
    }

    if (args.length === 3) {
        return {
            using: args[0],
            value: args[1]
        };
    }

    /**
     * check if user has specified locator strategy directly
     */
    const match = value.match(DIRECT_SELECTOR_REGEXP);
    if (match) {
        return {
            using: match[1],
            value: match[2]
        };
    }

    // check value type
    // use css selector for hash instead of by.id
    // https://github.com/webdriverio/webdriverio/issues/2780
    if (value.search(/^#-?[_a-zA-Z]+[_a-zA-Z0-9-]*$/) > -1) {
        using = 'css selector';

        // use xPath strategy if value starts with //
    } else if (value.indexOf('/') === 0 || value.indexOf('(') === 0 ||
        value.indexOf('../') === 0 || value.indexOf('./') === 0 ||
        value.indexOf('*/') === 0) {
        using = 'xpath';

        // use link text strategy if value startes with =
    } else if (value.indexOf('=') === 0) {
        using = 'link text';
        value = value.slice(1);

        // use partial link text strategy if value startes with *=
    } else if (value.indexOf('*=') === 0) {
        using = 'partial link text';
        value = value.slice(2);

        // recursive element search using the UiAutomator library (Android only)
    } else if (value.indexOf('android=') === 0) {
        using = '-android uiautomator';
        value = value.slice(8);

        // recursive element search using the UIAutomation or XCUITest library (iOS-only)
    } else if (value.indexOf('ios=') === 0) {
        value = value.slice(4);

        if (value.indexOf('predicate=') === 0) {
            // Using 'ios=predicate=' (iOS 10+ only)
            using = '-ios predicate string';
            value = value.slice(10);
        } else if (value.indexOf('chain=') === 0) {
            // Using 'ios=chain=' (iOS 10+ only)
            using = '-ios class chain';
            value = value.slice(6);
        } else {
            // Legacy iOS (<= 9.3) UIAutomation library
            using = '-ios uiautomation';
        }

        // recursive element search using accessibility id
    } else if (value.indexOf('~') === 0) {
        using = 'accessibility id';
        value = value.slice(1);

        // class name mobile selector
        // for iOS = UIA...
        // for Android = android.widget
    } else if (value.slice(0, 3) === 'UIA' || value.slice(0, 15) === 'XCUIElementType' || value.slice(0, 14).toLowerCase() === 'android.widget') {
        using = 'class name';

        // use tag name strategy if value contains a tag
        // e.g. "<div>" or "<div />"
    } else if (value.search(/<[a-zA-Z-]+( \/)*>/g) >= 0) {
        using = 'tag name';
        value = value.replace(/<|>|\/|\s/g, '');

        // use name strategy if value queries elements with name attributes
        // e.g. "[name='myName']" or '[name="myName"]'
    } else if (value.search(/^\[name=("|')([a-zA-z0-9\-_. ]+)("|')]$/) >= 0) {
        using = 'name';
        value = value.match(/^\[name=("|')([a-zA-z0-9\-_. ]+)("|')]$/)[2];

        // allow to move up to the parent or select current element
    } else if (value === '..' || value === '.') {
        using = 'xpath';

        // any element with given class, id, or attribute and content
        // e.g. h1.header=Welcome or [data-name=table-row]=Item or #content*=Intro
    } else {
        const match = value.match(new RegExp([
            // HTML tag
            /^([a-z0-9]*)/,
            // optional . or # + class or id
            /(?:(\.|#)(-?[_a-zA-Z]+[_a-zA-Z0-9-]*))?/,
            // optional [attribute-name="attribute-value"]
            /(?:\[(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)(?:=(?:"|')([a-zA-z0-9\-_. ]+)(?:"|'))?\])?/,
            // *=query or =query
            /(\*)?=(.+)$/
        ].map(rx => rx.source).join('')));

        if (match) {
            const PREFIX_NAME = {'.': 'class', '#': 'id'};
            const conditions = [];
            const [
                tag,
                prefix, name,
                attrName, attrValue,
                partial, query
            ] = match.slice(1);

            if (prefix) {
                conditions.push(`contains(@${PREFIX_NAME[prefix]}, "${name}")`);
            }
            if (attrName) {
                conditions.push(
                    attrValue ? `contains(@${attrName}, "${attrValue}")` : `@${attrName}`
                );
            }
            if (partial) {
                conditions.push(`contains(., "${query}")`);
            } else {
                conditions.push(`normalize-space() = "${query}"`);
            }

            using = 'xpath';
            value = `${xpathPrefix}${tag || '*'}[${conditions.join(' and ')}]`;
        }
    }

    return {
        using,
        value
    };
};

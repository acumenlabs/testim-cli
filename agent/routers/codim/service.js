'use strict';

const _ = require('lodash');
const path = require('path');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const { fromPairs } = require('lodash');
const { buildCodeTests } = require('../../../runners/buildCodeTests');
const { AbortError } = require('../../../commons/AbortError');

const findTestFolder = _.memoize(async (fromFolder) => {
    const files = await fs.readdirAsync(fromFolder);
    // this is either invoked by running the Testim CLI from inside the tests folder or from inside the `init` folder
    // so deal with the case we're inside tests.
    const isInProjectFolder = files.some(x => x === 'tests') && (await fs.statAsync(path.join(fromFolder, 'tests'))).isDirectory();
    if (isInProjectFolder) {
        return path.join(fromFolder, 'tests');
    }
    return fromFolder;
});

async function getLocalLocators() {
    const folder = await findTestFolder(process.cwd());
    const locatorsFilePath = path.join(folder, 'locators', 'locators.js');
    function parseLocators(buffer) {
        // remove require calls to not read all the locators into memory when evaluating
        // eslint-disable-next-line no-eval
        return eval(buffer.toString().replace(/require/g, '(x => /locator\.(.*)\.json/.exec(x)[1])'));
    }
    const locators = await fs.readFileAsync(locatorsFilePath).then(parseLocators, () => ({}));
    return _(Object.keys(locators)).map((id) => {
        const escapedId = id.replace(/"/g, '\\"');
        return [escapedId, locators[id]];
    }).fromPairs().value();
}

async function findTests(folder = process.cwd()) {
    const testFolder = await findTestFolder(folder);
    const filesWithStat = await fs.promises.readdir(testFolder, { withFileTypes: true });

    // things we know are not tests but end in js
    const excluded = ['webpack.config.js', 'tsconfig.js', '.DS_Store', 'functions.js'];
    const excludedFileTypes = ['.html', '.json'];
    return filesWithStat
        .filter(x =>
            !excluded.includes(x.name) &&
            !excludedFileTypes.some(type => x.name.endsWith(type)) &&
            x.isFile() &&
            !x.name.startsWith('.'),
        )
        .map(x => x.name);
}

/**
 * @param {Record<string, object | Promise<object>>} propsObject
 * @returns {Promise<Record<string, object>>}
 * */
async function promiseFromProps(propsObject) {
    const entries = Object.entries(propsObject);
    const values = entries.map(([, value]) => value);
    const resolvedValues = await Promise.all(values);
    for (let i = 0; i < resolvedValues.length; i++) {
        entries[i][1] = resolvedValues[i];
    }
    return Object.fromEntries(entries);
}

async function getLocalLocatorContents(locators, full = false, originFolder = process.cwd()) {
    const props = {};
    if (full) {
        const folder = await findTestFolder(originFolder);
        for (const key of Object.values(locators)) {
            props[key] = fs.promises.readFile(path.join(folder, 'locators', `locator.${key}.json`)).then(JSON.parse);
        }
    }
    try {
        const contents = await promiseFromProps(props);
        return contents;
    } catch (e) {
        console.error(e);
        return {};
    }
}
async function saveTest({
    body, name, locators, language = 'javascript',
}) {
    const folder = await findTestFolder(process.cwd());
    const locatorsFilePath = path.join(folder, 'locators', 'locators.js');
    let filename = path.join(folder, name);
    if (!filename.startsWith(folder)) {
        throw new Error('A test name must be a valid file name and inside the tests directory');
    }
    if (language === 'javascript') {
        if (filename.endsWith('.js') && !filename.endsWith('.test.js')) {
            filename = `${filename.substr(0, filename.length - 3)}.test.js`;
        } else if (!filename.endsWith('.test.js')) {
            filename += '.test.js';
        }
    } else if (filename.endsWith('.ts') && !filename.endsWith('.test.ts')) {
        filename = `${filename.substr(0, filename.length - 3)}.test.ts`;
    } else if (!filename.endsWith('.test.ts')) {
        filename = `${filename}.test.ts`;
    }
    if (filename.endsWith('locators/locators.js')) {
        throw new Error('Cannot override locators file from the internet as it is evaluated by the runner');
    }
    await fs.writeFileAsync(filename, body);
    await fs.mkdirAsync(path.join(folder, 'locators')).catch(() => {});
    for (const { id, body } of locators) {
        await fs.writeFileAsync(path.join(folder, 'locators', `locator.${id}.json`), JSON.stringify(body));
    }
    const locatorMap = fromPairs(locators.map(({ name, id }) => [name, id]));
    const localLocatorMap = await getLocalLocators();
    Object.assign(localLocatorMap, locatorMap);
    await writeLocators(locatorsFilePath, localLocatorMap);
}
async function writeLocators(locatorsFilePath, locatorMap) {
    let content = 'module.exports = {\n';
    for (const [key, value] of Object.entries(locatorMap)) {
        content += `  "${key}": require('./locator.${value}.json'),\n`;
    }
    content += '};';
    await fs.writeFileAsync(locatorsFilePath, content);
}
async function saveLocators(locators, { mergeIntoExisting } = { mergeIntoExisting: false }) {
    const folder = await findTestFolder(process.cwd());
    const locatorsFilePath = path.join(folder, 'locators', 'locators.js');
    await fs.mkdirAsync(path.join(folder, 'locators')).catch(() => {});

    for (const { name, id, elementLocator } of locators) {
        await fs.writeFileAsync(path.join(folder, 'locators', `locator.${id}.json`), JSON.stringify({ name, id, elementLocator }));
    }
    const locatorMap = fromPairs(locators.map(({ name, id }) => [name, id]));
    if (mergeIntoExisting) {
        const localLocatorMap = await getLocalLocators();
        Object.assign(locatorMap, localLocatorMap);
    }

    await writeLocators(locatorsFilePath, locatorMap);
}

async function compileFunctionsLibrary({ fileSystem, bypassWebpack } = {}, optionalAbortSignal) {
    const folder = await findTestFolder(process.cwd());
    if (optionalAbortSignal && optionalAbortSignal.aborted) {
        throw new AbortError();
    }

    const functionsFile = path.join(folder, 'functions.js');
    if (bypassWebpack && bypassWebpack.testim) {
        const Module = require('module');
        // attempt to require without webpack compile - useful for puppeteer/selenium hybrid
        const originalRequire = Module.prototype.require;
        Module.prototype.require = function requireThatOverridesSessionPlayer(id) {
            if (id === 'testim') {
                return bypassWebpack.testim;
            }
            // eslint-disable-next-line prefer-rest-params
            return originalRequire.apply(this, arguments);
        };
        // delete references to the old __testim from previous invocations
        delete require.cache[require.resolve(functionsFile)];
        const functions = require(functionsFile);
        // asynchronous required not supported - is this fine?
        Module.prototype.require = originalRequire;
        return functions;
    }
    const functionsAsAWebpackModule = await buildCodeTests([functionsFile], {
        output: {
            libraryTarget: 'umd',
            library: 'tdk',
            globalObject: 'globalThis',
        },
        cache: {
            type: 'memory',
        },
        mode: 'development', // better debugging
    }, {}, fileSystem, optionalAbortSignal);
    // we always compile a single suite and a single file here
    return functionsAsAWebpackModule.tests[0][0].code;
}

module.exports = {
    findTestFolder,
    findTests,
    getLocalLocators,
    getLocalLocatorContents,
    saveTest,
    saveLocators,
    compileFunctionsLibrary,
};

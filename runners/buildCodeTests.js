"use strict";

const MemoryFS = require('memory-fs');
const path = require('path');
const utils = require('../utils');
const Promise = require('bluebird');
const _ = require('lodash');
const lazyRequire = require('../commons/lazyRequire');
const { AbortError } = require('../commons/AbortError');

const { isEqual, cloneDeep } = require('lodash');

// compiler instance we can reuse between calls
const state = {
    compiler: null,
    webpackConfig: null
};

exports.buildCodeTests = async function buildCodeTestsGuarded(
    files,
    webpackConfig,
    runnerOptionsToMaybeCopyToTestEnvironment,
    fileSystem,
    optionalAbortSignal
) {
    try {
        return await buildCodeTests(files, webpackConfig, runnerOptionsToMaybeCopyToTestEnvironment, fileSystem, optionalAbortSignal);
    } catch (e) {
        if (e && e.code === 'ENOENT') {
            // this is a webpack config error - it means webpack didn't pick up on a file change and didn't generate the correct bundle
            // according to the guid hash
            state.compiler = null;
            state.webpackConfig = null;
            fileSystem.data = {}; // reset the memory filesystem in case we left a mess there in the previous invocation
            return await buildCodeTests(files, webpackConfig, runnerOptionsToMaybeCopyToTestEnvironment, fileSystem, optionalAbortSignal);
        }
        throw e;
    }
}

async function buildCodeTests(files, webpackConfig = {mode: 'development'}, runnerOptionsToMaybeCopyToTestEnvironment, fileSystem, optionalAbortSignal) {

    const webpack = await lazyRequire('webpack');

    const suite = {};
    const webpackConfigBeforeOurChanges = cloneDeep(webpackConfig);

    webpackConfig.externals = { // define testim as an external
        'testim': '__testim',
        // 'chai': '__chai'
    };
    webpackConfig.devtool = webpackConfig.devtool || 'inline-source-map';

    webpackConfig.plugins = webpackConfig.plugins || [];

    webpackConfig.plugins.push(new webpack.DefinePlugin(getEnvironmentVariables(runnerOptionsToMaybeCopyToTestEnvironment)))
    webpackConfig.plugins.push(new webpack.DefinePlugin({
        'process.argv': JSON.stringify(process.argv)
    }));
    files = files.map(f => path.resolve(f));

    const fileHashes = files.map(x => utils.guid(30));

    webpackConfig.optimization = { minimize: false };

    webpackConfig.entry = _.fromPairs(_.zip(files, fileHashes).map(([filename, hash]) => {
        return [hash, filename];
    }));
    webpackConfig.output = Object.assign({
        devtoolModuleFilenameTemplate: (info) => `file:///${info.absoluteResourcePath}`,
        filename: '[name].bundle.js',
    }, webpackConfig.output);


    let compiler;
    // if we are passed a filesystem, assume reuse between calls and turn on watch mode
    if (fileSystem) {
        // were we passed a filesystem before to compile the same thing?
        if (isEqual(state.webpackConfig, webpackConfigBeforeOurChanges) && state.compiler) {
            // we already have a compiler up and running
            compiler = state.compiler;
        } else {
            state.webpackConfig = webpackConfigBeforeOurChanges;
            state.compiler = webpack(webpackConfig);
            compiler = state.compiler;
        }
    } else {
        compiler = webpack(webpackConfig); // no caching
    }

    const mfs = fileSystem || new MemoryFS();
    compiler.outputFileSystem = mfs; // no need to write compiled tests to disk

    // This can only reject
    const abortSignalPromise = Promise.fromCallback(cb => {
        if (optionalAbortSignal) {
            optionalAbortSignal.addEventListener("abort", () => {
                cb(new AbortError());
            });
        }
    });

    // run compiler:
    try {
        const stats = await Promise.race([Promise.fromCallback(cb => compiler.run(cb)), abortSignalPromise]);
        if (stats.hasErrors()) {
            throw new Error(stats.toJson().errors);
        }
    } catch (e) {
        const {ArgError} = require('../errors');

        const cantFindFile = e.message.match(/Entry module not found: Error: Can't resolve '(.*)'/);
        if (cantFindFile && cantFindFile.length === 2) {
            if (webpackConfig.output && webpackConfig.output.library === 'tdk') {
                throw new ArgError(`Could not open dev-kit functions file in ${cantFindFile[1]}`);
            }
            throw new ArgError(`Can't find test files in: '${cantFindFile[1]}'`);
        }

        throw new ArgError("Compilation Webpack Error in tests: " + e.message);
    }

    const fileResults = files.map((file, i) => ({code: mfs.readFileSync(path.resolve('./dist', `${fileHashes[i]}.bundle.js`)), name: file })); // read all files

    suite.tests = [fileResults.map(({code, name}) => ({
        code: code.toString(),
        baseUrl: "", // not supported at the moment
        name: path.resolve(name),
        testConfig: {},
        testConfigId: null,
        testId: utils.guid(),
        resultId: utils.guid(),
        isTestsContainer: true
    }))];
    suite.runName = 'Testim Dev Kit Run ' + (new Date().toLocaleString());
    return suite;
}

// copied mostly from facebook/create-react-app/blob/8b7b819b4b9e6ba457e011e92e33266690e26957/packages/react-scripts/config/env.js
function getEnvironmentVariables(runnerOptionsToMaybeCopyToTestEnvironment) {

    let fromEnvironment = _.fromPairs(
        Object.keys(process.env)
                .filter(key => /^TDK_/i.test(key) || key === 'BASE_URL')
                .map(key => [key, process.env[key]])
    );

    let fromConfig = {
        'BASE_URL': runnerOptionsToMaybeCopyToTestEnvironment.baseUrl
    };

    return {
        'process.env': stringifyValues({ ...fromConfig, ...fromEnvironment})
    };
}
function stringifyValues(object) {
    return _.fromPairs(Object.entries(object).map(([key, value]) => [key, JSON.stringify(value)]));
}

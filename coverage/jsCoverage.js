'use strict';

const _ = require('lodash');
const Bluebird = require('bluebird');
const servicesApi = require('../commons/testimServicesApi'); const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const path = require('path');
const mkdirp = require('mkdirp');
const lazyRequire = require('../commons/lazyRequire');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');
const SummaryToObjectReport = require('./SummaryToObjectReport');
const { ArgError } = require('../errors');
const ora = require('ora');
const moment = require('moment');
const TestExclude = require('test-exclude');

const logger = require('../commons/logger').getLogger('test-run-status');

const convertToURL = (path) => {
    try {
        return new URL(path);
    } catch (err) {
        try {
            return new URL(`file://${path}`);
        } catch (e) {
            return {};
        }
    }
};

const pathHasQueryParam = (path) => {
    const urlObj = convertToURL(path);
    return !!urlObj.search;
};

const parsePath = (path) => {
    if (!path) {
        return '';
    }
    const urlObj = convertToURL(path);
    return urlObj.pathname.substring(1);
};

const excludePath = (codeCoverageInclude, path) => {
    const pathname = parsePath(path);
    const exclude = new TestExclude({
        relativePath: false,
        include: codeCoverageInclude,
    });

    return !exclude.shouldInstrument(pathname);
};

const removeAfterQuestionMark = (str) => str.substring(0, str.indexOf('?'));

module.exports.getSourceMap = async ({ source, sourceMapDir, sourceMapType }) => {
    const convertSourceMap = await lazyRequire('convert-source-map');
    if (sourceMapType === 'file' && !sourceMapDir) {
        throw new ArgError('--code-coverage-source-map-path [path]');
    }
    return sourceMapDir ?
        convertSourceMap.fromMapFileSource(source, sourceMapDir) :
        convertSourceMap.fromSource(source);
};

module.exports.remapCoverage = async (options, storagePath, sourceMaps) => {
    const { codeCoverageInclude } = options;
    await Promise.all(Object.values(sourceMaps).map(async (sourceMap) => {
        if (!sourceMap) {
            return;
        }
        const sourceMapObject = sourceMap.toObject();
        await Promise.all(sourceMapObject.sources.map(async (sourcePath, index) => {
            if (excludePath(codeCoverageInclude, sourcePath)) {
                return;
            }
            const parsedPath = rewritePath(storagePath, sourcePath);
            await mkdirp(path.parse(parsedPath).dir);
            await fs.writeFileAsync(parsedPath, sourceMapObject.sourcesContent[index]);
        }));
    }));
};

const htmlReportLinkMapper = {
    getPath(node) {
        if (typeof node === 'string') {
            return node;
        }
        let filePath = node.getQualifiedName();
        if (node.isSummary()) {
            if (filePath !== '') {
                filePath += '/index.html';
            } else {
                filePath = 'index.html';
            }
        } else {
            if (pathHasQueryParam(filePath)) {
                filePath = removeAfterQuestionMark(filePath);
            }
            filePath += '.html';
        }
        return filePath;
    },

    relativePath(source, target) {
        const targetPath = this.getPath(target);
        const sourcePath = path.dirname(this.getPath(source));
        return path.posix.relative(sourcePath, targetPath);
    },

    assetPath(node, name) {
        return this.relativePath(this.getPath(node), name);
    },
};

const rewritePath = (storagePath, fileUrl) => {
    const parsedPath = path.resolve(storagePath, parsePath(fileUrl));
    return `${parsedPath}.js`;
};

module.exports.saveCoverageReports = async (options, coverageMap, reportDir, tempJsDir) => {
    const { codeCoverageReporter } = options;
    const reportSummary = {};
    const context = libReport.createContext({
        dir: reportDir,
        coverageMap,
        watermarks: libReport.getDefaultWatermarks(),
        sourceFinder: (filePath) => {
            try {
                const parsedPath = rewritePath(tempJsDir, filePath);
                return fs.readFileSync(parsedPath, 'utf8');
            } catch (ex) {
                throw new Error(`Unable to lookup source: ${filePath} (${ex.message})`);
            }
        },
    });

    (new SummaryToObjectReport({ appendToObject: reportSummary })).execute(context);
    if (Array.isArray(codeCoverageReporter)) {
        codeCoverageReporter.forEach((reporter) => {
            let cfg = { projectRoot: '/' };
            if (reporter === 'html') {
                cfg = { linkMapper: htmlReportLinkMapper };
            }
            reports.create(reporter, cfg).execute(context);
        });
    }
    return reportSummary;
};

module.exports.convertV8ToIstanbul = async (options, { source, sourceMap, functions }) => {
    const { codeCoverageInclude } = options;
    if (!sourceMap || sourceMap.sourcemap.sources.length === 0) {
        return undefined;
    }
    const v8toIstanbul = await lazyRequire('v8-to-istanbul');
    const converter = v8toIstanbul('FAKE_PATH', 0, {
        source,
        sourceMap,
    }, (path) => excludePath(codeCoverageInclude, path));
    await converter.load();
    converter.applyCoverage(functions);
    return converter.toIstanbul();
};

const collectAndMergeJsCoverageData = async (projectId, branch, runId) => {
    const DOWNLOAD_COVERAGE_DATA_CONCURRENCY = 20;
    const { mergeProcessCovs } = await lazyRequire('@bcoe/v8-coverage');
    let mergedCoverages = { result: [] };

    const covUrlMap = new Map();
    const realDataRes = await servicesApi.getRealData(projectId, 'testResult', `runId=${runId}`);
    const testResults = realDataRes.data.docs;

    await Bluebird.map(
        _.flatten(testResults.map((testResult) => testResult.JSCoverageURLS || [])),
        async (coverageURL) => {
            const data = await servicesApi.getS3Artifact(coverageURL, 90000);
            await Bluebird.map(data, async (cov) => {
                if (!covUrlMap.has(cov.url)) {
                    let text = cov.text;
                    if (cov.sourceUrl) {
                        // set temp value to reduce read S3 file
                        covUrlMap.set(cov.url, 'TEMP');
                        text = await servicesApi.getS3ArtifactText(cov.sourceUrl);
                    }
                    covUrlMap.set(cov.url, {
                        text,
                        url: cov.url,
                        sourceMapType: cov.sourceMapType,
                        hash: cov.hash,
                    });
                }
                delete cov.text;
                mergedCoverages = mergeProcessCovs([mergedCoverages, { result: [cov] }]);
            });
        }, { concurrency: DOWNLOAD_COVERAGE_DATA_CONCURRENCY }
    );

    return { covUrlMap, mergedCoverages };
};

module.exports.calculateCoverage = async (options, branchToUse, numOfTests, runId) => {
    if (!options.collectCodeCoverage) {
        return undefined;
    }
    logger.info('start js coverage process');
    const spinner = ora(`analyzing coverage for ${numOfTests} ${numOfTests === 1 ? 'test' : 'tests'}`).start();
    const baseDir = path.resolve(options.codeCoverageReportPath || './coverage');
    const tempJsDir = path.resolve(baseDir, `.js/${moment().format('DDMMYYYYHHmmss')}`);
    const sourceMapDir = options.codeCoverageSourceMapPath ? path.resolve(options.codeCoverageSourceMapPath) : undefined;
    try {
        const [libCoverage, { mergedCoverages, covUrlMap }] = await Promise.all([
            lazyRequire('istanbul-lib-coverage'),
            collectAndMergeJsCoverageData(options.project, branchToUse, runId),
        ]);

        if (mergedCoverages.result.length === 0) {
            spinner.fail('Failed to report coverage information - js code coverage is empty');
            return undefined;
        }
        logger.info('start js coverage merge and remap', { numOfFiles: covUrlMap.size, numMergedCoverages: mergedCoverages.result.length });
        const coverageMap = libCoverage.createCoverageMap({});

        const sourceMaps = {};
        await Promise.all(mergedCoverages.result.map(async ({ url, functions }) => {
            const { text: source, sourceMapType } = covUrlMap.get(url);

            const sourceMap = await this.getSourceMap({ sourceMapType, url, source, sourceMapDir });
            sourceMaps[url] = sourceMap;

            const istanbulCoverage = await this.convertV8ToIstanbul(options, { source, sourceMap, functions });
            coverageMap.merge(istanbulCoverage);
        }));
        await this.remapCoverage(options, tempJsDir, sourceMaps);
        const coverageSummary = await this.saveCoverageReports(options, coverageMap, baseDir, tempJsDir);
        spinner.succeed();
        return coverageSummary;
    } catch (err) {
        const baseMsg = 'Failed to report coverage information';
        if (err instanceof ArgError) {
            spinner.fail(`${baseMsg}, missing arg: ${err.message}`);
        } else {
            spinner.fail(baseMsg);
        }
        logger.error(baseMsg, { err });
    }

    return undefined;
};

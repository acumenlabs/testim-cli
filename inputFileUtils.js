'use strict';

const httpRequest = require('./commons/httpRequest');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const os = require('os');
const logger = require('./commons/logger').getLogger('input-file-utils');

function getVisibleElementScript(positionAndSize = {
    width: '2px', height: '2px', left: '0px', top: '400px',
}) {
    const zIndex = 100000000;
    const opacity = 1;
    return `function getVisibleElement(locatedElement) {
        var input = getLocatedElement(locatedElement);
        if(input) {
            function parents(element, _elements) {
                _elements = _elements || [];
                _elements.push(element);
                if(element.parentNode && element.tagName !== 'BODY') {
                    return parents(element.parentNode, _elements);
                }
                return _elements;
            }

            function forceStyle(el, name, value) {
                el.style.setProperty(name, value, 'important');
            }

            Array.apply(null, parents(input)).forEach(function(el) {
                let element = el;
                if (element instanceof DocumentFragment) {
                    element = element.host
                }

                var displayMode = window.getComputedStyle(element).display;
                if(displayMode === "none") {
                    forceStyle(element, 'display', 'block');
                }
            })

            forceStyle(input, 'visibility', 'visible');
            forceStyle(input, 'width', '${positionAndSize.width}');
            forceStyle(input, 'max-width', '${positionAndSize.width}');
            forceStyle(input, 'height', '${positionAndSize.height}');
            forceStyle(input, 'max-height', '${positionAndSize.height}');
            forceStyle(input, 'z-index', ${zIndex});
            forceStyle(input, 'opacity', ${opacity});
            forceStyle(input, 'top', '${positionAndSize.top}');
            forceStyle(input, 'left', '${positionAndSize.left}');
            forceStyle(input, 'position', 'fixed');
            forceStyle(input, 'pointer-events', 'all');
            input.removeAttribute("disabled");
            input.focus();
        }
    }`;
}

async function downloadFile(fileUrl, fileName) {
    let body = null;
    try {
        const res = await httpRequest.download(fileUrl);
        body = res.body;
    } catch (err) {
        logger.error('failed to download input-file content',
            { err: { message: err.message, stack: err.stack, status: err.status } });
        if (err.response) {
            // try to emulate what we essentially do in clickim
            body = err.response.body;
        } else {
            // we have a circular object
            if (err.cause) {
                throw new Error(err.message);
            }
            throw err;
        }
    }

    const localFileLocation = `${os.tmpdir()}/${fileName}`;
    await fs.writeFileAsync(localFileLocation, body);
    return localFileLocation;
}

function downloadFiles(fileUrls) {
    return Promise.map(fileUrls, file => downloadFile(file.url, file.name));
}

function uploadFileToGrid(localFileLocation, uploadFileFn) {
    return uploadFileFn(localFileLocation);
}

function downloadFilesAndUploadToGrid(fileUrls, uploadFileFn) {
    return downloadFiles(fileUrls)
        .then(filesOnDisk => Promise.map(filesOnDisk, localFileLocation => uploadFileToGrid(localFileLocation, uploadFileFn)))
        .then(gridLocalFiles => Array.isArray(gridLocalFiles) && gridLocalFiles.map(gridLocalFile => gridLocalFile && gridLocalFile.value));
}

module.exports = {
    getVisibleElementScript,
    downloadFilesAndUploadToGrid,
};

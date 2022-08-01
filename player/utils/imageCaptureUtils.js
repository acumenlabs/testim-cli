'use strict';

const Promise = require('bluebird');
const Jimp = require('jimp');

const logger = require('../../commons/logger').getLogger('image-capture-utils');

class RectIsOutsideOfImageError extends Error {
    constructor(message) {
        super(message);
        this.rectIsOutsideOfImageError = true;
        Object.setPrototypeOf(this, RectIsOutsideOfImageError.prototype);
    }
}

const ImageCaptureUtils = function (tabId, windowUtils, screenshotUtils) {
    this.windowUtils = windowUtils;
    this.screenshotUtils = screenshotUtils;
};

function cropImageFromImageData(imageData, imageInfo) {
    const image = imageInfo.image || imageInfo;
    const pixelRatio = imageInfo.devicePixelRatio;

    if (!image) {
        return Promise.reject(new Error('Failed to get image'));
    }

    const imageRegExMatch = image.match(/^data\:[^;]*\;base64,(.*)$/);
    if (!imageRegExMatch) {
        return Promise.reject(new Error('Image is not in base64 format'));
    }

    // chromeCropImage2
    const offset = imageData.offset || { top: 0, left: 0 };

    offset.top *= pixelRatio;
    offset.left *= pixelRatio;

    // elementImage
    if (!imageData.elementRect) {
        const { image, ...rest } = imageData;
        logger.warn('missing elementRect', { ...rest });
        return Promise.resolve({});
    }

    const { elementRect } = imageData;
    return new Promise((resolve, reject) => {
        Jimp.read(Buffer.from(imageRegExMatch[1], 'base64'), (err, image) => {
            if (err) {
                return reject(err);
            }
            try {
                let x = elementRect.left * pixelRatio + offset.left * pixelRatio;
                let y = elementRect.top * pixelRatio + offset.top * pixelRatio;
                let width = elementRect.width * pixelRatio;
                let height = elementRect.height * pixelRatio;

                if (x < 0) {
                    width += x;
                    width = width < 0 ? 0 : width;
                    x = 0;
                }

                if (y < 0) {
                    height += y;
                    height = height < 0 ? 0 : height;
                    y = 0;
                }

                const imageWidth = image.bitmap.width;
                const imageHeight = image.bitmap.height;
                if ((x + width) > imageWidth) {
                    width = imageWidth - x;
                }

                if ((y + height) > imageHeight) {
                    height = imageHeight - y;
                }

                if (height <= 0 || width <= 0) {
                    reject(new RectIsOutsideOfImageError('height or width is equal or lower than zero'));
                    return undefined;
                }

                const cImage = image.crop(x, y, width, height);
                cImage.getBase64(Jimp.MIME_PNG, (err, base64) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve({
                        elementImage: base64,
                    });
                    return undefined;
                });
                return undefined;
            } catch (err) {
                return reject(err);
            }
        });
    });
}


function chromeStitchImage(fullSize, parts) {
    return new Promise((resolve, reject) => {
        new Jimp(fullSize.width, fullSize.height, ((err, fullImage) => {
            if (err) {
                reject(err);
                return undefined;
            }
            return Promise.each(parts, part => new Promise((resolve, reject) => {
                const imageRegExMatch = part.image.match(/^data\:[^;]*\;base64,(.*)$/);
                Jimp.read(Buffer.from(imageRegExMatch[1], 'base64'), (err, partImage) => {
                    if (err) {
                        return reject(err);
                    }
                    fullImage.composite(partImage, part.position.left, part.position.top, (err, image) => {
                        if (err) {
                            return reject(err);
                        }
                        resolve(image);
                        return undefined;
                    });
                    return undefined;
                });
            })).then(() => {
                fullImage.getBase64(Jimp.MIME_PNG, (err, base64) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(base64);
                    return undefined;
                });
            });
        }));
    });
}

function stitchImage(fullSize, parts) {
    return chromeStitchImage(fullSize, parts);
}

function uploadDataUrl() {
    return Promise.resolve();
}

function uploadAllDataUrls(imagesObject) {
    function isImageUrl(key) {
        return (typeof imagesObject[key] === 'string') && imagesObject[key].startsWith('data');
    }

    function updateKey(key) {
        return uploadDataUrl(imagesObject[key]).then((imageUrl) => ({ key, url: imageUrl }));
    }

    return Promise.all(Object.keys(imagesObject).filter(isImageUrl).map(updateKey))
        .then((keyUrlList) => keyUrlList.reduce((obj, current) => {
            obj[current.key] = current.url;
            return obj;
        }, imagesObject));
}

function getElementAbsoluteRectangle(elementRect, pixelRatio) {
    pixelRatio = pixelRatio || 1;
    elementRect = elementRect || {
        left: 0, top: 0, width: 0, height: 0,
    };
    return {
        left: pixelRatio * Math.round(elementRect.left),
        top: pixelRatio * Math.round(elementRect.top),
        width: pixelRatio * Math.round(elementRect.width),
        height: pixelRatio * Math.round(elementRect.height),
        pixelRatio,
    };
}

ImageCaptureUtils.prototype = {
    takeViewPortImage() {
        return this.screenshotUtils.takeScreenshot()
            .then((imageInfo) => ((typeof imageInfo === 'string') ? imageInfo : imageInfo.image));
    },

    takeImageForComparison() {
        return this.takeViewPortImage();
    },

    takeAreaDataUrl(areas, format) {
        // Future changes in clickim will pass parameters to this function as a single object
        if (areas.areas) {
            areas = areas.areas;
        }

        return this.screenshotUtils.takeScreenshot(format)
            .then((imageInfo) => cropImageFromImageData(areas, imageInfo).then((result) => {
                result.screenImage = imageInfo.image;
                result.absoluteScreenHighlight = getElementAbsoluteRectangle(
                    areas.elementRect,
                    imageInfo.devicePixelRatio);
                return Promise.resolve(result);
            }));
    },

    takeArea(areas) {
        // Future changes in clickim will pass parameters to this function as a single object
        if (areas.areas) {
            areas = areas.areas;
        }

        return this.screenshotUtils.takeScreenshot()
            .then((imageInfo) => {
                const result = {};
                result.screenImage = imageInfo.image;
                result.absoluteScreenHighlight = getElementAbsoluteRectangle(
                    areas.elementRect,
                    imageInfo.devicePixelRatio);
                return Promise.resolve(result);
            }).then(uploadAllDataUrls);
    },

    forcePixelRatio(forceRatio) {
        return this.screenshotUtils.forcePixelRatio(forceRatio);
    },

    getCurrentDevicePixelRatio() {
        return this.screenshotUtils.getCurrentDevicePixelRatio();
    },

    takeStitchedDataUrl(useImprovedScreenshotStitching) {
        const windowUtil = this.windowUtils;
        const getCurrentScrollPosition = windowUtil.getCurrentScrollPosition.bind(windowUtil);

        const that = this;
        const stabilize = () => new Promise(resolve => {
            setTimeout(resolve, 250);
        });
        const usingImprovedStitching = Boolean(useImprovedScreenshotStitching);
        const scroll = usingImprovedStitching ?
            (pos) => windowUtil.scrollToPositionWithoutAnimation.bind(windowUtil)(pos) :
            (pos) => windowUtil.scrollToPosition.bind(windowUtil)(pos);

        function createPart(position, crop) {
            return scroll(position)
                .then(stabilize)
                .then(() => that.screenshotUtils.takeScreenshot())
                .then(imageInfo => {
                    const imageData = {
                        elementRect: crop,
                    };
                    return cropImageFromImageData(imageData, imageInfo);
                })
                .then(cropResult => ({
                    position: { left: position.x + crop.left, top: position.y + crop.top },
                    size: { width: crop.width, height: crop.height },
                    image: cropResult.elementImage,
                }));
        }

        function takeAllParts(positionsData) {
            const takeAllPartsPromises = positionsData.reduce(function (allParts, nextPos) {
                const lastPart = allParts[allParts.length - 1];
                allParts.push(lastPart.then(createPart.bind(this, nextPos.scrollPos, nextPos.cropData)));
                return allParts;
            }, [Promise.resolve()]);
            return Promise.all(takeAllPartsPromises);
        }

        function getPartsPositions(fullPageSize, viewPortSize) {
            const FPW = Math.max(fullPageSize.width, viewPortSize.width);
            const VPW = viewPortSize.width;
            const FPH = Math.max(fullPageSize.height, viewPortSize.height);
            const VPH = viewPortSize.height;
            const Ws = (Array.apply(null, new Array(Math.ceil(FPW / VPW)))).map((_, i) => ({
                scrollX: Math.min(i * VPW, FPW - VPW),
                cropX: i * VPW - Math.min(i * VPW, FPW - VPW),
                cropW: VPW - (i * VPW - Math.min(i * VPW, FPW - VPW)),
            }));
            const Hs = (Array.apply(null, new Array(Math.ceil(FPH / VPH)))).map((_, i) => ({
                scrollY: Math.min(i * VPH, FPH - VPH),
                cropY: i * VPH - Math.min(i * VPH, FPH - VPH),
                cropH: VPH - (i * VPH - Math.min(i * VPH, FPH - VPH)),
            }));
            const positions = Ws.reduce((posList, w) => posList.concat(Hs.map((h) => ({
                scrollPos: { x: w.scrollX, y: h.scrollY },
                cropData: {
                    top: h.cropY, left: w.cropX, width: w.cropW, height: h.cropH,
                },
            }))), []);
            return positions;
        }

        async function createStitchImage(fullPageSize, viewPortSize) {
            const originalPosition = await getCurrentScrollPosition();
            const positions = getPartsPositions(fullPageSize, viewPortSize);
            const parts = await takeAllParts(positions);
            await windowUtil.scrollToPosition(originalPosition);
            parts.shift();
            return stitchImage(fullPageSize, parts);
        }

        return Promise.all([windowUtil.getFullPageSize(), windowUtil.getViewportSize()])
            .then(([fullPageSize, viewPortSize]) => createStitchImage(fullPageSize, viewPortSize));
    },
};

module.exports = ImageCaptureUtils;

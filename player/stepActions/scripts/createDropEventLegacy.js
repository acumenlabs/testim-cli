module.exports = function(blobs) {
    function blobToFile(theBlob, fileName) {
        try {
            // Doesn't work on IE11/Edge https://developer.mozilla.org/en-US/docs/Web/API/File/File
            return new File([theBlob], fileName, {type: theBlob.type});
        } catch (err) {
            var date = new Date();
            theBlob.lastModifiedDate = date;
            theBlob.lastModified = date.getTime();
            theBlob.name = fileName;
            return theBlob;
        }
    }

    function createDropEvent(files) {
        // add item function - FileList spec
        files.item = function (index) {
            return this[index];
        };
        function getItems() {
            var items = [];
            files.forEach(function (file) {
                items.push({
                    kind: "file",
                    type: file.type,
                    getAsFile: function () {
                        return file;
                    }
                });
            });
            return items;
        }
        var dataTransferObject = {
            enumerable: true,
            configurable: true,
            get: function () {
                return {
                    files: files,
                    types: ["Files"],
                    items: getItems()
                };
            },
        };
        var event = document.createEvent("HTMLEvents");
        event.initEvent("drop", true, true);
        Object.defineProperties(event, {
            originalEvent: {
                enumerable: true,
                configurable: true,
                get: function () {
                    return event;
                }
            },
            dataTransfer: dataTransferObject
        });
        return event;
    }

    var files = blobs.map(function(blob) { return blobToFile(blob.blob, blob.name); });
    return createDropEvent(files);
};

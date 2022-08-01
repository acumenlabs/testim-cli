"use strict";

var downloadFileAndFireDropEvent = function (locatedElement, fileUrls) {
    var element = getLocatedElement(locatedElement);

    if(!element) {
        throw new Error('element not found');
    }

    function simpleBarrier() {
        var callbackIndex = -1,
            doneCallbacks = 0,
            results = [];
        var instance = {
            waitOn: function(){
                var curIndex = ++callbackIndex;
                return function(result){
                    if(curIndex in results) {
                        return;
                    }
                    results[curIndex] = result;
                    doneCallbacks++;
                    if(fileUrls.length === doneCallbacks) {
                        instance.endWithCallback(results);
                    }
                };
            },
            endWith: function(fn) { instance.endWithCallback = fn; }
        };
        return instance;
    }

    function getBlob(url, name, cb) {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", url);
        xhr.responseType = "blob";
        xhr.onload = function () {
            if (this.status >= 200 && this.status < 300) {
                cb({blob: xhr.response, name: name});
            } else {
                throw new Error("Failed to load blob response code is not between 200 - 300");
            }
        };
        xhr.onerror = function () {
            throw new Error("Failed to load blob");
        };
        xhr.send();
    }

    var barrier = simpleBarrier();
    fileUrls.forEach(function (fileUrl) {
        getBlob(fileUrl.url, fileUrl.name, barrier.waitOn());
    });
    barrier.endWith(function (blobs){
        var event = createDropEvent(blobs);
        element.dispatchEvent(event);
    });
};

module.exports = downloadFileAndFireDropEvent;

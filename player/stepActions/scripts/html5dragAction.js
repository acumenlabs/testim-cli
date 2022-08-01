/* global getLocatedElement */

'use strict';

var html5dndAction = function(eventData) {
    var data = {};
    function convertType(type) {
        if (!type || !type.toLowerCase) {
            return type;
        }
        type = type.toLowerCase();
        if (type === 'text') {
            return 'text/plain';
        }
        if (type === 'url') {
            return 'text/uri-list'
        }
        return type;
    }
    var dataTransfer = {
        data: {
        },
        setData: function(type, val){
            data[convertType(type)] = val;
        },
        getData: function(type){
            return data[convertType(type)];
        }
    };
    var fromElement = getLocatedElement(eventData.fromLocatedElement);
    var toElement = getLocatedElement(eventData.toLocatedElement);

    if (!fromElement) {
        throw new Error('from element not found');
    }

    if (!toElement) {
        throw new Error('to element not found');
    }

    var dispatchEvent = function(element, type) {
        var event = document.createEvent("CustomEvent");
        event.initCustomEvent(type, true, true, null);
        event.dataTransfer = dataTransfer;
        if(element.dispatchEvent) {
            element.dispatchEvent(event);
        } else if( element.fireEvent ) {
            element.fireEvent("on"+type, event);
        }
    };
    dispatchEvent(fromElement, 'dragstart');
    dispatchEvent(toElement, 'drop');
    dispatchEvent(fromElement, 'dragend');
};

module.exports = html5dndAction;

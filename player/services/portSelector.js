"use strict";
const Promise = require('bluebird');

// Legacy code not supported in selenium mode
class PortSelector {
    constructor(){}
    select(){
        console.log("\n\t\t\tinternal error - cant use port selector in selenium!!!!\n");
        return Promise.reject({
            reason: "cant use port selector in selenium!"
        });
    }
    prepare(){}
    handleLegacyDataCaching() {}
}

module.exports = new PortSelector();



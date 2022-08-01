const os = require('os');
const { getCliLocation } = require('../utils');

function additionalLogDetails() {
    return {
        cliLocation: getCliLocation(),
        userInfo: os.userInfo(),
        platform: os.platform(),
        release: os.release(),
    };
}

module.exports = {
    additionalLogDetails,
};

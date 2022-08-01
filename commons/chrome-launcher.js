"use strict";

const { exec } = require("child_process");

module.exports.launchChrome = function(url) {
    const { platform } = process;

    if (platform === "win32") {
        exec(`start chrome ${url}`);
    } else if (platform === "darwin") {
        exec(`open -a "Google Chrome" ${url}`);
    } else if (platform === "linux") {
        exec(`google-chrome ${url}`);
    }
};

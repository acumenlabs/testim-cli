'use strict';

// fixes the local build if running the runner locally
const path = require('path');
const { execSync } = require('child_process');
const { existsSync } = require('fs');

const location = path.resolve(__filename);
const isDevBuild = !location.includes('node_modules') && path.dirname(location).endsWith('src');

if (!isDevBuild) {
    return;
}

const isDepBuilt = existsSync(path.resolve(location, '..', '..', '..', 'webdriverio', 'build', 'index.js'));

if (!isDepBuilt) {
    console.log("Hi developer, we're initializing the runner dev env for the first time for you ❤️");
    execSync('yarn workspace @testim/webdriverio build', {
        cwd: path.resolve(location, '..', '..'),
    });
}

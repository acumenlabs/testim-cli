"use strict";

let currentBranch;

function getCurrentBranch() {
    return currentBranch || "master";
}
function setCurrentBranch(branchData = "master", acknowledgeAutoDetect = "false") {
    if (branchData && branchData.branch && branchData.branch === 'master') {
        currentBranch = 'master';
        return;
    }
    if (branchData && !branchData.isArchived) {
        currentBranch = branchData.branch || branchData;
        return;
    }
    currentBranch = acknowledgeAutoDetect ? 'master' : null;
}

module.exports = {
    getCurrentBranch,
    setCurrentBranch
};

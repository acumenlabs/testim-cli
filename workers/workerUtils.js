const Promise = require('bluebird');
const gridService = require('../services/gridService');
const logger = require('../commons/logger').getLogger('worker-utils');

const releaseGridSlot = (workerId, releaseSlotOnTestFinished, projectId) => {
    if (!releaseSlotOnTestFinished) {
        return Promise.resolve();
    }
    return gridService.releaseGridSlot(workerId, projectId);
};

const releasePlayer = (workerId, releaseSlotOnTestFinished, projectId, player) => {
    logger.info('releasing player', { hasPlayer: Boolean(player) });
    return (player ? player.onDone() : Promise.resolve())
        .finally(() => releaseGridSlot(workerId, releaseSlotOnTestFinished, projectId));
};

module.exports.releasePlayer = releasePlayer;

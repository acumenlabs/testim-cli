const { expect } = require('chai');
const os = require('os');
const { additionalLogDetails } = require('./logUtils');
const { getCliLocation } = require('../utils');

describe('logUtils', () => {
    describe('additionalLogDetails', () => {
        it('should return the expected unformation', () => {
            const expected = {
                cliLocation: getCliLocation(),
                userInfo: os.userInfo(),
                platform: os.platform(),
                release: os.release(),
            };

            const result = additionalLogDetails();

            expect(result).to.eql(expected);
        });
    });
});

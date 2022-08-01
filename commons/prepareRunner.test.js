const { sinon, expect } = require('../../test/utils/testUtils');
const utils = require('../utils');
const { prepareMockNetwork } = require('./prepareRunner');

describe('prepareRunner', () => {
    describe('prepareMockNetwork', () => {
        const localFileUrl = './rules.json';
        const remoteFileUrl = 'https://s3/testim/files/rules.json';
        let getSourceAsBufferStub;

        beforeEach(() => {
            getSourceAsBufferStub = sinon.stub(utils, 'getSourceAsBuffer');
        });

        afterEach(() => {
            sinon.restore();
        });

        it('prepareMockNetwork rejected with - exceeded 1MB', () => {
            // Arrange:
            const buf = Buffer.alloc(1000001);
            getSourceAsBufferStub.withArgs(localFileUrl).returns(Promise.resolve(buf));

            // Act:
            const mockNetworkRules = prepareMockNetwork(localFileUrl);

            // Assert:
            sinon.assert.calledOnce(getSourceAsBufferStub);
            return expect(mockNetworkRules).to.be.rejectedWith('exceeded 1MB');
        });

        it('prepareMockNetwork rejected with - cannot be parsed', () => {
            // Arrange:
            const buf = Buffer.from('{a: 1}');
            getSourceAsBufferStub.withArgs(localFileUrl).returns(Promise.resolve(buf));

            // Act:
            const mockNetworkRules = prepareMockNetwork(localFileUrl);

            // Assert:
            sinon.assert.calledOnce(getSourceAsBufferStub);
            return expect(mockNetworkRules).to.be.rejectedWith('cannot be parsed');
        });

        it('prepareMockNetwork rejected with - is malformed', () => {
            // Arrange:
            const buf1 = Buffer.from('{"a": 1}');
            const buf2 = Buffer.from(JSON.stringify({
                version: '2.0.0',
                entries: [],
            }));
            const buf3 = Buffer.from(Buffer.from(JSON.stringify({
                version: '1.0.0',
                entries: [{
                    request: {
                        url: '/test/*',
                    },
                }],
            })));
            const buf4 = Buffer.from(Buffer.from(JSON.stringify({
                version: '1.0.0',
                entries: [{
                    request: {
                        url: '/test/*',
                        method: 'POSTTTTT',
                    },
                    response: {
                        status: 200,
                    },
                }],
            })));
            const buf5 = Buffer.from(Buffer.from(JSON.stringify({
                version: '1.0.0',
                entries: [{
                    request: {
                        url: '/test/*',
                    },
                    response: {
                        status: 600,
                    },
                }],
            })));
            const buf6 = Buffer.from(Buffer.from(JSON.stringify({
                version: '1.0.0',
                entries: [{
                    request: {
                        url: '/test/*',
                    },
                    response: {
                        status: 400.1,
                    },
                }],
            })));
            getSourceAsBufferStub.withArgs(`${remoteFileUrl}.1`).returns(Promise.resolve(buf1));
            getSourceAsBufferStub.withArgs(`${remoteFileUrl}.2`).returns(Promise.resolve(buf2));
            getSourceAsBufferStub.withArgs(`${remoteFileUrl}.3`).returns(Promise.resolve(buf3));
            getSourceAsBufferStub.withArgs(`${remoteFileUrl}.4`).returns(Promise.resolve(buf4));
            getSourceAsBufferStub.withArgs(`${remoteFileUrl}.5`).returns(Promise.resolve(buf5));
            getSourceAsBufferStub.withArgs(`${remoteFileUrl}.6`).returns(Promise.resolve(buf6));

            // Act:
            const mockNetworkRules1 = prepareMockNetwork(`${remoteFileUrl}.1`);
            const mockNetworkRules2 = prepareMockNetwork(`${remoteFileUrl}.2`);
            const mockNetworkRules3 = prepareMockNetwork(`${remoteFileUrl}.3`);
            const mockNetworkRules4 = prepareMockNetwork(`${remoteFileUrl}.4`);
            const mockNetworkRules5 = prepareMockNetwork(`${remoteFileUrl}.5`);
            const mockNetworkRules6 = prepareMockNetwork(`${remoteFileUrl}.6`);

            // Assert:
            return Promise.all([
                expect(mockNetworkRules1).to.be.rejectedWith('is malformed'),
                expect(mockNetworkRules2).to.be.rejectedWith('is malformed'),
                expect(mockNetworkRules3).to.be.rejectedWith('is malformed'),
                expect(mockNetworkRules4).to.be.rejectedWith('is malformed'),
                expect(mockNetworkRules5).to.be.rejectedWith('is malformed'),
                expect(mockNetworkRules6).to.be.rejectedWith('is malformed'),
            ]);
        });

        it('prepareMockNetwork is fine', () => {
            // Arrange:
            const buf = Buffer.from(JSON.stringify({
                version: '1.2',
                entries: [{
                    request: {
                        url: '/test/*',
                        method: 'POST',
                    },
                    response: {
                        status: 400,
                    },
                }],
            }));
            getSourceAsBufferStub.withArgs(localFileUrl).returns(Promise.resolve(buf));

            // Act:
            const mockNetworkRules = prepareMockNetwork(localFileUrl);

            // Assert:
            sinon.assert.calledOnce(getSourceAsBufferStub);
            return expect(mockNetworkRules).to.be.fulfilled;
        });
    });
});

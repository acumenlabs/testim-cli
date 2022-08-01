const chai = require('chai');
const utils = require('./utils');

const expect = chai.expect;

describe('utils', () => {
    describe('calcPercentile', () => {
        it('should calc some precentiles', () => {
            // Arrange:
            const arr = [4, 5, 1, 2, 7, 8, 3, 6, 9, 10];

            // Act:
            const p0 = utils.calcPercentile(arr, 0);
            const p50 = utils.calcPercentile(arr, 50);
            const p90 = utils.calcPercentile(arr, 90);
            const p95 = utils.calcPercentile(arr, 95);
            const p100 = utils.calcPercentile(arr, 100);

            // Assert:
            expect(p0).to.eql(1);
            expect(p50).to.eql(5);
            expect(p90).to.eql(9);
            expect(p95).to.eql(10);
            expect(p100).to.eql(10);
        });
    });
    describe('getTestUrl', () => {
        it('should create properly escaped test URL', () => {
            expect(utils.getTestUrl('http://localhost:8080', 'project', 'test')).to.equal('http://localhost:8080/#/project/project/branch/master/test/test');
            expect(utils.getTestUrl('http://localhost:8080', 'project', 'test', 'result')).to.equal('http://localhost:8080/#/project/project/branch/master/test/test?result-id=result');
            expect(utils.getTestUrl('http://localhost:8080', 'project', 'test', 'result', null)).to.equal('http://localhost:8080/#/project/project/branch/master/test/test?result-id=result');
            expect(utils.getTestUrl('http://localhost:8080', 'project', 'test', 'result', 'normal-branch-name'))
                .to.equal('http://localhost:8080/#/project/project/branch/normal-branch-name/test/test?result-id=result');
            expect(utils.getTestUrl('http://localhost:8080', 'project', 'test', 'result', 'branch/with/slashes'))
                .to.equal('http://localhost:8080/#/project/project/branch/branch%2Fwith%2Fslashes/test/test?result-id=result');
            expect(utils.getTestUrl('http://localhost:8080', 'project', 'test', 'result', 'branch with spaces'))
                .to.equal('http://localhost:8080/#/project/project/branch/branch%20with%20spaces/test/test?result-id=result');
            expect(utils.getTestUrl('http://localhost:8080', 'project', 'test', 'result', 'encoded%20branch'))
                .to.equal('http://localhost:8080/#/project/project/branch/encoded%2520branch/test/test?result-id=result');
        });
    });

    describe('getArgsOnRemoteRunFailure', () => {
        let originalArgv;

        beforeEach(() => {
            originalArgv = process.argv;
        });

        afterEach(() => {
            process.argv = originalArgv;
        });

        it('should return undefined if no remote run is current', () => {
            process.argv = ['node', 'file.js', '--token', 'token', '--project', 'project-id'];
            expect(utils.getArgsOnRemoteRunFailure()).to.be.undefined;
        });

        it('should return details if remote run is current', () => {
            process.argv = ['node', 'file.js', '--token', 'token', '--project', 'project-id', '--remoteRunId', 'remote-run-id'];
            expect(utils.getArgsOnRemoteRunFailure()).to.eql({
                remoteRunId: 'remote-run-id',
                projectId: 'project-id',
                token: 'token',
            });
        });
    });
});

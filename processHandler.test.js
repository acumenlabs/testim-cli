
const { delay } = require('bluebird');
const EventEmitter = require('events');
const { expect, sinon } = require('../test/utils/testUtils');
const processHandler = require('./processHandler');


class Process extends EventEmitter {
    constructor() {
        super();
        this.stdout = new EventEmitter();
        this.stderr = new EventEmitter();
    }
}

describe('testimTunnel', () => {
    let process;
    let onExitMock;

    beforeEach(() => {
        process = new Process();
        onExitMock = sinon.spy();
        processHandler(onExitMock, process);
    });

    afterEach(async () => {
        await delay(10);
        expect(onExitMock).to.have.been.calledOnce;
        processHandler.reset();
    });


    it('should register a SIGTERM handler', (done) => {
        processHandler.registerExitHook(done);
        expect(() => process.emit('SIGTERM')).to.throw('Runner aborted - SIGTERM event');
    });
    it('should register a SIGINT handler', (done) => {
        processHandler.registerExitHook(done);
        expect(() => process.emit('SIGINT')).to.throw('Runner aborted - SIGINT event');
    });
    it('should register a unhandledRejection handler', () => {
        expect(() => process.emit('unhandledRejection', new Error('reason'))).to.throw('reason');
        onExitMock();
    });
    it('should register a uncaughtException handler', (done) => {
        processHandler.registerExitHook(done);
        expect(() => process.emit('uncaughtException', new Error())).not.to.throw();
    });
    it('should do nothing on rejectionHandled', () => {
        expect(() => process.emit('rejectionHandled')).not.to.throw();
        onExitMock();
    });
    it('should register a exit handler', () => {
        expect(() => process.emit('exit')).not.to.throw();
    });
});

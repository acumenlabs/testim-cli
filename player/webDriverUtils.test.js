const expect = require('chai').expect;
const { encodeForSafari } = require('./webDriverUtils');

describe('url encoder', () => {
    it('works correctly on empty string', () => {
        const url = '';
        const result = encodeForSafari(url, true);
        expect(result).equal('');
    });

    it('works correctly no encoding', () => {
        const url = 'https://www.google.com';
        const result = encodeForSafari(url, true);
        expect(result).equal(url);
    });

    it('works correctly no encoding 2', () => {
        const url = 'https://www.google.com/';
        const result = encodeForSafari(url, true);
        expect(result).equal(url);
    });

    it('works correctly no encoding 3', () => {
        const badUrl = 'https://www.google.com/abc+def@#';
        const result = encodeForSafari(badUrl);
        expect(result).equal('https://www.google.com/abc+def@#');
    });

    it('encodes spaces anyway, keeps % the same', () => {
        const url = 'https://www.google.com/abc de f %';
        const result = encodeForSafari(url, true);
        expect(result).equal('https://www.google.com/abc%20de%20f%20%');
    });

    it('returns input on non-url', () => {
        const url = 'httpsw123:x/asadsd/www.google.com';
        const result = encodeForSafari(url, true);
        expect(result).equal(url);
    });

    it('returns correctly when needing encoding', () => {
        const url = 'https://www.google.com/abc def';
        const result = encodeForSafari(url, true);
        expect(result).equal('https://www.google.com/abc%20def');
    });

    it('doesn\'t encode %', () => {
        const url = 'https://www.google.com/abc%def';
        const result = encodeForSafari(url, true);
        expect(result).equal('https://www.google.com/abc%def');
    });

    it('doesn\'t double encode', () => {
        const url = 'https://www.google.com/abc%20def';
        const result = encodeForSafari(url, true);
        expect(result).equal('https://www.google.com/abc%20def');
    });

    it('dont double encode %', () => {
        const badUrl = 'https://www.google.com/abc%20def%';
        const result = encodeForSafari(badUrl);
        expect(result).equal('https://www.google.com/abc%20def%');
    });

    it('return null on null', () => {
        const url = null;
        const result = encodeForSafari(url, true);
        expect(result).equal(null);
    });

    it('return undefined on undefined', () => {
        const url = undefined;
        const result = encodeForSafari(url, true);
        expect(result).equal(undefined);
    });


    //// check for false


    it('unchanged on empty string', () => {
        const url = '';
        const result = encodeForSafari(url, false);
        expect(result).equal('');
    });

    it('unchanged  no encoding', () => {
        const url = 'https://www.google.com';
        const result = encodeForSafari(url, false);
        expect(result).equal(url);
    });

    it('unchanged for multiple places', () => {
        const url = 'https://www.google.com/abc de f %';
        const result = encodeForSafari(url, false);
        expect(result).equal('https://www.google.com/abc de f %');
    });

    it('returns unchanged input on non-url', () => {
        const url = 'httpsw123:x/asadsd/www.google.com';
        const result = encodeForSafari(url, false);
        expect(result).equal(url);
    });

    it('returns unchanged when needing encoding', () => {
        const url = 'https://www.google.com/abc def';
        const result = encodeForSafari(url, false);
        expect(result).equal('https://www.google.com/abc def');
    });

    it('returns unchanged when needing encoding only %', () => {
        const url = 'https://www.google.com/abc%def';
        const result = encodeForSafari(url, false);
        expect(result).equal('https://www.google.com/abc%def');
    });
});

"use strict";

// Import Testim Dev Kit methods
import { go, test, describe, beforeEach, text } from 'testim';

// Import chai assertion library
import { expect } from 'chai';

// Using `.only()`
describe.only('Test suite', () => {

	beforeEach(async () => {
		await go('http://demo.testim.io');
	});

	test('finds text element', async () => {
		const title = await text('.theme__title___35Wsy');
		expect(title).to.eq('Madan');
	});

	// Using `skip()`
	test.skip('skips this test', async () => {
		// this test will not be run
		const title = await text('.Gallery__headline-1___2lHj5');
		expect(title).to.eq('Your next destination');
	});
});

describe('Just another test', async() => {
	// this describe will not be run since the first describe
	// above is using `.only()`
});

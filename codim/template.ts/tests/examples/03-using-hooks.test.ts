"use strict";

// Import Testim Dev Kit methods
import { go, test, describe, before, beforeEach, afterEach, after, text } from 'testim';

// Import chai assertion library
import { expect } from 'chai';

describe('Using hooks', () => {

	before(function() {
		// runs before all tests in this block
  });

	beforeEach(async () => {
		// runs before each test in this block
		await go('http://demo.testim.io');
	});

	afterEach(function() {
    // runs after each test in this block
  });

  after(function() {
    // runs after all tests in this block
  });

	test('finds text element', async () => {
    // Find an element using a vanilla CSS selector and extract its text
    const title = await text('.theme__title___35Wsy');
    
    // Validate the extracted text
		expect(title).to.eq('Madan');
  });
  
});

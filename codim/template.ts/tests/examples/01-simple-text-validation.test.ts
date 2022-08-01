"use strict";

// Import Testim Dev Kit methods
import { go, text, test, l, Locator } from 'testim';

// Import chai assertion library
import { expect } from 'chai';

// Load the smart locators data and make it available for use in this test
Locator.set(require('./locators/locators.js'));

test('Simple text validation', async () => {
  await go("http://demo.testim.io");

  // Grab the title text and store it in a const
  const title = await text(l("SPACE_&_BEYOND"));

  // Use Chai to assert the title text is correct
  expect(title).to.eq('Space & Beyond');  
}); // end of test


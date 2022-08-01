"use strict";

// Import Testim Dev Kit methods
import { go, waitForText, scrollToElement, click, test, l, Locator } from 'testim';

// Load the smart locators data and make it available for use in this test
Locator.set(require('./locators/locators.js'));

test('Using locators', async () => {

  await go("http://demo.testim.io");

  // Load the SELECT DESTINATION button smart locator. This locator
  // can now be used by any method that accepts a smart locator as
  // as argument.
  //
  // You can read more about the advantages of working with smart
  // locators in the Testim documentation:
  // https://help.testim.io/docs/working-with-locators
  const selectDestButton = l("SELECT_DESTINATION");

  await waitForText(selectDestButton, 'Select Destination');

  await scrollToElement(selectDestButton);

  await click(selectDestButton);

}); // end of test



"use strict";

// Import Testim Dev Kit methods
const { go, click, waitForText, withContext, test, l, Locator } = require('testim');

// Load the smart locators data and make it available for use in this test
Locator.set(require('./locators/locators.js'));

test('Working with multiple windows', async () => {
  await go("https://the-internet.herokuapp.com/");

  await click(l("Multiple_Windows"));

  // Open a new tab
  await click(l("Click_Here"));

  // Run validation on the main tab
  await waitForText(l("Opening_a_new_window"), 'Opening a new window');
  
  // Import a `waitForText` method in the context of the newly opened tab
  // using the `withContext` method (@see https://help.testim.io/docs/with-context)
  // Please note we're using an alias since we've already imported `waitForText`
  // to be used in the context of the main tab.
  const { waitForText: waitForTextForTab } = withContext({
    tabUrl: 'https://the-internet.herokuapp.com/windows/new'
  });

  // Run validation on the newly opened tab
  await waitForTextForTab(l("New_Window"), 'New Window');

}); // end of test


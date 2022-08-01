
# TESTIM.IO
## Web Test Automation Solution. Built for agile teams. Testim is a cloud service that instantly enables Test Automation to make your Continuous Delivery ready.

For more information please check out https://testim.io and https://help.testim.io/docs

For any questions please talk to our support from the chat window at https://app.testim.io

For the live and up to date documentation of this tool please check out [this guide](https://help.testim.io/docs/integrate-testim-to-your-ci) on integrating Testim into your CI/CD.

### Installation

Install the testim CLI globally:

```sh
$ npm i -g @testim/testim-cli
```

### CLI Options
Token:
```sh
 --token
```
Use the token you got from testim.io (if you don't have one email [info@testim.io](mailto:info@testim.io))
```sh
testim --token my.token
```

Project:
```sh
 --project
```
Select which project to run tests from
```sh
testim -project "My Project"
```
Label:
```sh
 --label or -l
```
Run all tests comprising one of the mentioned labels
```sh
testim -l my-label1 -l my-label2
```
Run by test name:
```sh
testim -n test-name1 -n test-name2
```
Grid host url
```sh
 --host
```
Grid host port
```sh
 --port or -p
```
Run on a specific Selenium Grid
```sh
testim -host 127.0.0.1 -p 4444
```
Console Reporter
```sh
testim --reporters console
```
JUnit Reporter
```sh
testim --reporters junit --report-file ~/report.xml
```
TeamCity Reporter
```sh
testim --reporters teamcity
```
Base URL
```sh
--base-url
```
Starting URL after browser opens
```sh
testim --base-url www.testim.io
```
Applitools Key
```sh
--applitools-key
testim --applitools-key sadfsdflkjdsf-sdf-fds
```
Sauce Labs Key
```sh
--sauce-key
testim --sauce-key sadfsdflkjdsf-sdf-fds
```
Sauce Labs User
```sh
--sauce-user
testim --sauce-user sadfsdflkjdsf-sdf-fds
```
BrowserStack Key
```sh
--browserstack-key
testim --browserstack-key sadfsdflkjdsf-sdf-fds
```
BrowserStack User
```sh
--browserstack-user
testim --browserstack-user sadfsdflkjdsf-sdf-fds
```
BrowserStack Options
```sh
--browserstack-options
testim --browserstack-options browser-stack.json
```
BrowserStack Options Config File Example

```json
{
   "browserName" : "chrome",
   "browser_version" : "53.0",
   "os" : "Windows",
   "os_version" : "7"
}
```

#### Tunnel
Open a tunnel between your local server and the selenium server.<br />
Test base url will be replaced by the tunnel url.

```sh
--tunnel
--tunnel-port <SERVER_PORT> - optional

testim --tunnel --tunnel-port 8080
```

#### Version Control (Branches)
To run on a specific branch, use this parameter in your CLI

```sh
--branch <branch-name>
```

If you are using one of the following: Jenkins, CircleCI or TravisCI, The Testim CLI will automatically run tests for the same branch if the following parameter is used.

```sh
--branch auto-detect
```

### Environment Variables
The following are Environment Variables that the runner listens to:

* `"SERVICES_HOST": "http://localhost:8080"`
* `"DEBUG_MODE": "1"`
* `"LOGGER_DEBUG": "1"`
* `"LOGGER_CONSOLE": "1"`
* `"DEFAULT_REQUEST_TIMEOUT": "3000000"`
* `"OVERRIDE_TIMEOUTS": "1000000"`
* `"WEBDRIVER_DEBUG": "1"`
* `"OVERRIDE_SCHEDULER": "true`


License
----

© 2014-2019 Testim. All Rights Reserved.

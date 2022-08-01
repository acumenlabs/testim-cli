"use strict";

const { promisifyAll } = require('bluebird');
const fse = require('fs-extra');
const exec = promisifyAll(require('child_process')).execAsync;
const path = require('path');
const validateNpmPackageName = require("validate-npm-package-name");
const ArgError = require('../errors.js').ArgError;

module.exports.init = async function init(name) {
    const ora = require('ora');
    const prompts = require('prompts');

    if (typeof name !== 'string' || !name.trim()) {
        const response = await prompts({
            type: 'text',
            name: 'project',
            message: 'Please enter Project name',
            validate: value => String(value).length > 3
        });
        name = response.project;
    }

    const fullpath = path.resolve(name);

    if (fse.existsSync(fullpath) && fse.readdirSync(fullpath).length !== 0) {
        console.log(`${fullpath} is not empty. Quiting...`);
        process.exit(1);
    }

    const packageName = fullpath.substr(Math.max(fullpath.lastIndexOf('/'), fullpath.lastIndexOf('\\')) + 1);

    const nameValidity = validateNpmPackageName(packageName);

    if (!nameValidity.validForNewPackages) {
        if (nameValidity.errors) nameValidity.errors.forEach((e) => console.log(e));
        if (nameValidity.warnings) nameValidity.warnings.forEach((e) => console.log(e));

        throw new ArgError("Package name is not valid");
    }

    const response = await prompts({
        type: 'toggle',
        name: 'isJs',
        message: 'Add support for TypeScript?',
        initial: true,
        active: 'no',
        inactive: 'yes'
    });

    const sourceFolder = response.isJs ? 'template.js' : 'template.ts';

    const source = path.join(__dirname, sourceFolder);
    const dest = path.join(process.cwd(), name);

    let spinner = ora(`Creating new test project in ${dest}`).start();

    await fse.copy(source, dest);

    const sourcePackageJson = path.join(__dirname, sourceFolder, 'package.json');
    const destPackageJson = path.join(process.cwd(), name, 'package.json');

    const packageContents = await fse.readFile(sourcePackageJson);

    const newPackageJson = packageContents.toString().replace('~testim-codeful-test-project~', packageName);

    await fse.writeFile(destPackageJson, newPackageJson);

    const gitIgnore = 'node_modules';
    const gitIgnoreFilePath = path.join(process.cwd(), name, '.gitignore');
    await fse.writeFile(gitIgnoreFilePath, gitIgnore);

    spinner.succeed();
    spinner = ora('Installing dependencies').start();
    await exec('npm install', { cwd: dest });

    spinner.succeed();

    console.log(`Testim Dev Kit project folder successfully created in ${dest}.`);

};

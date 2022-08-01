

module.exports.writeStackTrace = function writeStackTrace(err) {
    if(err && err.message && err.message.includes('SIGINT')) {
        return; // no need to generate a log file for a sigint.
    }
    try {
        const homedir = require('os-homedir')();
        const fse = require('fs-extra');
        const path = require('path');

        fse.ensureDirSync(path.resolve(homedir, '.testim_logs'));
        const logfilename = path.resolve(homedir, '.testim_logs', new Date().toISOString().replace(/:|\./g, '_') + '.log');
        console.log('Oops :( The test runner has encountered an unexpected error. A complete log of this run can be found in:');
        console.log(`\t${logfilename}`);

        if (err && err.message && err.message.includes('Unable to compile TypeScript') && err.stack.includes('runner/src')
            && process.argv.some(x => x.includes('player-require-path'))) {
                const chalk = require('chalk');
            console.log(chalk.red('Looks like you got a TypeScript compile error champ - but it\'s not a very good one because we use TypeScript in transpile-only mode'));
            console.log(chalk.red(`change require('ts-node/register/transpile-only'); to require('ts-node/register'); for better errors`));
        }

        fse.writeFileSync(logfilename, err + "\n" + err.stack + "\n\n" + JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    } catch (err) { }
}
#!/usr/bin/env node
/* eslint-disable no-console */

const assume = require('assumer');
const chalk = require('chalk');
const inquirer = require('inquirer');
const meow = require('meow');
const os = require('os');
const updateNotifier = require('update-notifier');
const util = require('./util');
const pkg = require('./package.json');

// check for updates and notify user
updateNotifier({ pkg }).notify();

// setup CLI flags
const cli = meow(`
    Usage
      $ assumer

    Required Flags
      -a, --target-account    Target Account Number
      -r, --target-role       Target Account Role
      -A, --control-account   Control Account Number
      -R, --control-role      Control Account Role

    Optional Flags
      -u, --username          An AWS IAM username (defaults to system user name)
      -g, --gui               Open a web browser to the AWS console with these credentials
      -t, --token             MFA Token (you will be interactively prompted)

    Example
      $ assumer # interactive mode
      $ assumer -a 111111111111 -r target/role -A 123456789012 -R control/role
      
`, {
  alias: {
    a: 'target-account',
    r: 'target-role',
    A: 'control-account',
    R: 'control-role',
    u: 'username',
    g: 'gui',
    t: 'mfaToken',
  },
  string: ['a', 'r', 'A', 'R', 'u', 't'], // always treat these flags as String type, not Number type
  boolean: ['g'], // always treat these flags as Boolean type
  default: {
    u: os.userInfo().username,
  },
});

const { username } = cli.flags;

// load config file
const config = util.loadConfig();
const controlAccounts = config.control.accounts.map(acct => acct);
const controlRoles = config.control.roles.map(role => role);
const targetAccounts = config.target.accounts.map(acct => acct);
const targetRoles = config.target.roles.map(role => role);

// questions to prompt user interactively
const questions = [
  {
    type: 'list',
    name: 'controlAccount',
    message: 'Control Account:',
    choices: controlAccounts,
  },
  {
    type: 'list',
    name: 'controlRole',
    message: 'Control Role:',
    choices: controlRoles,
  },
  {
    type: 'list',
    name: 'targetAccount',
    message: 'Target Account:',
    choices: targetAccounts,
  },
  {
    type: 'list',
    name: 'targetRole',
    message: 'Target Role:',
    choices: targetRoles,
  },
  {
    type: 'input',
    message: 'MFA Token:',
    name: 'mfaToken',
    validate: (value) => {
      const pass = value.match(/^\d{6}$/i);
      if (pass) {
        return true;
      }

      return 'Invalid MFA Token. Must be 6-digit token';
    },
  },
  {
    type: 'confirm',
    message: 'Launch AWS Console in browser?',
    name: 'gui',
    default: true,
  },
];

// If no flags or input are passed, prompt user interactively
if ((!cli.flags.controlAccount ||
  !cli.flags.targetAccount ||
  !cli.flags.controlRole ||
  !cli.flags.targetRole) &&
  cli.input.length === 0) {
  // prompt questions
  inquirer.prompt(questions)
    // handle response
    .then((response) => {
      let { controlRole, targetRole } = response;
      const { controlAccount, targetAccount, mfaToken } = response;

      // Replace wildcards in role names
      const requestedTarget = config.target.accounts.find(acct => acct.value === targetAccount);
      if (controlRole.indexOf('$$$') > -1) controlRole = controlRole.replace(/\$\$\$/g, requestedTarget.name);
      if (targetRole.indexOf('$$$') > -1) targetRole = targetRole.replace(/\$\$\$/g, requestedTarget.name);

      console.log(`${chalk.yellow(username)} is assuming ${chalk.yellow(targetRole)} role into ${chalk.yellow(targetAccount)} account`);
      return Promise.all([
        response,
        assume({ controlAccount, controlRole, targetAccount, targetRole, username, mfaToken }),
      ]);
    })
    // determine whether to open console in browser
    .then((results) => {
      const [response, creds] = results;
      util.sourceCredentials(creds);
      if (response.gui) util.generateURL(creds);
    })
    .catch(err => console.log(chalk.red(err)));
}

// if required flags are passed
if (cli.flags.controlAccount &&
  cli.flags.targetAccount &&
  cli.flags.controlRole &&
  cli.flags.targetRole &&
  cli.input.length === 0) {
  const { controlAccount, targetAccount } = cli.flags;
  let { controlRole, targetRole, mfaToken } = cli.flags;

  // Replace wildcards in role names
  const configTargetAccount = config.target.accounts.find(acct => acct.value === targetAccount);
  if (controlRole.indexOf('$$$') > -1) controlRole = controlRole.replace(/\$\$\$/g, configTargetAccount.name);
  if (targetRole.indexOf('$$$') > -1) targetRole = targetRole.replace(/\$\$\$/g, configTargetAccount.name);

  // if no token is passed, prompt user
  if (mfaToken === undefined) {
    inquirer.prompt([questions.find(field => field.name === 'mfaToken')])
      .then((response) => {
        mfaToken = response.mfaToken;
        console.log(`${chalk.yellow(username)} is assuming ${chalk.yellow(targetRole)} role into ${chalk.yellow(targetAccount)} account`);
        return assume({
          controlAccount,
          controlRole,
          targetAccount,
          targetRole,
          username,
          mfaToken,
        });
      })
      .then((creds) => {
        if (cli.flags.gui) util.generateURL(creds);
        util.sourceCredentials(creds);
      })
      .catch(err => console.log(chalk.red(err)));

    // if all flags are passed, including token, then assume
  } else {
    assume({ controlAccount, controlRole, targetAccount, targetRole, username, mfaToken })
      .then(results => console.log(results))
      .catch(err => console.log(chalk.red(err)));
  }
}

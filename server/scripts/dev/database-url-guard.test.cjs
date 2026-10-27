'use strict';

const assert = require('node:assert/strict');
const { validateDevelopmentDatabaseUrl } = require('./database-url-guard.cjs');

const dev =
  'postgresql://bjc_dev:test-only-placeholder@127.0.0.1:55432/buscador_juridico_civil_dev';
const qa =
  'postgresql://bjc_dev:test-only-placeholder@127.0.0.1:55434/buscador_juridico_civil_deepqa';
const allowQa = { allowIsolatedQa: true, deploymentEnvironment: 'development' };
const suite9Qa =
  'postgresql://bjc_dev:test-only-placeholder@127.0.0.1:55435/galilei_page_aware_suite9_fresh';
const allowSuite9Qa = {
  allowIsolatedQa: true,
  allowSuite9PageAwareQa: true,
  deploymentEnvironment: 'development',
};

assert.equal(validateDevelopmentDatabaseUrl(dev).valid, true);
assert.equal(validateDevelopmentDatabaseUrl(qa).valid, false);
assert.equal(validateDevelopmentDatabaseUrl(qa, allowQa).valid, true);
assert.equal(
  validateDevelopmentDatabaseUrl(suite9Qa, allowSuite9Qa).valid,
  true,
);
assert.equal(
  validateDevelopmentDatabaseUrl(
    suite9Qa.replace('55435', '55432'),
    allowSuite9Qa,
  ).valid,
  false,
);
assert.equal(
  validateDevelopmentDatabaseUrl(
    suite9Qa.replace('suite9_fresh', 'dev'),
    allowSuite9Qa,
  ).valid,
  false,
);
assert.equal(
  validateDevelopmentDatabaseUrl(qa, {
    allowIsolatedQa: true,
    allowSuite7Qa: true,
    deploymentEnvironment: 'development',
  }).target,
  'suite7-qa',
);
assert.equal(
  validateDevelopmentDatabaseUrl(qa, { allowIsolatedQa: true }).valid,
  false,
);
assert.equal(
  validateDevelopmentDatabaseUrl(qa, {
    ...allowQa,
    deploymentEnvironment: 'production',
  }).valid,
  false,
);
assert.equal(
  validateDevelopmentDatabaseUrl(qa.replace('55434', '55432'), allowQa).valid,
  false,
);
assert.equal(
  validateDevelopmentDatabaseUrl(qa.replace('deepqa', 'dev'), allowQa).valid,
  false,
);
assert.equal(
  validateDevelopmentDatabaseUrl(qa.replace('127.0.0.1', 'localhost'), allowQa)
    .valid,
  false,
);
assert.equal(
  validateDevelopmentDatabaseUrl(qa + '?schema=public', allowQa).valid,
  false,
);

process.stdout.write('database URL guard: 13 assertions passed\n');

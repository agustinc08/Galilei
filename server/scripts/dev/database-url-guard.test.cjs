'use strict';

const assert = require('node:assert/strict');
const { validateDevelopmentDatabaseUrl } = require('./database-url-guard.cjs');

const dev =
  'postgresql://bjc_dev:test@127.0.0.1:55432/buscador_juridico_civil_dev';
const qa =
  'postgresql://bjc_dev:test@127.0.0.1:55434/buscador_juridico_civil_deepqa';
const allowQa = { allowIsolatedQa: true, deploymentEnvironment: 'development' };

assert.equal(validateDevelopmentDatabaseUrl(dev).valid, true);
assert.equal(validateDevelopmentDatabaseUrl(qa).valid, false);
assert.equal(validateDevelopmentDatabaseUrl(qa, allowQa).valid, true);
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

process.stdout.write('database URL guard: 9 assertions passed\n');

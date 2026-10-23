const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPgDumpPlan } = require('./preprod-pg-dump-plan-lib.cjs');

const approved = {
  host: 'preprod-db.internal',
  port: 5432,
  database: 'buscador_juridico_civil_preprod',
  user: 'preprod_user',
  caPath: 'C:\\preprod\\ca.pem',
  tlsMode: 'verify-full',
  password: 'do-not-print-this-password',
};

test('constructs pg_dump with the approved target, verify-full TLS, and passfile only', () => {
  const plan = buildPgDumpPlan(approved, 'C:\\vault\\preprod.pgpass', 'D:\\backup\\db.dump');
  assert.deepEqual(plan.target, {
    host: 'preprod-db.internal',
    port: 5432,
    database: 'buscador_juridico_civil_preprod',
    user: 'preprod_user',
    tlsMode: 'verify-full',
  });
  assert.deepEqual(plan.environment, {
    PGPASSFILE: 'C:\\vault\\preprod.pgpass',
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: 'C:\\preprod\\ca.pem',
  });
  assert.deepEqual(plan.args.slice(0, 8), [
    '--no-password', '--host', approved.host, '--port', '5432', '--username', approved.user,
    '--format=custom',
  ]);
  assert.equal(plan.args.includes(approved.password), false);
  assert.equal(JSON.stringify(plan).includes(approved.password), false);
  assert.equal(plan.clearLibpqVariables.includes('PGHOSTADDR'), true);
  assert.equal(plan.clearLibpqVariables.includes('PGSERVICE'), true);
});

test('rejects noncanonical identity, missing TLS/CA, and nonabsolute output credentials', () => {
  for (const patch of [
    { database: 'buscador_juridico_civil_dev' },
    { user: 'bjc_dev' },
    { tlsMode: 'prefer' },
    { caPath: 'relative-ca.pem' },
  ]) {
    assert.throws(() => buildPgDumpPlan({ ...approved, ...patch }, 'C:\\vault\\preprod.pgpass', 'D:\\backup\\db.dump'), /PG_DUMP_CANONICAL_TARGET_INVALID/);
  }
  assert.throws(() => buildPgDumpPlan(approved, 'relative.pgpass', 'D:\\backup\\db.dump'), /PG_DUMP_CANONICAL_TARGET_INVALID/);
  assert.throws(() => buildPgDumpPlan(approved, 'C:\\vault\\preprod.pgpass', 'relative.dump'), /PG_DUMP_CANONICAL_TARGET_INVALID/);
});

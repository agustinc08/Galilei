const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { rootCertificates } = require('node:tls');
const {
  getApprovedDatabaseConfig,
} = require('../dist/src/config/approved-database-config.js');
const { buildPgDumpPlan } = require('./preprod-pg-dump-plan-lib.cjs');
const {
  createCanonicalPreprodClient,
  readCanonicalPreprodDatabase,
  serializeCanonicalPreprodDatabase,
} = require('./preprod-db-client.cjs');

test('canonical PREPROD adapter survives guarded stdin transport without carrying raw DATABASE_URL', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-preprod-db-client-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const caPath = path.join(root, 'root-ca.pem');
  fs.writeFileSync(caPath, rootCertificates[0]);
  const env = {
    NODE_ENV: 'production',
    BJC_DEPLOYMENT_ENV: 'preprod',
    BJC_PREPROD_DATABASE_APPROVED: 'true',
    BJC_PREPROD_DB_HOST: 'preprod-db.internal',
    BJC_PREPROD_DB_PORT: '5432',
    BJC_PREPROD_DB_NAME: 'buscador_juridico_civil_preprod',
    BJC_PREPROD_DB_USER: 'preprod_runtime',
    BJC_PREPROD_DB_CA_PATH: caPath,
  };
  const encodedCa = encodeURIComponent(caPath);
  env.DATABASE_URL = `postgresql://preprod_runtime:synthetic-test-password@preprod-db.internal:5432/buscador_juridico_civil_preprod?sslmode=verify-full&sslrootcert=${encodedCa}`;
  const canonical = getApprovedDatabaseConfig(env, 'preprod');
  const dumpPlan = buildPgDumpPlan(
    canonical,
    path.join(root, 'pgpass'),
    path.join(root, 'backup.dump'),
  );
  assert.deepEqual(dumpPlan.target, {
    host: canonical.host,
    port: canonical.port,
    database: canonical.database,
    user: canonical.user,
    tlsMode: 'verify-full',
  });
  assert.deepEqual(dumpPlan.environment, {
    PGPASSFILE: path.join(root, 'pgpass'),
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: canonical.caPath,
  });
  assert.equal(
    JSON.stringify(dumpPlan.args).includes(canonical.pgConfig.password),
    false,
  );
  const payload = serializeCanonicalPreprodDatabase(canonical);

  assert.equal(payload.includes(env.DATABASE_URL), false);
  assert.equal(payload.includes('postgresql://'), false);
  assert.equal(payload.includes(canonical.pgConfig.password), true);

  const received = await readCanonicalPreprodDatabase(
    Readable.from([payload]),
    { ...env, BJC_PREPROD_GUARD_VALIDATED: 'true' },
  );
  const { client } = createCanonicalPreprodClient(received);
  const effective = client.connectionParameters;
  assert.deepEqual(
    {
      host: effective.host,
      port: effective.port,
      database: effective.database,
      user: effective.user,
      sslRejectUnauthorized: effective.ssl.rejectUnauthorized,
      sslCaMatches: effective.ssl.ca.equals(fs.readFileSync(caPath)),
    },
    {
      host: canonical.host,
      port: canonical.port,
      database: canonical.database,
      user: canonical.user,
      sslRejectUnauthorized: true,
      sslCaMatches: true,
    },
  );
});

test('canonical PREPROD stdin rejects a redirected host even with the guard marker', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-preprod-db-client-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const caPath = path.join(root, 'root-ca.pem');
  fs.writeFileSync(caPath, rootCertificates[0]);
  const env = {
    NODE_ENV: 'production',
    BJC_DEPLOYMENT_ENV: 'preprod',
    BJC_PREPROD_DATABASE_APPROVED: 'true',
    BJC_PREPROD_DB_HOST: 'preprod-db.internal',
    BJC_PREPROD_DB_PORT: '5432',
    BJC_PREPROD_DB_NAME: 'buscador_juridico_civil_preprod',
    BJC_PREPROD_DB_USER: 'preprod_runtime',
    BJC_PREPROD_DB_CA_PATH: caPath,
    BJC_PREPROD_GUARD_VALIDATED: 'true',
  };
  const encodedCa = encodeURIComponent(caPath);
  env.DATABASE_URL = `postgresql://preprod_runtime:synthetic-test-password@preprod-db.internal:5432/buscador_juridico_civil_preprod?sslmode=verify-full&sslrootcert=${encodedCa}`;
  const canonical = getApprovedDatabaseConfig(env, 'preprod');
  const redirected = JSON.parse(serializeCanonicalPreprodDatabase(canonical));
  redirected.host = 'production-db.invalid';
  await assert.rejects(
    readCanonicalPreprodDatabase(
      Readable.from([JSON.stringify(redirected)]),
      env,
    ),
    { message: 'PREPROD_CANONICAL_DATABASE_IDENTITY_MISMATCH' },
  );
});

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { isLoopbackOrLocalHost } = require('../dist/src/config/network-host.js');

const PREPROD_DATABASE = 'buscador_juridico_civil_preprod';

function assertApprovedDatabaseShape(database) {
  const ssl = database?.pgConfig?.ssl;
  if (
    !database ||
    database.database !== PREPROD_DATABASE ||
    !database.host ||
    isLoopbackOrLocalHost(database.host) ||
    !Number.isInteger(database.port) ||
    database.port < 1 ||
    database.port > 65535 ||
    !database.user ||
    database.user === 'bjc_dev' ||
    database.tlsMode !== 'verify-full' ||
    !path.isAbsolute(database.caPath) ||
    !database.pgConfig ||
    database.pgConfig.host !== database.host ||
    Number(database.pgConfig.port) !== database.port ||
    database.pgConfig.database !== database.database ||
    database.pgConfig.user !== database.user ||
    typeof database.pgConfig.password !== 'string' ||
    !database.pgConfig.password ||
    !ssl ||
    !Buffer.isBuffer(ssl.ca) ||
    ssl.rejectUnauthorized !== true
  ) {
    throw new Error('PREPROD_CANONICAL_DATABASE_CONFIG_INVALID');
  }
}

/** Secret-bearing canonical adapter is transported over child stdin, never argv or logs. */
function serializeCanonicalPreprodDatabase(database) {
  assertApprovedDatabaseShape(database);
  const ca = database.pgConfig.ssl.ca;
  return JSON.stringify({
    host: database.host,
    port: database.port,
    database: database.database,
    user: database.user,
    caPath: database.caPath,
    caSha256: crypto.createHash('sha256').update(ca).digest('hex'),
    tlsMode: database.tlsMode,
    password: database.pgConfig.password,
  });
}

async function readCanonicalPreprodDatabase(
  input = process.stdin,
  env = process.env,
) {
  if (
    env.BJC_PREPROD_GUARD_VALIDATED !== 'true' ||
    env.BJC_PREPROD_DATABASE_APPROVED !== 'true' ||
    env.NODE_ENV !== 'production' ||
    env.BJC_DEPLOYMENT_ENV !== 'preprod'
  ) {
    throw new Error('PREPROD_GUARD_VALIDATION_REQUIRED');
  }

  const raw = await readLimitedInput(input);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('PREPROD_CANONICAL_DATABASE_PAYLOAD_INVALID');
  }
  const keys = Object.keys(value ?? {}).sort();
  if (
    JSON.stringify(keys) !==
    JSON.stringify(
      [
        'caPath',
        'caSha256',
        'database',
        'host',
        'password',
        'port',
        'tlsMode',
        'user',
      ].sort(),
    )
  ) {
    throw new Error('PREPROD_CANONICAL_DATABASE_PAYLOAD_INVALID');
  }

  const expectedHost = normalizeHost(env.BJC_PREPROD_DB_HOST);
  const expectedCaPath = fs.realpathSync.native(env.BJC_PREPROD_DB_CA_PATH);
  if (
    value.host !== expectedHost ||
    value.port !== Number(env.BJC_PREPROD_DB_PORT) ||
    value.database !== env.BJC_PREPROD_DB_NAME ||
    value.database !== PREPROD_DATABASE ||
    value.user !== env.BJC_PREPROD_DB_USER ||
    value.user === 'bjc_dev' ||
    value.tlsMode !== 'verify-full' ||
    !path.isAbsolute(value.caPath) ||
    !samePath(fs.realpathSync.native(value.caPath), expectedCaPath) ||
    typeof value.password !== 'string' ||
    !value.password ||
    !/^[a-f0-9]{64}$/u.test(value.caSha256)
  ) {
    throw new Error('PREPROD_CANONICAL_DATABASE_IDENTITY_MISMATCH');
  }

  const ca = fs.readFileSync(expectedCaPath);
  if (crypto.createHash('sha256').update(ca).digest('hex') !== value.caSha256) {
    throw new Error('PREPROD_CANONICAL_DATABASE_CA_CHANGED');
  }
  const database = {
    host: value.host,
    port: value.port,
    database: value.database,
    user: value.user,
    caPath: expectedCaPath,
    tlsMode: 'verify-full',
    pgConfig: {
      host: value.host,
      port: value.port,
      database: value.database,
      user: value.user,
      password: value.password,
      ssl: { ca, rejectUnauthorized: true },
    },
  };
  assertApprovedDatabaseShape(database);
  return database;
}

function createCanonicalPreprodClient(database) {
  assertApprovedDatabaseShape(database);
  return { database, client: new Client(database.pgConfig) };
}

function assertPreprodServerIdentity(identity, database) {
  const address =
    typeof identity.address === 'string'
      ? identity.address.replace(/\/\d+$/u, '')
      : '';
  if (
    identity.database !== database.database ||
    identity.role !== database.user ||
    Number(identity.port) !== database.port ||
    !address ||
    isLoopbackOrLocalHost(address)
  ) {
    throw new Error(
      'La identidad PostgreSQL efectiva no coincide con la identidad preprod aprobada.',
    );
  }
}

function readLimitedInput(input) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    input.setEncoding('utf8');
    input.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > 16 * 1024) {
        reject(new Error('PREPROD_CANONICAL_DATABASE_PAYLOAD_TOO_LARGE'));
        input.destroy();
        return;
      }
      chunks.push(chunk);
    });
    input.on('error', reject);
    input.on('end', () => resolve(chunks.join('')));
  });
}

function normalizeHost(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '');
}

function samePath(left, right) {
  const a = path.resolve(left).replace(/[\\/]+$/u, '');
  const b = path.resolve(right).replace(/[\\/]+$/u, '');
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

module.exports = {
  assertApprovedDatabaseShape,
  assertPreprodServerIdentity,
  createCanonicalPreprodClient,
  readCanonicalPreprodDatabase,
  serializeCanonicalPreprodDatabase,
};

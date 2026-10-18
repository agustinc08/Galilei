const { Client } = require('pg');
const { getApprovedDatabaseConfig } = require('../dist/src/config/approved-database-config.js');
const { isLoopbackOrLocalHost } = require('../dist/src/config/network-host.js');

function getCanonicalPreprodDatabase(env = process.env) {
  if (env.BJC_PREPROD_GUARD_VALIDATED !== 'true') {
    throw new Error('PREPROD_GUARD_VALIDATION_REQUIRED');
  }
  return getApprovedDatabaseConfig(env, 'preprod');
}

function createCanonicalPreprodClient(env = process.env) {
  const database = getCanonicalPreprodDatabase(env);
  return { database, client: new Client(database.pgConfig) };
}

function assertPreprodServerIdentity(identity, database) {
  const address = typeof identity.address === 'string'
    ? identity.address.replace(/\/\d+$/u, '')
    : '';
  if (
    identity.database !== database.database ||
    identity.role !== database.user ||
    Number(identity.port) !== database.port ||
    !address ||
    isLoopbackOrLocalHost(address)
  ) {
    throw new Error('La identidad PostgreSQL efectiva no coincide con la identidad preprod aprobada.');
  }
}

module.exports = { createCanonicalPreprodClient, assertPreprodServerIdentity };

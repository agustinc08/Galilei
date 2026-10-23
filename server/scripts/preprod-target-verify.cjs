// Verify the actual PREPROD server using the same approved identity object that
// the guard validated. This module deliberately does not parse DATABASE_URL.
const {
  createCanonicalPreprodClient,
  assertPreprodServerIdentity,
} = require('./preprod-db-client.cjs');

async function verifyPreprodTarget(database) {
  const { client } = createCanonicalPreprodClient(database);
  try {
    await client.connect();
    const identity = (
      await client.query(`
      SELECT current_database() AS database, current_user AS role,
             inet_server_addr()::text AS address, inet_server_port() AS port
    `)
    ).rows[0];
    assertPreprodServerIdentity(identity, database);
    const result = {
      PREPROD_TARGET: 'PASS',
      host: database.host,
      serverAddress: identity.address,
      port: database.port,
      database: identity.database,
      role: identity.role,
      tlsMode: database.tlsMode,
      secretsPersisted: false,
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await client.end();
  }
}

module.exports = { verifyPreprodTarget };

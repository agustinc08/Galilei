#!/usr/bin/env node
// Effective target identity preflight for approved, guarded preproduction DB work.
const { Client } = require('pg');

if (process.env.BJC_PREPROD_GUARD_VALIDATED !== 'true') {
  console.error('PREPROD_TARGET=ABORT; use scripts/with-preprod-db-guard.cjs target-verify.');
  process.exit(2);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const identity = (await client.query(`
      SELECT current_database() AS database, current_user AS role,
             inet_server_addr()::text AS address, inet_server_port() AS port
    `)).rows[0];
    if (identity.database !== process.env.BJC_PREPROD_DB_NAME ||
        identity.role !== process.env.BJC_PREPROD_DB_USER ||
        Number(identity.port) !== Number(process.env.BJC_PREPROD_DB_PORT) ||
        !identity.address || /^(127\.|::ffff:127\.|::1(?:\/|$)|::(?:\/|$)|0\.0\.0\.0)/iu.test(identity.address)) {
      throw new Error('La identidad PostgreSQL efectiva no coincide con el target preprod aprobado.');
    }
    console.log(JSON.stringify({
      PREPROD_TARGET: 'PASS',
      host: process.env.BJC_PREPROD_DB_HOST,
      serverAddress: identity.address,
      port: Number(identity.port),
      database: identity.database,
      role: identity.role,
      secretsPersisted: false,
    }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`PREPROD_TARGET=ABORT; ${error instanceof Error ? error.message : 'target verification failed'}`);
  process.exitCode = 2;
});

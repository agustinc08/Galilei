#!/usr/bin/env node
const { Client } = require('pg');

const databaseName = process.env.BJC_INT1_TEMP_DB ?? '';
const action = process.argv[2];
const safeName = /^buscador_juridico_civil_int1_tmp_\d{8}_[a-f0-9]{8}$/u;

if (!safeName.test(databaseName) || !['create', 'drop', 'inspect'].includes(action)) {
  console.error('INT1_TEMP_DB=ABORT; invalid guarded action or database name.');
  process.exit(2);
}

const connectionString = process.env.DATABASE_URL ?? '';
let target;
try {
  target = new URL(connectionString);
} catch {
  console.error('INT1_TEMP_DB=ABORT; guarded connection target is invalid.');
  process.exit(2);
}

if (
  target.protocol !== 'postgresql:' ||
  target.hostname !== '127.0.0.1' ||
  target.port !== '55432' ||
  target.pathname !== (action === 'inspect' ? `/${databaseName}` : '/buscador_juridico_civil_dev') ||
  target.username !== 'bjc_dev'
) {
  console.error('INT1_TEMP_DB=ABORT; expected the exact guarded local DEV target.');
  process.exit(2);
}

async function main() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const identity = await client.query(`
      SELECT current_database() AS database,
             current_user AS role,
             host(inet_server_addr()) AS address,
             inet_server_port() AS port,
             (SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user) AS can_create_database
    `);
    const row = identity.rows[0];
    if (
      row.database !== (action === 'inspect' ? databaseName : 'buscador_juridico_civil_dev') ||
      row.role !== 'bjc_dev' ||
      row.address !== '127.0.0.1' ||
      row.port !== 55432
    ) {
      throw new Error('TARGET_IDENTITY_MISMATCH');
    }

    if (action === 'inspect') {
      await client.query('BEGIN READ ONLY');
      const migrations = await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL');
      const projectionTables = await client.query(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename LIKE 'CorpusSearchToken%'
        ORDER BY tablename
      `);
      const legalIndexes = await client.query(`
        SELECT tableName.relname AS table_name,
               indexName.relname AS index_name,
               pg_get_indexdef(indexName.oid) AS definition
        FROM pg_index indexData
        JOIN pg_class tableName ON tableName.oid = indexData.indrelid
        JOIN pg_class indexName ON indexName.oid = indexData.indexrelid
        WHERE tableName.relname IN ('Sentencia', 'Sumario')
        ORDER BY tableName.relname, indexName.relname
      `);
      await client.query('COMMIT');
      console.log(JSON.stringify({
        status: 'INT1_TEMP_INSPECT_PASS',
        database: row.database,
        role: row.role,
        address: row.address,
        port: row.port,
        appliedMigrations: migrations.rows[0].count,
        projectionTables: projectionTables.rows.map((item) => item.tablename),
        jurisprudenceIndexes: legalIndexes.rows,
      }, null, 2));
      return;
    }

    const found = await client.query('SELECT datdba::regrole::text AS owner FROM pg_database WHERE datname = $1', [databaseName]);
    if (action === 'create') {
      if (!row.can_create_database) throw new Error('CREATEDB_PRIVILEGE_REQUIRED');
      if (found.rowCount) throw new Error('TEMP_DATABASE_ALREADY_EXISTS');
      await client.query(`CREATE DATABASE "${databaseName}" WITH OWNER = bjc_dev TEMPLATE = template0 ENCODING = 'UTF8'`);
      console.log(`INT1_TEMP_DB=CREATE_PASS; database=${databaseName}; owner=bjc_dev; target=127.0.0.1:55432`);
      return;
    }

    if (!found.rowCount) {
      console.log(`INT1_TEMP_DB=DROP_NOT_NEEDED; database=${databaseName}`);
      return;
    }
    if (found.rows[0].owner !== 'bjc_dev') throw new Error('TEMP_DATABASE_OWNER_MISMATCH');
    await client.query(`DROP DATABASE "${databaseName}"`);
    console.log(`INT1_TEMP_DB=DROP_PASS; database=${databaseName}; target=127.0.0.1:55432`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const code = typeof error?.message === 'string' ? error.message : 'UNKNOWN_ERROR';
  console.error(`INT1_TEMP_DB=ABORT; code=${code}`);
  process.exitCode = 2;
});

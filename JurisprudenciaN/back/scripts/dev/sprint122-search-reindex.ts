import { Client } from 'pg';

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('Run through the DEV database guard.');
const target = new URL(raw);
if (
  target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' ||
  target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' ||
  target.username !== 'bjc_dev'
) throw new Error('DEV_DATABASE_TARGET_REJECTED');

async function main() {
  const client = new Client({ connectionString: raw });
  try {
    await client.connect();
    const identity = await client.query(`
      SELECT current_database() AS database, current_user AS role,
             inet_server_addr()::text AS address, inet_server_port() AS port
    `);
    const row = identity.rows[0];
    if (row.database !== 'buscador_juridico_civil_dev' || row.role !== 'bjc_dev' || row.address !== '127.0.0.1/32' || Number(row.port) !== 55432) {
      throw new Error('DEV_DATABASE_IDENTITY_REJECTED');
    }
    await client.query('REINDEX INDEX CONCURRENTLY "CorpusSearchToken_token_trgm_idx"');
    console.log(JSON.stringify({
      status: 'SPRINT122_SEARCH_REINDEX_PASS',
      target: { endpoint: '127.0.0.1:55432', database: row.database, role: row.role },
      index: 'CorpusSearchToken_token_trgm_idx',
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`SPRINT122_SEARCH_REINDEX_FAILED:${(error as Error).message}`);
  process.exitCode = 1;
});

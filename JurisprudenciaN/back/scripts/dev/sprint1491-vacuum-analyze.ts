import { Client } from 'pg';

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
const target = new URL(raw);
if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');

async function main() {
  const client = new Client({ connectionString: raw });
  try {
    await client.connect();
    const identity = (await client.query(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS host, inet_server_port() AS port`)).rows[0];
    if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' || String(identity.host).replace(/\/\d+$/u, '') !== '127.0.0.1' || Number(identity.port) !== 55432) throw new Error('DEV_DATABASE_IDENTITY_REJECTED');
    await client.query('VACUUM (ANALYZE) "CorpusSearchToken"');
    console.log('SPRINT1491_VACUUM_ANALYZE=PASS; table=CorpusSearchToken; full=false');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const item = error as { message?: string };
  console.error(item.message && /^DEV_DATABASE_/u.test(item.message) ? item.message : 'SPRINT1491_VACUUM_ANALYZE_FAILED');
  process.exitCode = 1;
});

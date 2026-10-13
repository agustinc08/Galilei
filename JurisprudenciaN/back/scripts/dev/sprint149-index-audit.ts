import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
const target = new URL(raw);
if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');

async function main() {
  const client = new Client({ connectionString: raw });
  try {
    await client.connect();
    const identity = (await client.query(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS host, inet_server_port() AS port, version()`)).rows[0];
    if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' || String(identity.host).replace(/\/\d+$/u, '') !== '127.0.0.1' || Number(identity.port) !== 55432) throw new Error('DEV_DATABASE_IDENTITY_REJECTED');
    const table = await client.query(`
      SELECT c.reltuples::bigint AS estimated_rows, pg_relation_size(c.oid)::bigint AS heap_bytes,
             s.n_live_tup, s.n_dead_tup, s.last_analyze, s.last_autoanalyze
        FROM pg_class c JOIN pg_stat_user_tables s ON s.relid=c.oid
       WHERE c.relname='CorpusSearchToken'
    `);
    const existing = await client.query(`
      SELECT indexrelname, pg_relation_size(indexrelid)::bigint AS bytes, idx_scan,
             idx_tup_read, idx_tup_fetch, pg_get_indexdef(indexrelid) AS definition
        FROM pg_stat_user_indexes WHERE relname='CorpusSearchToken' ORDER BY indexrelname
    `);
    const visibility = await client.query(`
      SELECT c.relname, c.relpages, c.relallvisible,
             CASE WHEN c.relpages > 0 THEN round(c.relallvisible::numeric / c.relpages, 6) ELSE 0 END AS all_visible_fraction,
             s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze
        FROM pg_class c JOIN pg_stat_user_tables s ON s.relid=c.oid
       WHERE c.relname IN ('CorpusSearchToken','CorpusDocument') ORDER BY c.relname
    `);
    const io = await client.query(`
      SELECT 'table' AS kind, relname AS object_name, heap_blks_read, heap_blks_hit, NULL::bigint AS index_blks_read, NULL::bigint AS index_blks_hit
        FROM pg_statio_user_tables WHERE relname='CorpusSearchToken'
      UNION ALL
      SELECT 'index', indexrelname, NULL::bigint, NULL::bigint, idx_blks_read, idx_blks_hit
        FROM pg_statio_user_indexes WHERE relname='CorpusSearchToken'
       ORDER BY kind, object_name
    `);
    const report = { generatedAt: new Date().toISOString(), target: { endpoint: '127.0.0.1:55432', database: identity.database, role: identity.role }, postgresVersion: identity.version, table: table.rows[0], visibilityMap: visibility.rows, ioStatistics: io.rows, indexes: existing.rows, queryTextPersisted: false };
    const root = resolve(__dirname, '../../../..');
    const out = resolve(root, '_recovery-work/sprint149');
    await mkdir(out, { recursive: true });
    await writeFile(resolve(out, 'index-audit-after.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally { await client.end(); }
}

main().catch((error) => { const item = error as { message?: string }; console.error(item.message && /^DEV_DATABASE_/u.test(item.message) ? item.message : 'SPRINT149_INDEX_AUDIT_FAILED'); process.exitCode = 1; });

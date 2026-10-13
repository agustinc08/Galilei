import { Client } from 'pg';

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') {
    throw new Error('DEV_DATABASE_TARGET_REJECTED');
  }
  const client = new Client({ connectionString: raw });
  let step = 'connect';
  try {
    await client.connect();
    step = 'identity';
    const identity = await client.query(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port`);
    step = 'extensions';
    const extensions = await client.query(`SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_trgm','pg_stat_statements') ORDER BY extname`);
    step = 'settings';
    const settings = await client.query(`SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_preload_libraries','work_mem','effective_cache_size','max_connections','track_io_timing') ORDER BY name`);
    step = 'relation-sizes';
    const sizes = await client.query(`SELECT c.relname AS relation, pg_relation_size(c.oid) AS table_bytes, pg_total_relation_size(c.oid) AS total_bytes, COALESCE(s.n_live_tup,0)::bigint AS live_rows FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('CorpusDocument','CorpusDocumentPage','CorpusExtraction','Sumario','Sentencia','ReferenciaNormativa','ReferenciaJurisprudencial','ReferenciaDoctrinaria') ORDER BY pg_total_relation_size(c.oid) DESC`);
    step = 'search-text-sizes';
    const searchText = await client.query(`SELECT count(*)::int AS documents, round(avg(octet_length("searchText")))::int AS avg_bytes, percentile_cont(0.50) WITHIN GROUP (ORDER BY octet_length("searchText"))::int AS p50_bytes, percentile_cont(0.95) WITHIN GROUP (ORDER BY octet_length("searchText"))::int AS p95_bytes, max(octet_length("searchText"))::int AS max_bytes FROM "CorpusDocument" WHERE "status"='INDEXED'`);
    step = 'page-text-sizes';
    const pageText = await client.query(`SELECT count(*)::int AS pages, round(avg(octet_length("text")))::int AS avg_bytes, percentile_cont(0.95) WITHIN GROUP (ORDER BY octet_length("text"))::int AS p95_bytes, max(octet_length("text"))::int AS max_bytes FROM "CorpusDocumentPage"`);
    step = 'index-sizes';
    const indexes = await client.query(`SELECT relname AS table_name, indexrelname AS index_name, pg_relation_size(indexrelid) AS bytes FROM pg_stat_user_indexes WHERE schemaname='public' AND relname IN ('CorpusDocument','CorpusDocumentPage','Sentencia','Sumario') ORDER BY pg_relation_size(indexrelid) DESC LIMIT 20`);
    step = 'activity';
    const activity = await client.query(`SELECT count(*)::int AS connections, count(*) FILTER (WHERE state='active')::int AS active, count(*) FILTER (WHERE state='idle')::int AS idle, count(*) FILTER (WHERE wait_event_type='Lock')::int AS lock_waiters, count(*) FILTER (WHERE wait_event_type='Client')::int AS client_waiters FROM pg_stat_activity WHERE datname=current_database()`);
    step = 'role';
    const role = await client.query(`SELECT rolcreatedb, rolsuper FROM pg_roles WHERE rolname=current_user`);
    step = 'pg-stat-statements';
    const statsAvailable = await client.query(`SELECT to_regclass('public.pg_stat_statements') IS NOT NULL AS available`);
    const temporaryDatabases = await client.query(`SELECT datname FROM pg_database WHERE datname IN ('buscador_juridico_civil_restore_test','buscador_juridico_civil_migration_test') ORDER BY datname`);
    const output = { status: 'SPRINT121_DB_PROBE_PASS', generatedAt: new Date().toISOString(), identity: identity.rows[0], role: role.rows[0], extensions: extensions.rows, settings: settings.rows, relationSizes: sizes.rows, searchTextStorage: searchText.rows[0], pageTextStorage: pageText.rows[0], indexes: indexes.rows, activity: activity.rows[0], temporaryDatabases: temporaryDatabases.rows.map((row) => row.datname), pgStatStatementsAvailable: statsAvailable.rows[0].available };
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'SPRINT121_DB_PROBE_STEP_FAILED', step, name: (error as Error)?.name ?? 'Error', code: (error as { code?: string })?.code ?? 'unknown' }));
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const reason = (error as Error)?.message ?? '';
  console.error(reason.startsWith('DEV_DATABASE_') ? reason : JSON.stringify({ status: 'SPRINT121_DB_PROBE_FAILED', name: (error as Error)?.name ?? 'Error', code: (error as { code?: string })?.code ?? 'unknown' }));
  process.exitCode = 1;
});

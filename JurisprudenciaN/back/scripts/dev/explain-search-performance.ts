import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const root = resolve(__dirname, '../../../..');
const stage = process.argv[2] === 'after' ? 'after' : 'before';
const output = resolve(root, `docs-integracion/34-explain-${stage}-postgresql.json`);
const modernTermPredicate = `(s."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\' OR t."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\')`;
const repeatedRankExpression = stage === 'before'
  ? `CASE WHEN ${modernTermPredicate} THEN 1::numeric ELSE 0::numeric END`
  : '1::numeric';

const queries = [
  {
    id: 'modern-term-count-daño',
    sql: `SELECT COUNT(*) FROM "Sumario" s JOIN "Sentencia" t ON t."id"=s."sentenciaId"
      WHERE s."activo" AND t."activo" AND
      (s."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\' OR t."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\')`,
    values: ['%daño%'],
  },
  {
    id: 'legacy-term-count-daño',
    sql: `SELECT COUNT(*) FROM "Sumario" s JOIN "Sentencia" t ON t."id"=s."sentenciaId"
      WHERE s."activo" AND t."activo" AND lower(coalesce(s."resumenBusqueda",'')) LIKE $1 ESCAPE E'\\\\'`,
    values: ['% daño %'],
  },
  {
    id: 'modern-ranked-page-daño',
    sql: `SELECT s."id", 100::numeric AS score FROM "Sumario" s JOIN "Sentencia" t ON t."id"=s."sentenciaId"
      WHERE s."activo" AND t."activo" AND
      (s."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\' OR t."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\')
      ORDER BY (${repeatedRankExpression}) DESC, t."fecha" DESC NULLS LAST, s."id" DESC LIMIT 25 OFFSET 0`,
    values: ['%daño%'],
  },
  {
    id: 'modern-or-count',
    sql: `SELECT COUNT(*) FROM "Sumario" s JOIN "Sentencia" t ON t."id"=s."sentenciaId"
      WHERE s."activo" AND t."activo" AND
      (s."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\' OR t."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\'
       OR s."textoBusquedaNormalizado" LIKE $2 ESCAPE E'\\\\' OR t."textoBusquedaNormalizado" LIKE $2 ESCAPE E'\\\\')`,
    values: ['%daño%', '%moral%'],
  },
  {
    id: 'modern-prefix-accident',
    sql: `SELECT s."id" FROM "Sumario" s JOIN "Sentencia" t ON t."id"=s."sentenciaId"
      WHERE s."activo" AND t."activo" AND
      (s."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\' OR t."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\') LIMIT 25`,
    values: ['% accident%'],
  },
  {
    id: 'modern-suffix-accident',
    sql: `SELECT s."id" FROM "Sumario" s JOIN "Sentencia" t ON t."id"=s."sentenciaId"
      WHERE s."activo" AND t."activo" AND
      (s."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\' OR t."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\') LIMIT 25`,
    values: ['%accident %'],
  },
  {
    id: 'modern-suffix-union-candidates',
    sql: `SELECT COUNT(*) FROM (
      SELECT s."id" FROM "Sumario" s WHERE s."activo" AND s."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\'
      UNION
      SELECT s."id" FROM "Sentencia" t JOIN "Sumario" s ON s."sentenciaId"=t."id"
      WHERE s."activo" AND t."activo" AND t."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\'
      ) candidates`,
    values: ['%accident %'],
  },
  {
    id: 'modern-suffix-union-candidates-civil-broad',
    sql: `SELECT COUNT(*) FROM (
      SELECT s."id" FROM "Sumario" s WHERE s."activo" AND s."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\'
      UNION
      SELECT s."id" FROM "Sentencia" t JOIN "Sumario" s ON s."sentenciaId"=t."id"
      WHERE s."activo" AND t."activo" AND t."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\'
      ) candidates`,
    values: ['%civil %'],
  },
  {
    id: 'modern-suffix-sumario-index-candidate',
    sql: `SELECT s."id" FROM "Sumario" s WHERE s."activo" AND s."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\'`,
    values: ['%accident %'],
  },
  {
    id: 'modern-suffix-sentencia-index-candidate',
    sql: `SELECT t."id" FROM "Sentencia" t WHERE t."activo" AND t."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\'`,
    values: ['%accident %'],
  },
  {
    id: 'short-term-de',
    sql: `SELECT COUNT(*) FROM "Sumario" s JOIN "Sentencia" t ON t."id"=s."sentenciaId"
      WHERE s."activo" AND t."activo" AND
      (s."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\' OR t."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\')`,
    values: ['%de%'],
  },
  {
    id: 'numeroSentencia-field-1113-page',
    sql: `SELECT t."id", CASE WHEN regexp_replace(translate(lower(coalesce(t."numeroSentencia",'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g')=$2 THEN 1 ELSE 0 END AS score
      FROM "Sumario" s JOIN "Sentencia" t ON t."id"=s."sentenciaId"
      WHERE s."activo" AND t."activo" AND
      regexp_replace(translate(lower(coalesce(t."numeroSentencia",'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') LIKE $1 ESCAPE E'\\\\'
      ORDER BY score DESC, t."fecha" DESC NULLS LAST, s."id" DESC LIMIT 25`,
    values: ['%1113%', '1113'],
  },
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Run through the DEV database guard.');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const identity = await client.query(`SELECT current_database() AS database, current_user AS role,
      inet_server_addr()::text AS address, inet_server_port() AS port, current_setting('server_version_num')::int AS version`);
    const target = identity.rows[0];
    if (target.database !== 'buscador_juridico_civil_dev' || target.role !== 'bjc_dev' ||
        target.address?.split('/')[0] !== '127.0.0.1' || target.port !== 55432 ||
        target.version < 160000 || target.version >= 170000) throw new Error('EXPLAIN target failed DEV identity checks.');

    const plans: Array<{ id: string; plan: any }> = [];
    for (const query of queries) {
      const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) ${query.sql}`, query.values);
      plans.push({ id: query.id, plan: result.rows[0]['QUERY PLAN'][0] });
    }
    const indexes = await client.query(`SELECT t.relname AS table_name, i.relname AS index_name,
      pg_size_pretty(pg_relation_size(i.oid)) AS size, pg_relation_size(i.oid) AS bytes,
      ix.indisvalid AS valid, ix.indisready AS ready, pg_get_indexdef(i.oid) AS definition,
      COALESCE(st.idx_scan,0) AS scans, COALESCE(st.idx_tup_read,0) AS tuples_read,
      COALESCE(st.idx_tup_fetch,0) AS tuples_fetched
      FROM pg_class t JOIN pg_index ix ON ix.indrelid=t.oid JOIN pg_class i ON i.oid=ix.indexrelid
      LEFT JOIN pg_stat_user_indexes st ON st.indexrelid=i.oid
      WHERE t.relname IN ('Sumario','Sentencia') ORDER BY t.relname,i.relname`);
    const tables = await client.query(`SELECT relname, n_live_tup, n_dead_tup, last_analyze, last_autoanalyze
      FROM pg_stat_user_tables WHERE relname IN ('Sumario','Sentencia') ORDER BY relname`);
    const report = {
      mission: '5.4 explain', stage, generatedAt: new Date().toISOString(),
      target: { serverVersion: target.version, endpoint: '127.0.0.1:55432', database: target.database, role: target.role },
      method: 'Read-only EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) SELECT plans; no schema/data writes.',
      plans, indexes: indexes.rows, tableStats: tables.rows,
    };
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`EXPLAIN=${stage.toUpperCase()}_PASS; plans=${plans.length}; indexes=${indexes.rowCount}; report=docs-integracion/34-explain-${stage}-postgresql.json`);
    for (const entry of plans) {
      const plan = entry.plan.Plan;
      console.log(`PLAN=${entry.id}; node=${plan['Node Type']}; index=${plan['Index Name'] ?? 'none'}; actualMs=${plan['Actual Total Time']}; rows=${plan['Actual Rows']}; buffers=${plan['Shared Hit Blocks']}/${plan['Shared Read Blocks']}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(`EXPLAIN=FAIL; ${error.message}`); process.exitCode = 1; });

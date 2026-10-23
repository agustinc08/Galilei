import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const root = resolve(__dirname, '../../../');
const output = resolve(root, 'docs/integracion/30-explain-postgresql.json');

const plans = [
  {
    id: 'contains-normalized-daño',
    sql: `SELECT s."id" FROM "Sumario" s JOIN "Sentencia" t ON t."id"=s."sentenciaId"
          WHERE s."activo" AND t."activo"
            AND (s."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\'
                 OR t."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\')`,
    values: ['% daño %'] as Array<string | number>,
  },
  {
    id: 'prefix-legacy-accident',
    sql: `SELECT s."id" FROM "Sumario" s JOIN "Sentencia" t ON t."id"=s."sentenciaId"
          WHERE s."activo" AND t."activo"
            AND (s."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\'
                 OR t."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\')`,
    values: ['% accident%'] as Array<string | number>,
  },
  {
    id: 'suffix-legacy-accident',
    sql: `SELECT s."id" FROM "Sumario" s JOIN "Sentencia" t ON t."id"=s."sentenciaId"
          WHERE s."activo" AND t."activo"
            AND (s."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\'
                 OR t."textoBusquedaNormalizado" LIKE $1 ESCAPE E'\\\\')`,
    values: ['%accident %'] as Array<string | number>,
  },
  {
    id: 'exact-sentencia-primary-key',
    sql: 'SELECT t."id" FROM "Sentencia" t WHERE t."id"=$1',
    values: [1] as Array<string | number>,
  },
  {
    id: 'fts-spanish-daño',
    sql: `SELECT s."id" FROM "Sumario" s JOIN "Sentencia" t ON t."id"=s."sentenciaId"
          WHERE s."activo" AND t."activo"
            AND to_tsvector('spanish', coalesce(s."textoBusquedaNormalizado",'')) @@ plainto_tsquery('spanish',$1)`,
    values: ['daño'] as Array<string | number>,
  },
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Run through the DEV database guard.');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const identity = await client.query(`SELECT current_database() AS database, current_user AS role,
      inet_server_addr()::text AS address, inet_server_port() AS port, current_setting('server_version_num')::int AS version`);
    const target = identity.rows[0];
    if (target.database !== 'buscador_juridico_civil_dev' || target.role !== 'bjc_dev' ||
        target.address?.split('/')[0] !== '127.0.0.1' || target.port !== 55432 ||
        target.version < 160000 || target.version >= 170000) throw new Error('EXPLAIN target failed DEV identity checks.');

    const results: Array<{ id: string; plan: any }> = [];
    for (const item of plans) {
      const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${item.sql}`, item.values);
      const plan = result.rows[0]['QUERY PLAN'][0];
      results.push({ id: item.id, plan });
    }
    const fts = await client.query(`SELECT to_tsvector('spanish', 'prescripción prescripcion Peña Pena daño daños')::text AS vector,
      plainto_tsquery('spanish', 'prescripción')::text AS accented_query,
      plainto_tsquery('spanish', 'prescripcion')::text AS plain_query,
      plainto_tsquery('spanish', 'Peña')::text AS enye_query,
      plainto_tsquery('spanish', 'Pena')::text AS ene_query`);
    const report = {
      generatedAt: new Date().toISOString(),
      target: { serverVersion: target.version, endpoint: '127.0.0.1:55432', database: target.database, role: target.role },
      method: 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON); read-only SELECTs',
      plans: results,
      spanishFtsProbe: fts.rows[0],
      indexDecision: 'No index added by this mission; review actual access paths and representative timings first.',
    };
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`EXPLAIN=PASS; plans=${results.length}; report=docs/integracion/30-explain-postgresql.json`);
    for (const result of results) {
      const top = result.plan.Plan;
      console.log(`PLAN=${result.id}; node=${top['Node Type']}; index=${top['Index Name'] ?? 'none'}; actualMs=${top['Actual Total Time']}; rows=${top['Actual Rows']}; sharedHits=${top['Shared Hit Blocks']}; sharedReads=${top['Shared Read Blocks']}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(`EXPLAIN=FAIL; ${error.message}`); process.exitCode = 1; });

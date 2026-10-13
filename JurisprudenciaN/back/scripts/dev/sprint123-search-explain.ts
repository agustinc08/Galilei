import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('Run through the DEV database guard.');
const target = new URL(raw);
if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');

const cases: Array<{ id: string; sql: string; values: unknown[] }> = [
  {
    id: 'phrase-punctuation-tolerant-token-candidates',
    sql: `WITH first AS MATERIALIZED (SELECT DISTINCT "documentId" AS id FROM "CorpusSearchToken" WHERE token ILIKE $1 ESCAPE E'\\\\'),
               second AS MATERIALIZED (SELECT DISTINCT "documentId" AS id FROM "CorpusSearchToken" WHERE token ILIKE $2 ESCAPE E'\\\\'),
               candidates AS MATERIALIZED (SELECT id FROM first INTERSECT SELECT id FROM second)
          SELECT count(*) FROM candidates c JOIN "CorpusDocument" d ON d.id=c.id
           WHERE d.visibility = ANY($4::text[]) AND d.status='INDEXED' AND d."searchText" ILIKE $3`,
    values: ['%responsabilidad%', '%civil%', '%responsabilidad civil%', ['PUBLIC', 'INTERNAL']],
  },
  {
    id: 'phrase-exact-token-equality',
    sql: `SELECT count(DISTINCT "documentId") FROM "CorpusSearchToken" WHERE token = $1`,
    values: ['responsabilidad'],
  },
  {
    id: 'short-term-trigram-candidate',
    sql: `SELECT count(DISTINCT "documentId") FROM "CorpusSearchToken" WHERE token ILIKE $1 ESCAPE E'\\\\'`,
    values: ['%de%'],
  },
  {
    id: 'prefix-token-candidate',
    sql: `SELECT count(DISTINCT "documentId") FROM "CorpusSearchToken" WHERE token LIKE $1 ESCAPE E'\\\\'`,
    values: ['responsabilid%'],
  },
  {
    id: 'suffix-reversed-token-candidate',
    sql: `SELECT count(DISTINCT "documentId") FROM "CorpusSearchToken" WHERE reverse(token) LIKE $1 ESCAPE E'\\\\'`,
    values: ['livic%'],
  },
];

async function main() {
  const client = new Client({ connectionString: raw });
  try {
    await client.connect();
    const identity = await client.query(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port`);
    const row = identity.rows[0];
    if (row.database !== 'buscador_juridico_civil_dev' || row.role !== 'bjc_dev' || row.address !== '127.0.0.1/32' || Number(row.port) !== 55432) throw new Error('DEV_DATABASE_IDENTITY_REJECTED');
    const plans: Record<string, unknown> = {};
    for (const sample of cases) {
      const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT JSON) ${sample.sql}`, sample.values);
      plans[sample.id] = result.rows[0]['QUERY PLAN'];
    }
    const sizes = await client.query(`
      SELECT pg_database_size(current_database())::text AS "databaseBytes",
             indexrelname AS "indexName", pg_relation_size(indexrelid)::text AS "indexBytes"
        FROM pg_stat_user_indexes
       WHERE schemaname = 'public' AND relname = 'CorpusSearchToken'
       ORDER BY pg_relation_size(indexrelid) DESC
    `);
    const root = resolve(__dirname, '../../../..');
    const outputDirectory = resolve(root, process.env.BJC_SPRINT148 === 'true' ? '_recovery-work/sprint148/plans' : '_recovery-work/sprint123/plans');
    mkdirSync(outputDirectory, { recursive: true });
    const outputPath = resolve(outputDirectory, 'search-shapes.json');
    writeFileSync(outputPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      target: { endpoint: '127.0.0.1:55432', database: row.database, role: row.role },
      queryTextPersisted: false,
      plans,
      corpusTokenProjectionIndexSizes: sizes.rows,
    }, null, 2)}\n`, 'utf8');
    console.log(`SPRINT123_EXPLAIN=PASS; plans=${cases.length}; output=${outputPath}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = (error as Error)?.message ?? '';
  console.error(message.startsWith('DEV_DATABASE_') ? message : 'SPRINT123_EXPLAIN_FAILED');
  process.exitCode = 1;
});

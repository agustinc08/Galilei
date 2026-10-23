import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('Run through the DEV database guard.');
const target = new URL(raw);
if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
const normTema = `regexp_replace(translate(lower(coalesce(s."tema",'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g')`;
const cases: Array<{ id: string; kind: 'candidate' | 'rank'; sql: string; values: unknown[] }> = [
  {
    id: 'term-common-candidate', kind: 'candidate',
    sql: `WITH candidates AS MATERIALIZED (
      SELECT s."id" FROM "Sumario" s WHERE s."activo" = TRUE AND s."textoBusquedaNormalizado" LIKE $1
      UNION SELECT s."id" FROM "Sentencia" t JOIN "Sumario" s ON s."sentenciaId"=t."id" WHERE s."activo"=TRUE AND t."activo"=TRUE AND t."textoBusquedaNormalizado" LIKE $2
    ) SELECT count(*) FROM candidates`,
    values: ['% danos %', '% danos %'],
  },
  {
    id: 'term-zero-candidate', kind: 'candidate',
    sql: `WITH candidates AS MATERIALIZED (SELECT s."id" FROM "Sumario" s WHERE s."activo"=TRUE AND s."textoBusquedaNormalizado" LIKE $1) SELECT count(*) FROM candidates`,
    values: ['% zzzxqv %'],
  },
  {
    id: 'field-tema-candidate', kind: 'candidate',
    sql: `WITH candidates AS MATERIALIZED (
      SELECT s."id" FROM "Sumario" s JOIN "Sentencia" t ON t."id"=s."sentenciaId"
      WHERE s."activo"=TRUE AND t."activo"=TRUE AND ${normTema} LIKE $1
    ) SELECT count(*) FROM candidates`,
    values: ['% danos %'],
  },
  {
    id: 'field-tema-ranked-page', kind: 'rank',
    sql: `WITH candidates AS MATERIALIZED (
      SELECT s."id" FROM "Sumario" s JOIN "Sentencia" t ON t."id"=s."sentenciaId"
      WHERE s."activo"=TRUE AND t."activo"=TRUE AND ${normTema} LIKE $1
    )
    SELECT s."id", similarity(${normTema}, $2) AS trigramScore
      FROM candidates c JOIN "Sumario" s ON s."id"=c."id" JOIN "Sentencia" t ON t."id"=s."sentenciaId"
     WHERE s."activo"=TRUE AND t."activo"=TRUE
     ORDER BY trigramScore DESC, t."fecha" DESC NULLS LAST, s."id" DESC LIMIT 25`,
    values: ['% danos %', 'danos'],
  },
  {
    id: 'corpus-token-term-common', kind: 'candidate',
    sql: `SELECT DISTINCT token."documentId"
            FROM "CorpusSearchToken" token
           WHERE token."token" ILIKE $1`,
    values: ['%responsabilidad%'],
  },
  {
    id: 'corpus-token-term-short', kind: 'candidate',
    sql: `SELECT DISTINCT token."documentId"
            FROM "CorpusSearchToken" token
           WHERE token."token" ILIKE $1`,
    values: ['%de%'],
  },
  {
    id: 'corpus-token-term-zero', kind: 'candidate',
    sql: `SELECT DISTINCT token."documentId"
            FROM "CorpusSearchToken" token
           WHERE token."token" ILIKE $1`,
    values: ['%zzqvnoresult2026sprint12%'],
  },
  {
    id: 'corpus-token-ranked-first-page', kind: 'rank',
    sql: `WITH candidates AS MATERIALIZED (
            SELECT DISTINCT token."documentId" AS "id"
              FROM "CorpusSearchToken" token
             WHERE token."token" ILIKE $1
          ), "candidateWindow" AS MATERIALIZED (
            SELECT d."id", d."decisionDate", d."updatedAt"
              FROM candidates c JOIN "CorpusDocument" d ON d."id"=c."id"
             WHERE d."visibility" = ANY($2::text[]) AND d."status" = 'INDEXED'
             ORDER BY d."decisionDate" DESC NULLS LAST, d."updatedAt" DESC, d."id"
             LIMIT 11
          ) SELECT * FROM "candidateWindow" ORDER BY "decisionDate" DESC NULLS LAST, "updatedAt" DESC, "id"`,
    values: ['%responsabilidad%', ['PUBLIC', 'INTERNAL']],
  },
  {
    id: 'corpus-phrase-candidate-verification', kind: 'candidate',
    sql: `WITH "firstToken" AS MATERIALIZED (
            SELECT DISTINCT token."documentId" AS "id"
              FROM "CorpusSearchToken" token JOIN "CorpusDocument" d ON d."id"=token."documentId"
             WHERE d."visibility" = ANY($1::text[]) AND d."status"='INDEXED' AND token."token" ILIKE $2
          ), "secondToken" AS MATERIALIZED (
            SELECT DISTINCT token."documentId" AS "id"
              FROM "CorpusSearchToken" token JOIN "CorpusDocument" d ON d."id"=token."documentId"
             WHERE d."visibility" = ANY($1::text[]) AND d."status"='INDEXED' AND token."token" ILIKE $3
          ), "phraseCandidates" AS MATERIALIZED (
            SELECT "id" FROM "firstToken" INTERSECT SELECT "id" FROM "secondToken"
          )
          SELECT count(*)
            FROM "phraseCandidates" c JOIN "CorpusDocument" d ON d."id"=c."id"
           WHERE d."visibility" = ANY($1::text[]) AND d."status"='INDEXED' AND d."searchText" ILIKE $4`,
    values: [['PUBLIC', 'INTERNAL'], '%responsabilidad%', '%civil%', '%responsabilidad civil%'],
  },
  {
    id: 'corpus-prefix-candidate-verification', kind: 'candidate',
    sql: `WITH candidates AS MATERIALIZED (
            SELECT DISTINCT token."documentId" AS "id"
              FROM "CorpusSearchToken" token JOIN "CorpusDocument" d ON d."id"=token."documentId"
             WHERE d."visibility" = ANY($1::text[]) AND d."status"='INDEXED' AND token."token" ILIKE $2
          )
          SELECT count(*) FROM candidates c JOIN "CorpusDocument" d ON d."id"=c."id"
           WHERE d."visibility" = ANY($1::text[]) AND d."status"='INDEXED' AND d."searchText" ILIKE $3`,
    values: [['PUBLIC', 'INTERNAL'], 'responsabilid%', 'responsabilid%'],
  },
  {
    id: 'corpus-suffix-candidate-verification', kind: 'candidate',
    sql: `WITH candidates AS MATERIALIZED (
            SELECT DISTINCT token."documentId" AS "id"
              FROM "CorpusSearchToken" token JOIN "CorpusDocument" d ON d."id"=token."documentId"
             WHERE d."visibility" = ANY($1::text[]) AND d."status"='INDEXED' AND token."token" ILIKE $2
          )
          SELECT count(*) FROM candidates c JOIN "CorpusDocument" d ON d."id"=c."id"
           WHERE d."visibility" = ANY($1::text[]) AND d."status"='INDEXED' AND d."searchText" ILIKE $3`,
    values: [['PUBLIC', 'INTERNAL'], '%civil', '%civil'],
  },
  {
    id: 'juris-reference-normative-candidates', kind: 'candidate',
    sql: `SELECT r."sentenciaId" FROM "ReferenciaNormativa" r JOIN "Sentencia" t ON t."id"=r."sentenciaId"
           WHERE t."activo"=TRUE AND (
             regexp_replace(translate(lower(coalesce(r."tipoNorma",'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') LIKE $1 OR
             regexp_replace(translate(lower(coalesce(r."numeroNorma",'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') LIKE $1 OR
             regexp_replace(translate(lower(coalesce(r."articulo",'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') LIKE $1 OR
             regexp_replace(translate(lower(coalesce(r."inciso",'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') LIKE $1 OR
             regexp_replace(translate(lower(coalesce(r."textoReferencia",'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') LIKE $1
           )`,
    values: ['%responsabilidad%'],
  },
  {
    id: 'juris-reference-jurisprudential-candidates', kind: 'candidate',
    sql: `SELECT r."sentenciaId" FROM "ReferenciaJurisprudencial" r JOIN "Sentencia" t ON t."id"=r."sentenciaId"
           WHERE t."activo"=TRUE AND (
             regexp_replace(translate(lower(coalesce(r."referencia",'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') LIKE $1 OR
             regexp_replace(translate(lower(coalesce(r."textoOriginal",'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') LIKE $1
           )`,
    values: ['%responsabilidad%'],
  },
  {
    id: 'juris-reference-doctrinal-candidates', kind: 'candidate',
    sql: `SELECT r."sentenciaId" FROM "ReferenciaDoctrinaria" r JOIN "Sentencia" t ON t."id"=r."sentenciaId"
           WHERE t."activo"=TRUE AND (
             regexp_replace(translate(lower(coalesce(r."autor",'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') LIKE $1 OR
             regexp_replace(translate(lower(coalesce(r."titulo",'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') LIKE $1 OR
             regexp_replace(translate(lower(coalesce(r."fuente",'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') LIKE $1 OR
             regexp_replace(translate(lower(coalesce(r."textoReferencia",'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') LIKE $1
           )`,
    values: ['%responsabilidad%'],
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
      const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sample.sql}`, sample.values);
      plans[sample.id] = result.rows[0]['QUERY PLAN'];
    }
    const sizes = await client.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size,
             indexrelname AS index_name, pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
        FROM pg_stat_user_indexes
       WHERE indexrelname LIKE 'idx%search%norm%trgm'
       ORDER BY pg_relation_size(indexrelid) DESC
    `);
    const corpusSizes = await client.query(`
      SELECT pg_database_size(current_database())::text AS "databaseBytes",
             indexrelname AS "indexName", pg_relation_size(indexrelid)::text AS "indexBytes"
        FROM pg_stat_user_indexes
       WHERE schemaname = 'public' AND (relname LIKE 'CorpusSearchToken%')
       ORDER BY pg_relation_size(indexrelid) DESC
    `);
    const root = resolve(__dirname, '../../../');
    const outputDirectory = resolve(root, '_recovery-work/sprint122/plans');
    mkdirSync(outputDirectory, { recursive: true });
    const outputPath = resolve(outputDirectory, 'term-and-field-explain.json');
    writeFileSync(outputPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      target: { endpoint: '127.0.0.1:55432', database: row.database, role: row.role },
      plans,
      searchIndexSizes: sizes.rows,
      corpusTokenProjectionIndexSizes: corpusSizes.rows,
    }, null, 2)}\n`, 'utf8');
    console.log(`EXPLAIN=PASS; plans=${cases.length}; indexes=${sizes.rowCount}; output=${outputPath}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`EXPLAIN=FAIL; ${(error as Error).message}`);
  process.exitCode = 1;
});

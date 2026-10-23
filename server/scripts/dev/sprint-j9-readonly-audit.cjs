const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not configured by the DEV guard.');
  process.exit(2);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const identity = await client.query(`
      SELECT current_database() AS database,
             current_user AS role,
             inet_server_addr()::text AS host,
             inet_server_port() AS port,
             current_setting('server_version_num') AS server_version_num
    `);
    const sentencias = await client.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE publicado)::int AS published,
             count(*) FILTER (WHERE activo)::int AS active,
             count(*) FILTER (WHERE publicado AND activo)::int AS public_candidate,
             count(*) FILTER (WHERE "publishedAt" IS NOT NULL)::int AS published_timestamp,
             count(*) FILTER (WHERE juez IS NOT NULL)::int AS judge_metadata,
             count(*) FILTER (WHERE NOT publicado AND activo)::int AS unpublished_active,
             count(*) FILTER (WHERE NOT activo)::int AS inactive,
             count(*) FILTER (WHERE "tienePdf")::int AS has_legacy_pdf
      FROM "Sentencia"
    `);
    const sumarios = await client.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE s.publicado AND s.activo AND f.publicado AND f.activo)::int AS reader_visible
      FROM "Sumario" s JOIN "Sentencia" f ON f.id = s."sentenciaId"
    `);
    const corpus = await client.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'INDEXED')::int AS indexed,
             count(*) FILTER (WHERE visibility = 'PUBLIC')::int AS public,
             count(*) FILTER (WHERE visibility = 'INTERNAL')::int AS internal,
             count(*) FILTER (WHERE "documentScope" = 'GENERAL')::int AS general_scope,
             count(*) FILTER (WHERE "documentScope" = 'PRIVATE_WORKSPACE')::int AS private_scope
      FROM "CorpusDocument"
    `);
    const links = await client.query(`
      SELECT count(DISTINCT l."documentId")::int AS linked_documents,
             count(DISTINCT l."targetId")::int AS linked_sentence_ids,
             count(DISTINCT l."documentId") FILTER (WHERE f.id IS NOT NULL)::int AS links_to_existing_sentences,
             count(DISTINCT l."documentId") FILTER (WHERE f.id IS NULL)::int AS links_to_missing_sentences
      FROM "CorpusDocumentLink" l
      LEFT JOIN "Sentencia" f ON f.id::text = l."targetId"
      WHERE l."targetDomain" = 'JURISPRUDENCIA' AND l."targetType" = 'SENTENCIA'
    `);
    const corpusByStatus = await client.query(`
      SELECT status, visibility, "documentScope", count(*)::int AS count
      FROM "CorpusDocument"
      GROUP BY status, visibility, "documentScope"
      ORDER BY status, visibility, "documentScope"
    `);
    const searchTokens = await client.query(`
      SELECT to_regclass('public."CorpusSearchToken"') IS NOT NULL AS exists
    `);
    const result = {
      audit: 'SPRINT_J9_READ_ONLY',
      databaseIdentity: identity.rows[0],
      sentencias: sentencias.rows[0],
      sumarios: sumarios.rows[0],
      corpus: corpus.rows[0],
      jurisprudenciaLinks: links.rows[0],
      corpusByStatus: corpusByStatus.rows,
      corpusSearchTokenTableExists: searchTokens.rows[0].exists,
      transaction: 'READ ONLY',
    };
    if (result.databaseIdentity.database !== 'buscador_juridico_civil_dev' ||
        !String(result.databaseIdentity.host).startsWith('127.0.0.1') ||
        Number(result.databaseIdentity.port) !== 55432 ||
        result.databaseIdentity.role !== 'bjc_dev') {
      throw new Error(`Connected identity mismatch: ${JSON.stringify(result.databaseIdentity)}`);
    }
    console.log(JSON.stringify(result, null, 2));
    const root = path.resolve(__dirname, '../../../');
    const output = path.join(root, '_recovery-work', 'jurisprudencia-j9', 'database-audit.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(`SPRINT_J9_READ_ONLY_AUDIT=FAIL; ${error.message}`);
  process.exitCode = 1;
}).finally(() => pool.end());

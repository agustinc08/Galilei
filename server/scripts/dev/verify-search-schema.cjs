const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const identity = await client.query(`
      SELECT current_database() AS database,
             current_user AS role,
             inet_server_addr()::text AS server_addr,
             inet_server_port() AS server_port,
             current_setting('server_version_num')::integer AS version_num
    `);
    const target = identity.rows[0];
    target.server_addr = target.server_addr?.split('/')[0];
    if (target.database !== 'buscador_juridico_civil_dev' || target.role !== 'bjc_dev' ||
        target.server_addr !== '127.0.0.1' || target.server_port !== 55432 ||
        target.version_num < 160000 || target.version_num >= 170000) {
      throw new Error(`Connected PostgreSQL identity does not match the isolated DEV target: ${JSON.stringify(target)}`);
    }

    const tables = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
    const extension = await client.query(`SELECT extname, extversion FROM pg_extension WHERE extname='pg_trgm'`);
    const migrations = await client.query(`SELECT count(*)::integer AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
    const fixture = await client.query(`
      SELECT (SELECT count(*)::integer FROM "Sentencia" WHERE "legacyId" LIKE 'sqlite:jurisp_6/db/jurisprudencia_db.sqlite#tb_sentencias/%') AS sentencias,
             (SELECT count(*)::integer FROM "Sumario" WHERE "legacyId" LIKE 'sqlite:jurisp_6/db/jurisprudencia_db.sqlite#tb_sumarios/%') AS sumarios,
             (SELECT count(*)::integer FROM "Sumario" WHERE "legacyId" IS NOT NULL AND "legacyId" NOT LIKE 'sqlite:jurisp_6/db/jurisprudencia_db.sqlite#tb_sumarios/%') AS other_sumarios
    `);
    const corpusCounts = await client.query(`
      SELECT (SELECT count(*)::integer FROM "CorpusSourceSystem") AS sources,
             (SELECT count(*)::integer FROM "CorpusDocument") AS documents,
             (SELECT count(*)::integer FROM "CorpusDocumentFile") AS files,
             (SELECT count(*)::integer FROM "CorpusIngestionRecord") AS ingestions,
             (SELECT count(*)::integer FROM "CorpusExtraction") AS extractions
    `);
    const activity = await client.query(`SELECT state, wait_event_type, wait_event, count(*)::integer AS count FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND pid<>pg_backend_pid() GROUP BY state, wait_event_type, wait_event`);
    const projection = await client.query(`
      SELECT control."isReady" AS ready,
             (SELECT count(*)::text FROM "CorpusSearchToken") AS tokens,
             (SELECT count(*)::text FROM "CorpusSearchTokenState") AS documents
        FROM "CorpusSearchTokenProjectionControl" control
       WHERE control."singleton" = TRUE
    `);
    const tableNames = tables.rows.map((row) => row.tablename);
    for (const required of [
      'Sentencia', 'Sumario', 'ArchivoPdf', '_prisma_migrations',
      'CorpusSourceSystem', 'CorpusDocument', 'CorpusDocumentFile',
      'CorpusIngestionRecord', 'CorpusExtraction', 'CorpusDocumentPage',
      'CorpusDocumentLink', 'CorpusSearchToken', 'CorpusSearchTokenState',
      'CorpusSearchTokenProjectionControl',
    ]) {
      if (!tableNames.includes(required)) throw new Error(`Required table ${required} is missing.`);
    }
    if (migrations.rows[0].count < 20) throw new Error('Expected Sprint 12.2 Search projection migrations to be applied.');
    if (projection.rows.length !== 1 || projection.rows[0].ready !== true) throw new Error('Corpus Search token projection has not passed readiness verification.');
    const corpusSearchIndex = await client.query(`SELECT to_regclass('public."CorpusDocument_searchText_trgm_idx"') IS NOT NULL AS present`);
    if (!corpusSearchIndex.rows[0].present) throw new Error('Corpus trigram search index is missing.');
    if (!extension.rows.length) throw new Error('pg_trgm is not enabled.');
    if (fixture.rows[0].sentencias !== 21109 || fixture.rows[0].sumarios !== 25138 || fixture.rows[0].other_sumarios !== 0) {
      throw new Error(`Fixture counts differ from the reproducible source: ${JSON.stringify(fixture.rows[0])}`);
    }

    console.log(`SCHEMA=PASS; tables=${tableNames.length}; migrations=${migrations.rows[0].count}; pg_trgm=${extension.rows[0].extversion}; server=${target.version_num}; endpoint=${target.server_addr}:${target.server_port}; role=${target.role}; database=${target.database}; fixtureSentencias=${fixture.rows[0].sentencias}; fixtureSumarios=${fixture.rows[0].sumarios}; otherLegacySumarios=${fixture.rows[0].other_sumarios}; projectionReady=${projection.rows[0].ready}; projectionDocuments=${projection.rows[0].documents}; projectionTokens=${projection.rows[0].tokens}`);
    console.log(`TABLES=${tableNames.join(',')}`);
    console.log(`CORPUS_ROWS=${JSON.stringify(corpusCounts.rows[0])}`);
    console.log(`OTHER_SESSIONS=${JSON.stringify(activity.rows)}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`SCHEMA=FAIL; ${error.message}`);
  process.exitCode = 1;
});

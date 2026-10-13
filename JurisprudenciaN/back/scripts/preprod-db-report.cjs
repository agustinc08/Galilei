#!/usr/bin/env node
// Read-only preproduction inventory. Must be launched through with-preprod-db-guard.cjs.
const { Client } = require('pg');

if (process.env.BJC_PREPROD_GUARD_VALIDATED !== 'true') {
  console.error('PREPROD_DB_REPORT=ABORT; use scripts/with-preprod-db-guard.cjs db-report.');
  process.exit(2);
}

async function main() {
  const config = {
    host: process.env.BJC_PREPROD_DB_HOST,
    port: Number(process.env.BJC_PREPROD_DB_PORT),
    database: process.env.BJC_PREPROD_DB_NAME,
    user: process.env.BJC_PREPROD_DB_USER,
    connectionString: process.env.DATABASE_URL,
  };
  const client = new Client(config);
  try {
    await client.connect();
    const identity = (await client.query(`
      SELECT current_database() AS database, current_user AS role,
             inet_server_addr()::text AS address, inet_server_port() AS port,
             pg_postmaster_start_time() AS server_started_at
    `)).rows[0];
    if (identity.database !== config.database || identity.role !== config.user || Number(identity.port) !== config.port ||
        !identity.address || /^(127\.|::ffff:127\.|::1(?:\/|$)|::(?:\/|$)|0\.0\.0\.0)/iu.test(identity.address)) {
      throw new Error('La identidad PostgreSQL efectiva no coincide con la identidad preprod aprobada.');
    }

    const report = await client.query(`
      SELECT
        (SELECT count(*)::int FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL) AS "appliedMigrations",
        (SELECT count(*)::int FROM "_prisma_migrations" WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL) AS "pendingMigrations",
        (SELECT COALESCE(json_agg("migration_name" ORDER BY "migration_name"), '[]'::json)
           FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
             AND "migration_name" IN ('20261008210000_corpus_search_token_projection', '20261008220000_corpus_search_projection_readiness')) AS "projectionMigrations",
        (SELECT count(*)::int FROM "CorpusDocument") AS "corpusDocuments",
        (SELECT count(*)::int FROM "CorpusDocumentFile") AS "corpusFiles",
        (SELECT COALESCE(sum("sizeBytes"), 0)::text FROM "CorpusDocumentFile") AS "corpusBytes",
        (SELECT count(*)::int FROM "CorpusSearchToken") AS "searchTokens",
        (SELECT "isReady" FROM "CorpusSearchTokenProjectionControl" WHERE "singleton" = TRUE) AS "projectionReady",
        (SELECT count(*)::int FROM "CorpusDocument" d
          LEFT JOIN "CorpusSearchTokenState" s ON s."documentId" = d."id"
          WHERE s."documentId" IS NULL OR s."sourceChecksum" <> md5(COALESCE(d."searchText", ''))
             OR s."tokenCount" <> (SELECT count(*) FROM "CorpusSearchToken" t WHERE t."documentId" = d."id")) AS "staleDocuments",
        (SELECT extversion FROM pg_extension WHERE extname = 'pg_trgm') AS "pgTrgmVersion",
        pg_database_size(current_database())::text AS "databaseBytes"
    `);
    console.log(JSON.stringify({
      environment: 'preprod',
      target: { host: config.host, serverAddress: identity.address, port: Number(config.port), database: identity.database, role: identity.role },
      serverStartedAt: identity.server_started_at,
      generatedAt: new Date().toISOString(),
      ...report.rows[0],
      secretsPersisted: false,
    }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`PREPROD_DB_REPORT=FAIL; ${error instanceof Error ? error.message : 'database report failed'}`);
  process.exitCode = 1;
});

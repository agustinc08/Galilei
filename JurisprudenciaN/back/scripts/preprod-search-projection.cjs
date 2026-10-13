#!/usr/bin/env node
// Isolated preproduction projection maintenance. Never call the DEV script here.
const { Client } = require('pg');

if (process.env.BJC_PREPROD_GUARD_VALIDATED !== 'true') {
  console.error('PREPROD_PROJECTION=ABORT; use scripts/with-preprod-db-guard.cjs projection-*.');
  process.exit(2);
}

const action = process.argv[2] || 'verify';
if (!['rebuild', 'verify', 'repair'].includes(action)) {
  console.error('Usage: guarded projection-rebuild|projection-verify|projection-repair');
  process.exit(2);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const identity = (await client.query(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port`)).rows[0];
    if (identity.database !== process.env.BJC_PREPROD_DB_NAME || identity.role !== process.env.BJC_PREPROD_DB_USER || Number(identity.port) !== Number(process.env.BJC_PREPROD_DB_PORT) || !identity.address || /^(127\.|::ffff:127\.|::1(?:\/|$)|::(?:\/|$)|0\.0\.0\.0)/iu.test(identity.address)) {
      throw new Error('La identidad PostgreSQL efectiva no coincide con la identidad preprod aprobada.');
    }

    let rebuiltDocuments = 0;
    let repairCursor = '';
    await client.query(`UPDATE "CorpusSearchTokenProjectionControl" SET "isReady" = FALSE, "verifiedAt" = NULL WHERE "singleton" = TRUE`);
    if (action !== 'verify') {
      for (;;) {
        const stale = action === 'repair'
          ? await client.query(`SELECT "id" FROM "CorpusDocument" WHERE "id" > $1 ORDER BY "id" LIMIT 50`, [repairCursor])
          : await client.query(`
              SELECT d."id" FROM "CorpusDocument" d
              LEFT JOIN "CorpusSearchTokenState" s ON s."documentId" = d."id"
              WHERE s."documentId" IS NULL OR s."sourceChecksum" <> md5(COALESCE(d."searchText", ''))
                 OR s."tokenCount" <> (SELECT count(*) FROM "CorpusSearchToken" t WHERE t."documentId" = d."id")
              ORDER BY d."id" LIMIT 50
            `);
        if (!stale.rowCount) break;
        const ids = stale.rows.map((row) => row.id);
        await client.query(`SELECT "refreshCorpusSearchTokens"(id) FROM unnest($1::text[]) AS batch(id)`, [ids]);
        if (action === 'repair') repairCursor = ids[ids.length - 1];
        rebuiltDocuments += ids.length;
        console.log(JSON.stringify({ projectionAction: action, batchDocuments: ids.length, rebuiltDocuments }));
      }
    }

    const state = (await client.query(`
      SELECT (SELECT count(*)::int FROM "CorpusDocument") AS "documents",
             (SELECT count(*)::int FROM "CorpusSearchToken") AS "tokens",
             (SELECT count(*)::int FROM "CorpusDocument" d LEFT JOIN "CorpusSearchTokenState" s ON s."documentId" = d."id"
               WHERE s."documentId" IS NULL OR s."sourceChecksum" <> md5(COALESCE(d."searchText", ''))
                  OR s."tokenCount" <> (SELECT count(*) FROM "CorpusSearchToken" t WHERE t."documentId" = d."id")) AS "staleDocuments",
             (SELECT count(*)::int FROM (SELECT d."id" FROM (SELECT "id", "searchText" FROM "CorpusDocument" ORDER BY md5("id") LIMIT 100) d
               WHERE EXISTS (
                 SELECT token FROM (
                   (SELECT DISTINCT split.value AS token FROM regexp_split_to_table(COALESCE(d."searchText", ''), '[[:space:]]+') AS split(value) WHERE split.value <> '')
                   EXCEPT (SELECT "token" FROM "CorpusSearchToken" WHERE "documentId" = d."id")
                   UNION ALL
                   (SELECT "token" FROM "CorpusSearchToken" WHERE "documentId" = d."id")
                   EXCEPT (SELECT DISTINCT split.value AS token FROM regexp_split_to_table(COALESCE(d."searchText", ''), '[[:space:]]+') AS split(value) WHERE split.value <> '')
                 ) diff
               )) sample) AS "sampleMismatches",
             (SELECT count(*)::int FROM (SELECT 1 FROM "CorpusDocument" ORDER BY md5("id") LIMIT 100) sample) AS "sampledDocuments"
    `)).rows[0];
    const ready = Number(state.staleDocuments) === 0 && Number(state.sampleMismatches) === 0;
    await client.query(`UPDATE "CorpusSearchTokenProjectionControl" SET "isReady" = $1, "verifiedAt" = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE "singleton" = TRUE`, [ready]);
    console.log(JSON.stringify({
      status: ready ? `PREPROD_SEARCH_PROJECTION_${action.toUpperCase()}_PASS` : `PREPROD_SEARCH_PROJECTION_${action.toUpperCase()}_STALE`,
      generatedAt: new Date().toISOString(),
      target: { port: Number(identity.port), database: identity.database, role: identity.role },
      rebuiltDocuments,
      isReady: ready,
      ...state,
      queryTextPersisted: false,
    }, null, 2));
    if (!ready) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`PREPROD_SEARCH_PROJECTION=FAIL; ${error instanceof Error ? error.message : 'projection operation failed'}`);
  process.exitCode = 1;
});

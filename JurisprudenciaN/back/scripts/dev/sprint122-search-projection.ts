import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('Run through the DEV database guard.');
const target = new URL(raw);
if (
  target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' ||
  target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' ||
  target.username !== 'bjc_dev'
) throw new Error('DEV_DATABASE_TARGET_REJECTED');

type Identity = { database: string; role: string; address: string; port: number };
type State = { documents: string; tokens: string; staleDocuments: string; sampledDocuments: string; sampleMismatches: string; databaseBytes: string; tokenIndexBytes: string };

async function main() {
  const action = process.argv[2] ?? 'verify';
  if (!['rebuild', 'verify', 'repair'].includes(action)) throw new Error('SEARCH_PROJECTION_ACTION_REJECTED');
  const client = new Client({ connectionString: raw });
  try {
    await client.connect();
    const identityResult = await client.query<Identity>(`
      SELECT current_database() AS database, current_user AS role,
             inet_server_addr()::text AS address, inet_server_port() AS port
    `);
    const identity = identityResult.rows[0];
    if (
      identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' ||
      identity.address !== '127.0.0.1/32' || Number(identity.port) !== 55432
    ) throw new Error('DEV_DATABASE_IDENTITY_REJECTED');

    let rebuiltDocuments = 0;
    let repairCursor = '';
    await client.query(`UPDATE "CorpusSearchTokenProjectionControl" SET "isReady" = FALSE, "verifiedAt" = NULL WHERE "singleton" = TRUE`);
    if (action !== 'verify') {
      for (;;) {
        const stale = action === 'repair'
          ? await client.query<{ id: string }>(
            `SELECT "id" FROM "CorpusDocument" WHERE "id" > $1 ORDER BY "id" LIMIT 50`,
            [repairCursor],
          )
          : await client.query<{ id: string }>(`
            SELECT d."id"
              FROM "CorpusDocument" d
              LEFT JOIN "CorpusSearchTokenState" state ON state."documentId" = d."id"
             WHERE state."documentId" IS NULL
                OR state."sourceChecksum" <> md5(COALESCE(d."searchText", ''))
                OR state."tokenCount" <> (
                  SELECT count(*) FROM "CorpusSearchToken" token WHERE token."documentId" = d."id"
                )
             ORDER BY d."id"
             LIMIT 50
          `);
        if (stale.rowCount === 0) break;
        const refreshed = await client.query<{ count: number }>(
          `SELECT "refreshCorpusSearchTokens"(id) AS count FROM unnest($1::text[]) AS batch(id)`,
          [stale.rows.map((row) => row.id)],
        );
        if (action === 'repair') repairCursor = stale.rows.at(-1)?.id ?? repairCursor;
        rebuiltDocuments += refreshed.rowCount ?? refreshed.rows.length;
        console.log(JSON.stringify({ projectionAction: action, batchDocuments: stale.rowCount, rebuiltDocuments }));
      }
    }

    const stateResult = await client.query<State>(`
      SELECT
        (SELECT count(*)::text FROM "CorpusDocument") AS documents,
        (SELECT count(*)::text FROM "CorpusSearchToken") AS tokens,
        (SELECT count(*)::text
           FROM "CorpusDocument" d
           LEFT JOIN "CorpusSearchTokenState" state ON state."documentId" = d."id"
          WHERE state."documentId" IS NULL
             OR state."sourceChecksum" <> md5(COALESCE(d."searchText", ''))
             OR state."tokenCount" <> (
               SELECT count(*) FROM "CorpusSearchToken" token WHERE token."documentId" = d."id"
             )) AS "staleDocuments",
        (SELECT count(*)::text FROM (
          SELECT d."id"
            FROM (SELECT "id", "searchText" FROM "CorpusDocument" ORDER BY md5("id") LIMIT 100) d
           WHERE EXISTS (
             SELECT 1 FROM (
               (SELECT DISTINCT split.value AS token
                  FROM regexp_split_to_table(COALESCE(d."searchText", ''), '[[:space:]]+') AS split(value)
                 WHERE split.value <> '')
               EXCEPT
               (SELECT token."token" FROM "CorpusSearchToken" token WHERE token."documentId" = d."id")
               UNION ALL
               (SELECT token."token" FROM "CorpusSearchToken" token WHERE token."documentId" = d."id")
               EXCEPT
               (SELECT DISTINCT split.value AS token
                  FROM regexp_split_to_table(COALESCE(d."searchText", ''), '[[:space:]]+') AS split(value)
                 WHERE split.value <> '')
             ) difference
           )
        ) sampled WHERE TRUE) AS "sampleMismatches",
        (SELECT count(*)::text FROM (SELECT 1 FROM "CorpusDocument" ORDER BY md5("id") LIMIT 100) sampled) AS "sampledDocuments",
        pg_database_size(current_database())::text AS "databaseBytes",
        COALESCE((SELECT pg_relation_size('"CorpusSearchToken_token_trgm_idx"')::text), '0') AS "tokenIndexBytes"
    `);
    const state = stateResult.rows[0];
    const staleDocuments = Number(state.staleDocuments);
    const sampleMismatches = Number(state.sampleMismatches);
    const projectionReady = staleDocuments === 0 && sampleMismatches === 0;
    await client.query(
      `UPDATE "CorpusSearchTokenProjectionControl" SET "isReady" = $1, "verifiedAt" = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE "singleton" = TRUE`,
      [projectionReady],
    );
    const report = {
      status: projectionReady ? `${process.env.BJC_SPRINT149 === 'true' ? 'SPRINT149' : 'SPRINT122'}_SEARCH_PROJECTION_${action.toUpperCase()}_PASS` : `${process.env.BJC_SPRINT149 === 'true' ? 'SPRINT149' : 'SPRINT122'}_SEARCH_PROJECTION_${action.toUpperCase()}_STALE`,
      generatedAt: new Date().toISOString(),
      target: { endpoint: '127.0.0.1:55432', database: identity.database, role: identity.role },
      rebuiltDocuments,
      isReady: projectionReady,
      ...state,
      queryTextPersisted: false,
    };
    const root = resolve(__dirname, '../../../..');
    const directory = resolve(root, process.env.BJC_SPRINT149 === 'true' ? '_recovery-work/sprint149/projection' : '_recovery-work/sprint122/projection');
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, 'projection-status.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (!projectionReady) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`SPRINT122_SEARCH_PROJECTION_FAILED:${(error as Error).message}`);
  process.exitCode = 1;
});

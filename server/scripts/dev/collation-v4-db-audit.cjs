const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const h1 = new Date('2026-10-20T11:57:55.492Z');
async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const identity = (await client.query(`
      SELECT current_database() AS database, current_user AS role,
             host(inet_server_addr()) AS address, inet_server_port() AS port
    `)).rows[0];
    if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' || identity.address !== '127.0.0.1' || Number(identity.port) !== 55432) throw new Error('COLLATION_V4_DB_IDENTITY_MISMATCH');
    const totals = (await client.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NULL)::int AS pending,
             count(*) FILTER (WHERE "failedAt" IS NOT NULL)::int AS failed,
             max("id")::text AS max_id
        FROM "SearchIndexOutbox"
    `)).rows[0];
    const recentOutbox = (await client.query(`
      SELECT o."id"::text AS id, o."documentKey", o."operation", o."createdAt",
             o."processedAt", o."failedAt", o."lastError",
             (d."id" IS NOT NULL) AS corpus_document_exists
        FROM "SearchIndexOutbox" o
        LEFT JOIN "CorpusDocument" d
          ON o."documentKey" = 'CORPUS:' || d."id"
       WHERE o."createdAt" >= $1
       ORDER BY o."id"
    `, [h1])).rows;
    const syntheticResidue = (await client.query(`
      SELECT
        (SELECT count(*)::int FROM "Usuario" WHERE "createdAt" >= $1 AND "email" LIKE 'sprint1561-%@example.invalid') AS users,
        (SELECT count(*)::int FROM "DocumentWorkspace" w JOIN "DocumentDependency" d ON d."id"=w."dependencyId" WHERE w."createdAt" >= $1 AND d."code" LIKE 'S1561%') AS workspaces,
        (SELECT count(*)::int FROM "DocumentDependency" WHERE "createdAt" >= $1 AND "code" LIKE 'S1561%') AS dependencies,
        (SELECT count(*)::int FROM "WorkspaceFolder" WHERE "createdAt" >= $1 AND ("name" LIKE 'Restringida %' OR "name" LIKE 'Heredada %' OR "name" LIKE 'Anidada %' OR "name" LIKE 'Creada por editora %' OR "name" LIKE 'QA denegada %')) AS folders,
        (SELECT count(*)::int FROM "CorpusDocument" WHERE "createdAt" >= $1 AND ("title" LIKE 'sprint1561-%' OR "title" LIKE 'qa-restricted-page-%' OR "title" LIKE 'qa-fix2-%')) AS corpus_documents
    `, [h1])).rows[0];
    const ids = [...new Set(recentOutbox.filter(row => row.documentKey.startsWith('CORPUS:')).map(row => row.documentKey.slice('CORPUS:'.length)))];
    const osResponse = await fetch('http://127.0.0.1:9200/galilei-search-v004-20261020t094732495z-6015e394/_search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ size: Math.max(1, ids.length), query: { ids: { values: ids } } }), signal: AbortSignal.timeout(10000) });
    if (!osResponse.ok) throw new Error('COLLATION_V4_SHADOW_READ_FAILED');
    const osBody = await osResponse.json();
    const result = { capturedAt: new Date().toISOString(), identity, baselineAfterH1: h1.toISOString(), outbox: totals, rowsAfterH1: recentOutbox, syntheticResidue, v4SyntheticDocumentHits: osBody.hits?.total?.value ?? null, readOnly: true };
    await client.query('COMMIT');
    const evidenceRoot = path.resolve(process.cwd(), '..', '_recovery-work', 'jurisprudencia-collation-v4-implement1');
    fs.writeFileSync(path.join(evidenceRoot, 'db-audit-after-cleanup.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ capturedAt: result.capturedAt, identity, outbox: totals, recentRows: recentOutbox.length, firstId: recentOutbox[0]?.id ?? null, lastId: recentOutbox.at(-1)?.id ?? null, distinctSyntheticKeys: ids.length, allSyntheticSourceDocsDeleted: recentOutbox.every(row => !row.corpus_document_exists), syntheticResidue, v4SyntheticDocumentHits: result.v4SyntheticDocumentHits, evidence: 'db-audit-after-cleanup.json', readOnly: true }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'COLLATION_V4_DB_AUDIT_FAILED'); process.exitCode = 1; });

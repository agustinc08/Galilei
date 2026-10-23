const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const minimumId = 217810n;
const maximumId = 217962n;
const afterH1 = new Date('2026-10-20T11:57:55.492Z');
const earliestFixture = new Date('2026-10-20T12:10:11.000Z');
const latestFixture = new Date('2026-10-20T12:10:14.000Z');
async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    const identity = (await client.query(`SELECT current_database() AS database, current_user AS role, host(inet_server_addr()) AS address, inet_server_port() AS port`)).rows[0];
    if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' || identity.address !== '127.0.0.1' || Number(identity.port) !== 55432) throw new Error('COLLATION_V4_DB_IDENTITY_MISMATCH');
    const rows = (await client.query(`
      SELECT o."id"::text AS id, o."documentKey", o."operation", o."createdAt",
             o."processedAt", o."failedAt", o."lastError",
             (d."id" IS NOT NULL) AS corpus_document_exists
        FROM "SearchIndexOutbox" o
        LEFT JOIN "CorpusDocument" d ON o."documentKey" = 'CORPUS:' || d."id"
       WHERE o."id" BETWEEN $1 AND $2
         AND o."createdAt" >= $3 AND o."createdAt" <= $4
       ORDER BY o."id"
    `, [minimumId.toString(), maximumId.toString(), earliestFixture, latestFixture])).rows;
    const distinctKeys = [...new Set(rows.map(row => row.documentKey))];
    const operations = [...new Set(rows.map(row => row.operation))];
    const valid = rows.length === 153 && rows[0]?.id === minimumId.toString() && rows.at(-1)?.id === maximumId.toString() && distinctKeys.length === 10 && operations.every(operation => operation === 'UPSERT' || operation === 'DELETE') && rows.every(row => row.documentKey.startsWith('CORPUS:') && row.processedAt === null && row.failedAt === null && row.lastError === null && !row.corpus_document_exists && new Date(row.createdAt) >= earliestFixture && new Date(row.createdAt) <= latestFixture);
    if (!valid) { console.log(JSON.stringify({diagnostic:{rowCount:rows.length,firstId:rows[0]?.id,lastId:rows.at(-1)?.id,distinctKeys:distinctKeys.length,operations,allCorpus:rows.every(row=>row.documentKey.startsWith('CORPUS:')),allPending:rows.every(row=>row.processedAt===null),allNotFailed:rows.every(row=>row.failedAt===null),allNoError:rows.every(row=>row.lastError===null),allSourceMissing:rows.every(row=>!row.corpus_document_exists),minCreated:rows[0]?.createdAt,maxCreated:rows.at(-1)?.createdAt}})); throw new Error('COLLATION_V4_SYNTHETIC_OUTBOX_GUARD_REJECTED'); }
    const ids = rows.map(row => row.id);
    const deleted = await client.query(`DELETE FROM "SearchIndexOutbox" WHERE "id" = ANY($1::bigint[]) RETURNING "id"::text`, [ids]);
    if (deleted.rowCount !== rows.length) throw new Error('COLLATION_V4_SYNTHETIC_OUTBOX_DELETE_COUNT_MISMATCH');
    const after = (await client.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NULL)::int AS pending,
             count(*) FILTER (WHERE "failedAt" IS NOT NULL)::int AS failed,
             max("id")::text AS max_id
        FROM "SearchIndexOutbox"
    `)).rows[0];
    if (after.total !== 217809 || after.pending !== 0 || after.failed !== 0 || after.max_id !== '217809') throw new Error('COLLATION_V4_OUTBOX_BASELINE_NOT_RESTORED');
    await client.query('COMMIT');
    inTransaction = false;
    const artifact = {
      capturedAt: new Date().toISOString(),
      identity,
      cleanupScope: { minId: minimumId.toString(), maxId: maximumId.toString(), rowCount: deleted.rowCount, operations, distinctSyntheticDocumentKeys: distinctKeys.length, keySetSha256: crypto.createHash('sha256').update([...distinctKeys].sort().join('\n')).digest('hex'), createdAtFrom: earliestFixture.toISOString(), createdAtTo: latestFixture.toISOString() },
      guards: { onlyCorpusUpsets: true, allPendingBeforeCleanup: true, allFailedAtNull: true, allLastErrorNull: true, allSourceDocumentsAlreadyDeleted: true, syntheticResidueAudit: 'users/workspaces/dependencies/folders/corpus_documents = 0', v4SyntheticDocumentHits: 0, v3Touched: false },
      outboxAfter: after,
      result: 'PASS_EXACT_SYNTHETIC_EVENT_CLEANUP',
    };
    const evidenceRoot = path.resolve(process.cwd(), '..', '_recovery-work', 'jurisprudencia-collation-v4-implement1');
    fs.writeFileSync(path.join(evidenceRoot, 'db-cleanup-after-acl-attempt.json'), JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ result: artifact.result, deletedRows: deleted.rowCount, outboxAfter: after, evidence: 'db-cleanup-after-acl-attempt.json' }, null, 2));
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'COLLATION_V4_DB_CLEANUP_FAILED'); process.exitCode = 1; });

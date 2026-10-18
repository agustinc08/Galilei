#!/usr/bin/env node
'use strict';

const { createHash } = require('node:crypto');
const { readFile, access, rm, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

const action = process.argv[2];
const documentId = process.env.BJC_INT1_ORPHAN_DOCUMENT_ID || '';
const allowedDocumentId = 'cmv8wyzhs001bb48vibvkk2nk';
const raw = process.env.DATABASE_URL || '';
const expected = {
  protocol: 'postgresql:',
  hostname: '127.0.0.1',
  port: '55432',
  database: 'buscador_juridico_civil_dev',
  role: 'bjc_dev',
};

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function main() {
  if (!['audit', 'cleanup'].includes(action) || documentId !== allowedDocumentId)
    throw new Error('INT1_ORPHAN_CLEANUP_SCOPE_REJECTED');
  const target = new URL(raw);
  if (
    target.protocol !== expected.protocol ||
    target.hostname !== expected.hostname ||
    target.port !== expected.port ||
    target.pathname !== `/${expected.database}` ||
    target.username !== expected.role
  )
    throw new Error('INT1_ORPHAN_CLEANUP_TARGET_REJECTED');

  const repoRoot = path.resolve(__dirname, '../../../..');
  const fixturePath = path.join(
    repoRoot,
    'JurisprudenciaN/back/src/corpus/fixtures/sprint154a1-image-only.pdf',
  );
  const fixtureSha = sha256(await readFile(fixturePath));
  const storageRoot = path.resolve(repoRoot, '_dev-corpus-storage-test');
  const client = new Client({ connectionString: raw });
  await client.connect();
  try {
    const identity = (
      await client.query(`
        SELECT current_database() AS database, current_user AS role,
               host(inet_server_addr()) AS address, inet_server_port() AS port
      `)
    ).rows[0];
    if (
      identity.database !== expected.database ||
      identity.role !== expected.role ||
      identity.address !== expected.hostname ||
      Number(identity.port) !== Number(expected.port)
    )
      throw new Error('INT1_ORPHAN_CLEANUP_LIVE_IDENTITY_REJECTED');

    const candidate = await client.query(
      `SELECT d.id, d.title, d.status, d."documentScope", d."createdAt",
              f."originalFilename", f."storageKey", f.sha256,
              (SELECT count(*)::int FROM "WorkspaceDocument" w WHERE w."documentId"=d.id) AS workspace_links,
              (SELECT count(*)::int FROM "CorpusDocumentLink" l WHERE l."documentId"=d.id) AS domain_links,
              (SELECT count(*)::int FROM "CorpusDocumentAssociation" a WHERE a."documentId"=d.id) AS association_links,
              (SELECT count(*)::int FROM "CorpusSearchToken" t WHERE t."documentId"=d.id) AS search_tokens,
              (SELECT count(*)::int FROM "CorpusOcrJob" j WHERE j."documentId"=d.id) AS ocr_jobs,
              (SELECT count(*)::int FROM "AccionLog" a WHERE a."datosAntes"->>'documentId'=d.id OR a."datosDespues"->>'documentId'=d.id) AS audit_rows,
              (SELECT count(*)::int FROM "CorpusIngestionRecord" i WHERE i."documentId"=d.id AND i."sourceSystemId"=s.id) AS upload_ingestions,
              s.code AS source_code
         FROM "CorpusDocument" d
         JOIN "CorpusDocumentFile" f ON f."documentId"=d.id
         JOIN "CorpusIngestionRecord" i ON i."documentId"=d.id
         JOIN "CorpusSourceSystem" s ON s.id=i."sourceSystemId"
        WHERE d.id=$1
        ORDER BY f.id, i.id`,
      [documentId],
    );
    if (!candidate.rowCount) throw new Error('INT1_ORPHAN_CANDIDATE_NOT_FOUND');
    const rows = candidate.rows;
    const row = rows[0];
    if (
      rows.length !== 1 ||
      row.title !== 'a & whoami' ||
      row.status !== 'OCR_REQUIRED' ||
      row.documentScope !== 'PRIVATE_WORKSPACE' ||
      row.originalFilename !== 'a & whoami.pdf' ||
      row.sha256 !== fixtureSha ||
      row.source_code !== 'WORKSPACE_UPLOAD' ||
      row.upload_ingestions !== 1 ||
      row.workspace_links !== 0 ||
      row.domain_links !== 0 ||
      row.association_links !== 0 ||
      row.search_tokens !== 0 ||
      row.ocr_jobs !== 0 ||
      row.audit_rows !== 0 ||
      !/^[a-f0-9]{2}\/[a-f0-9]{64}\.pdf$/u.test(row.storageKey)
    )
      throw new Error('INT1_ORPHAN_CANDIDATE_IDENTITY_OR_REFERENCES_MISMATCH');

    const filePath = path.resolve(storageRoot, row.storageKey);
    if (!filePath.startsWith(`${storageRoot}${path.sep}`))
      throw new Error('INT1_ORPHAN_STORAGE_PATH_REJECTED');
    let storageFile = 'ALREADY_ABSENT';
    try {
      await access(filePath);
      const content = await readFile(filePath);
      if (sha256(content) !== fixtureSha)
        throw new Error('INT1_ORPHAN_STORAGE_SHA_MISMATCH');
      storageFile = 'VERIFIED_FIXTURE_BLOB';
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const report = {
      status: action === 'audit' ? 'INT1_ORPHAN_PRIVATE_UPLOAD_AUDIT' : 'INT1_ORPHAN_PRIVATE_UPLOAD_CLEANUP',
      target: { endpoint: '127.0.0.1:55432', database: identity.database, role: identity.role },
      candidate: { ...row, createdAt: row.createdAt.toISOString(), fixtureSha, storageFile },
    };
    if (action === 'cleanup') {
      await client.query('BEGIN');
      try {
        const deleted = await client.query(
          `DELETE FROM "CorpusDocument" WHERE id=$1 AND title='a & whoami' AND status='OCR_REQUIRED' AND "documentScope"='PRIVATE_WORKSPACE'`,
          [documentId],
        );
        if (deleted.rowCount !== 1) throw new Error('INT1_ORPHAN_DELETE_COUNT_MISMATCH');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      const refs = await client.query(
        `SELECT count(*)::int AS count FROM "CorpusDocumentFile" WHERE "storageKey"=$1`,
        [row.storageKey],
      );
      if (Number(refs.rows[0].count) === 0 && storageFile === 'VERIFIED_FIXTURE_BLOB') {
        await rm(filePath, { force: true });
        report.candidate.storageFile = 'REMOVED_UNREFERENCED_FIXTURE_BLOB';
      } else if (Number(refs.rows[0].count) > 0) {
        report.candidate.storageFile = 'RETAINED_SHARED_BLOB';
      }
      const remaining = await client.query(
        `SELECT (SELECT count(*) FROM "CorpusDocument" WHERE id=$1)::int AS documents,
                (SELECT count(*) FROM "CorpusDocumentFile" WHERE "storageKey"=$2)::int AS file_references`,
        [documentId, row.storageKey],
      );
      report.residue = remaining.rows[0];
      if (remaining.rows[0].documents || remaining.rows[0].file_references !== Number(refs.rows[0].count))
        throw new Error('INT1_ORPHAN_RESIDUE_VERIFICATION_FAILED');
    }
    const reportDir = path.join(repoRoot, '_recovery-work/integration-int1r');
    await mkdir(reportDir, { recursive: true });
    await writeFile(
      path.join(reportDir, `orphan-private-upload-${action}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'INT1_ORPHAN_CLEANUP_FAILED');
  process.exitCode = 1;
});

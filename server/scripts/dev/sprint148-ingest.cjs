'use strict';

// Restartable, DEV-guarded importer for the already audited Sprint 14.8 safe set.
// Only local staged PDFs are read. No source URL is requested.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

require('ts-node/register');
const { PrismaService } = require('../../src/prisma/prisma.service');
const { CorpusIngestionService } = require('../../src/corpus/corpus-ingestion.service');
const { LocalDocumentStorageAdapter } = require('../../src/corpus/document-storage.adapter');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WORK = path.join(ROOT, '_recovery-work', 'sprint148');
const MANIFEST = path.join(WORK, 'manifest.sqlite');
const AUDIT = path.join(WORK, 'live-dry-run.json');
const BACKUP_MANIFEST = path.join(WORK, 'backup-before.json');
const JOURNAL_DIR = path.join(WORK, 'ingest-checkpoints');
const JOURNAL = path.join(JOURNAL_DIR, 'completed-legal-documents.ndjson');
const STORAGE_ROOT = path.resolve(ROOT, '_dev-corpus-storage');
const SOURCE_CODE = 'CIVIL_CUANTIFICACION_DANOS';
const SOURCE_NAME = 'Cuantificación de daños — fallos civiles';
const BATCH_SIZE = 250;
const expectedTarget = {
  host: '127.0.0.1', port: 55432,
  database: 'buscador_juridico_civil_dev', role: 'bjc_dev',
};

function atomicJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temp, file);
}

function stableSourceRecord(row) {
  return {
    sourceKey: row.source_key,
    quantificationId: row.quantification_id,
    externalId: row.external_id,
    caseNumberRaw: row.case_number,
    caseNumberNormalized: row.normalized_case_number,
    titleRaw: row.title,
    chamber: row.chamber,
    court: row.court,
    decisionDate: row.decision_date,
    detailUrl: row.detail_url,
    viewerUrl: row.viewer_url,
    documentUrl: row.document_url,
    localSourcePath: row.local_path,
    mime: row.mime,
    bytes: row.bytes,
    sha256: row.sha256,
    pages: row.page_count,
  };
}

function makeItem(row, group, content) {
  const externalId = row.external_id || row.source_key;
  const sourceReference = [
    'Cuantificación de daños',
    row.case_number ? `expediente ${row.case_number}` : null,
    row.chamber ? `Sala ${row.chamber}` : null,
    row.decision_date || null,
  ].filter(Boolean).join(' | ');
  const metadataOriginal = {
    acquisitionSprint: '14.8',
    manifestDatabase: 'manifest.sqlite',
    sourceRecord: stableSourceRecord(row),
    groupSourceRecords: group.map(stableSourceRecord),
  };
  return {
    filename: path.basename(row.local_path),
    sourcePath: row.local_path,
    externalId,
    externalUrl: row.document_url || row.viewer_url || row.detail_url || undefined,
    sourceReference,
    content,
    mimeType: 'application/pdf',
    title: row.title || `Expediente ${row.case_number || row.source_key}`,
    documentType: 'DOCUMENT',
    jurisdiction: 'ARGENTINA',
    court: row.court || undefined,
    chamber: row.chamber || undefined,
    caseNumber: row.case_number || undefined,
    decisionDate: row.decision_date ? new Date(`${row.decision_date}T00:00:00.000Z`) : undefined,
    visibility: 'INTERNAL',
    metadata: {
      acquisitionSprint: '14.8',
      sourceCode: SOURCE_CODE,
      legalDocumentKey: group[0].legal_document_key,
      sourceRecordCount: group.length,
      pdfSha256: String(row.sha256).toLowerCase(),
      pdfPagesInManifest: Number(row.page_count),
    },
    metadataOriginal,
  };
}

function readCheckpoint() {
  if (!fs.existsSync(JOURNAL)) return new Map();
  const entries = new Map();
  const content = fs.readFileSync(JOURNAL, 'utf8');
  const lines = content.split(/\r?\n/u);
  let validLines = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); }
    catch {
      // A process or host interruption may truncate only the final journal line.
      if (line === lines[lines.length - 1]) break;
      throw new Error('SPRINT148_CHECKPOINT_JOURNAL_CORRUPT');
    }
    validLines += 1;
    if (entry.status === 'COMPLETED') entries.set(entry.legalDocumentKey, entry);
  }
  if (validLines < lines.filter(line => line.trim()).length) {
    const valid = lines.slice(0, validLines).filter(line => line.trim()).join('\n');
    fs.writeFileSync(JOURNAL, valid ? `${valid}\n` : '', 'utf8');
  }
  return entries;
}

function appendCheckpoint(entry) {
  const fd = fs.openSync(JOURNAL, 'a');
  try {
    fs.writeSync(fd, `${JSON.stringify(entry)}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

function increment(out, key, amount = 1) { out[key] = (out[key] || 0) + amount; }

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error('SPRINT148_DATABASE_URL_MISSING');
  const url = new URL(rawUrl);
  if (url.protocol !== 'postgresql:' || url.hostname !== expectedTarget.host || Number(url.port) !== expectedTarget.port ||
      url.pathname !== `/${expectedTarget.database}` || url.username !== expectedTarget.role) {
    throw new Error('SPRINT148_DEV_TARGET_REJECTED');
  }
  if (path.resolve(process.env.BJC_CORPUS_STORAGE_PATH || STORAGE_ROOT) !== STORAGE_ROOT || STORAGE_ROOT.startsWith(WORK)) {
    throw new Error('SPRINT148_CORPUS_STORAGE_TARGET_REJECTED');
  }
  const audit = JSON.parse(fs.readFileSync(AUDIT, 'utf8'));
  if (audit.status !== 'SPRINT148_LIVE_DRY_RUN_PASS' || audit.target?.endpoint !== '127.0.0.1:55432' ||
      audit.target?.database !== expectedTarget.database || audit.target?.role !== expectedTarget.role || audit.dryRun?.wouldWrite !== false) {
    throw new Error('SPRINT148_LIVE_DRY_RUN_NOT_APPROVED');
  }
  const backup = JSON.parse(fs.readFileSync(BACKUP_MANIFEST, 'utf8'));
  const verifiedCustomBackup = backup.backups?.find(item => item.format === 'custom' && fs.existsSync(item.path) && fs.statSync(item.path).size === item.bytes);
  if (backup.status !== 'SPRINT123_FINAL_BACKUP_PASS' || backup.target?.endpoint !== '127.0.0.1:55432' ||
      backup.target?.database !== expectedTarget.database || backup.target?.role !== expectedTarget.role ||
      !verifiedCustomBackup || await sha256File(verifiedCustomBackup.path) !== verifiedCustomBackup.sha256) {
    throw new Error('SPRINT148_PREINGEST_BACKUP_NOT_VERIFIED');
  }

  fs.mkdirSync(JOURNAL_DIR, { recursive: true });
  const manifest = new DatabaseSync(MANIFEST, { readOnly: true });
  const records = manifest.prepare('SELECT * FROM source_records ORDER BY legal_document_key, source_key').all();
  const legalDocuments = JSON.parse(fs.readFileSync(AUDIT, 'utf8')).legalDocumentClassifications;
  if (records.length !== 5710 || legalDocuments.length !== 5208) throw new Error('SPRINT148_CHECKPOINT_COUNTS_REJECTED');
  const recordsByKey = new Map();
  for (const row of records) {
    if (!recordsByKey.has(row.legal_document_key)) recordsByKey.set(row.legal_document_key, []);
    recordsByKey.get(row.legal_document_key).push(row);
  }
  const safe = legalDocuments.filter(item => ['NEW_DOCUMENT', 'EXACT_FILE_MATCH'].includes(item.status));
  if (safe.length !== audit.dryRun.safeLegalDocuments || safe.reduce((sum, item) => sum + item.sourceRecords, 0) !== audit.dryRun.safeSourceRecords) {
    throw new Error('SPRINT148_SAFE_SET_MISMATCH');
  }
  for (const item of safe) {
    const rows = recordsByKey.get(item.legalDocumentKey) || [];
    if (rows.length !== item.sourceRecords || !rows.length || rows.some(row => row.pdf_valid !== 1 || !row.external_id || !row.local_path)) {
      throw new Error(`SPRINT148_SAFE_GROUP_INVALID:${item.legalDocumentKey}`);
    }
    if (item.status === 'NEW_DOCUMENT' && item.sha256.length !== 1) throw new Error(`SPRINT148_NEW_GROUP_MULTI_SHA:${item.legalDocumentKey}`);
  }

  const completed = readCheckpoint();
  const pending = safe.filter(item => !completed.has(item.legalDocumentKey));
  const prisma = new PrismaService();
  const storage = new LocalDocumentStorageAdapter(STORAGE_ROOT);
  const ingestion = new CorpusIngestionService(prisma, storage);
  const summary = {
    status: 'RUNNING', target: audit.target, sourceCode: SOURCE_CODE,
    batchSizeLegalDocuments: BATCH_SIZE, plannedLegalDocuments: safe.length,
    resumedCompletedLegalDocuments: completed.size,
    pendingLegalDocuments: pending.length,
    completedLegalDocuments: completed.size,
    newCorpusDocuments: [...completed.values()].filter(item => item.legalStatus === 'NEW_DOCUMENT').length,
    existingDocumentsLinked: [...completed.values()].filter(item => item.legalStatus === 'EXACT_FILE_MATCH').length,
    provenanceLinksProcessed: [...completed.values()].reduce((sum, item) => sum + Number(item.sourceRecords || 0), 0),
    extractionIndexed: 0, extractionOcrRequired: 0,
    extractionFailed: 0, extractionInvalid: 0, pagesAdded: 0, charactersAdded: 0,
    errors: [], batches: [], storageRoot: STORAGE_ROOT,
  };
  for (const item of completed.values()) {
    if (item.legalStatus !== 'NEW_DOCUMENT') continue;
    const extraction = item.outcomes?.[0] || {};
    if (extraction.status === 'INDEXED') summary.extractionIndexed += 1;
    else if (extraction.status === 'OCR_REQUIRED') summary.extractionOcrRequired += 1;
    else if (extraction.status === 'INVALID_PDF') summary.extractionInvalid += 1;
    else if (['FAILED', 'EXTRACTION_FAILED'].includes(extraction.status)) summary.extractionFailed += 1;
    summary.pagesAdded += Number(extraction.pageCount || 0);
    summary.charactersAdded += Number(extraction.characterCount || 0);
  }
  const batchCount = Math.ceil(pending.length / BATCH_SIZE);
  let batchIndex = fs.existsSync(JOURNAL_DIR)
    ? fs.readdirSync(JOURNAL_DIR).filter(name => /^batch-\d{3}\.json$/u.test(name)).length
    : 0;
  try {
    await prisma.$connect();
    const identity = (await prisma.$queryRawUnsafe(`
      SELECT current_database() AS database, current_user AS role,
             inet_server_addr()::text AS host, inet_server_port() AS port,
             current_setting('server_version_num')::int AS version_num
    `))[0];
    if (identity.database !== expectedTarget.database || String(identity.host || '').replace(/\/\d+$/u, '') !== expectedTarget.host || Number(identity.port) !== expectedTarget.port || identity.role !== expectedTarget.role || identity.version_num < 160000 || identity.version_num >= 170000) {
      throw new Error(`SPRINT148_LIVE_IDENTITY_REJECTED:${JSON.stringify(identity)}`);
    }
    const before = (await prisma.$queryRawUnsafe(`
      SELECT (SELECT count(*)::int FROM "CorpusDocument") AS documents,
             (SELECT count(*)::int FROM "CorpusDocumentFile") AS files,
             (SELECT count(*)::int FROM "CorpusIngestionRecord") AS ingestions,
             (SELECT count(*)::int FROM "CorpusExtraction") AS extractions,
             (SELECT count(*)::int FROM "CorpusDocumentPage") AS pages,
             (SELECT count(*)::int FROM "CorpusSearchTokenState") AS search_documents,
             (SELECT count(*)::int FROM "CorpusSearchToken") AS search_tokens
    `))[0];
    for (const key of ['corpusDocuments', 'corpusFiles', 'corpusIngestions', 'corpusExtractions', 'corpusPages', 'searchDocuments', 'searchTokens']) {
      const map = { corpusDocuments: 'documents', corpusFiles: 'files', corpusIngestions: 'ingestions', corpusExtractions: 'extractions', corpusPages: 'pages', searchDocuments: 'search_documents', searchTokens: 'search_tokens' };
      if (completed.size === 0 && Number(before[map[key]]) !== audit.before[key]) throw new Error(`SPRINT148_BEFORE_SNAPSHOT_DRIFT:${key}`);
      if (completed.size > 0 && Number(before[map[key]]) < audit.before[key]) throw new Error(`SPRINT148_RESUME_SNAPSHOT_REGRESSION:${key}`);
    }
    if (process.env.BJC_SPRINT148_INGEST_MODE === 'preflight') {
      console.log(JSON.stringify({
        status: 'SPRINT148_INGEST_PREFLIGHT_PASS', target: identity,
        backup: { path: verifiedCustomBackup.path, bytes: verifiedCustomBackup.bytes, sha256: verifiedCustomBackup.sha256 },
        safeLegalDocuments: safe.length, safeSourceRecords: audit.dryRun.safeSourceRecords,
        resumedCompletedLegalDocuments: completed.size, pendingLegalDocuments: pending.length,
        storageRoot: STORAGE_ROOT, before,
        wouldWrite: false,
      }, null, 2));
      return;
    }

    for (let start = 0; start < pending.length; start += BATCH_SIZE) {
      batchIndex += 1;
      const batchItems = pending.slice(start, start + BATCH_SIZE);
      const batch = {
        batch: completed.size ? `resume-${batchIndex}` : batchIndex,
        plannedLegalDocuments: batchItems.length, completedLegalDocuments: 0,
        newCorpusDocuments: 0, existingDocumentsLinked: 0,
        provenanceLinksProcessed: 0, indexed: 0, ocrRequired: 0,
        extractionFailed: 0, invalid: 0, pagesAdded: 0, charactersAdded: 0,
        errors: [],
      };
      const linksBefore = await prisma.corpusIngestionRecord.count();
      for (const legal of batchItems) {
        const group = recordsByKey.get(legal.legalDocumentKey);
        const groupShas = [...new Set(group.map(row => String(row.sha256).toLowerCase()))];
        const outcomes = [];
        try {
          for (const sha of groupShas) {
            const fileRows = group.filter(row => String(row.sha256).toLowerCase() === sha);
            const representative = fileRows[0];
            const content = fs.readFileSync(representative.local_path);
            const actualSha = crypto.createHash('sha256').update(content).digest('hex');
            if (actualSha !== sha || content.subarray(0, 5).toString('ascii') !== '%PDF-' || content.length !== Number(representative.bytes)) {
              throw new Error(`SPRINT148_STAGED_PDF_INTEGRITY_REJECTED:${sha}`);
            }
            const sourceIds = new Set();
            for (const row of fileRows) {
              const item = makeItem(row, group, content);
              if (sourceIds.has(item.externalId)) throw new Error(`SPRINT148_DUPLICATE_SOURCE_ID_IN_GROUP:${item.externalId}`);
              sourceIds.add(item.externalId);
              let outcome;
              if (legal.status === 'NEW_DOCUMENT' && outcomes.length === 0) {
                const hashFiles = await prisma.corpusDocumentFile.findMany({ where: { sha256: sha }, select: { id: true, documentId: true } });
                if (hashFiles.length) {
                  const documentIds = [...new Set(hashFiles.map(file => file.documentId))];
                  if (documentIds.length !== 1) throw new Error(`SPRINT148_RESUME_HASH_AMBIGUOUS:${sha}`);
                  const existing = await prisma.corpusDocument.findUnique({ where: { id: documentIds[0] }, select: { id: true, caseNumber: true, docket: true, court: true, chamber: true, decisionDate: true, status: true } });
                  if (!existing || existing.caseNumber !== row.case_number || existing.court !== row.court || existing.chamber !== row.chamber || new Date(existing.decisionDate).toISOString().slice(0, 10) !== row.decision_date) {
                    throw new Error(`SPRINT148_RESUME_HASH_LEGAL_IDENTITY_MISMATCH:${sha}`);
                  }
                  outcome = await ingestion.linkExisting(item, { sourceCode: SOURCE_CODE, sourceName: SOURCE_NAME, sourceType: 'INSTITUTIONAL' });
                  if (['STORED', 'FAILED', 'EXTRACTION_FAILED'].includes(existing.status)) {
                    try {
                      const retry = await ingestion.retryExtraction(existing.id);
                      outcome = { ...outcome, status: retry.status, extractionId: retry.extractionId, pageCount: retry.pageCount, characterCount: retry.characterCount };
                    } catch {
                      outcome = { ...outcome, status: 'EXTRACTION_FAILED' };
                    }
                  }
                }
                if (!outcome) {
                const sameKeyDocs = await prisma.corpusDocument.findMany({
                  where: { caseNumber: row.case_number, court: row.court, chamber: row.chamber, decisionDate: new Date(`${row.decision_date}T00:00:00.000Z`) },
                  select: { id: true },
                });
                if (sameKeyDocs.length) throw new Error(`SPRINT148_UNEXPECTED_EXISTING_LEGAL_KEY:${legal.legalDocumentKey}`);
                try {
                  outcome = await ingestion.ingestOne(item, { sourceCode: SOURCE_CODE, sourceName: SOURCE_NAME, sourceType: 'INSTITUTIONAL' });
                } catch (error) {
                  const prior = await prisma.corpusIngestionRecord.findFirst({ where: { sourceSystem: { code: SOURCE_CODE }, externalId: item.externalId, checksum: sha }, orderBy: { ingestedAt: 'desc' }, select: { id: true, documentId: true, status: true } });
                  if (!prior) throw error;
                  if (prior.status === 'STORED') {
                    try {
                      const retry = await ingestion.retryExtraction(prior.documentId);
                      outcome = { ingestionId: prior.id, documentId: prior.documentId, checksum: sha, reused: true, status: retry.status, extractionId: retry.extractionId, pageCount: retry.pageCount, characterCount: retry.characterCount };
                    } catch {
                      outcome = { ingestionId: prior.id, documentId: prior.documentId, checksum: sha, reused: true, status: 'EXTRACTION_FAILED' };
                    }
                  } else if (['FAILED', 'EXTRACTION_FAILED'].includes(prior.status)) {
                    outcome = { ingestionId: prior.id, documentId: prior.documentId, checksum: sha, reused: true, status: prior.status };
                  } else throw error;
                }
                }
              } else {
                outcome = await ingestion.linkExisting(item, { sourceCode: SOURCE_CODE, sourceName: SOURCE_NAME, sourceType: 'INSTITUTIONAL' });
              }
              outcomes.push(outcome);
            }
          }
          const linksAfterGroup = await prisma.corpusIngestionRecord.count({ where: { sourceSystem: { code: SOURCE_CODE }, externalId: { in: group.map(row => row.external_id || row.source_key) } } });
          if (linksAfterGroup !== group.length) throw new Error(`SPRINT148_PROVENANCE_COUNT_MISMATCH:${legal.legalDocumentKey}:${linksAfterGroup}/${group.length}`);
          if (legal.status === 'NEW_DOCUMENT') {
            batch.newCorpusDocuments += 1;
            summary.newCorpusDocuments += 1;
            const extraction = outcomes[0] || {};
            if (extraction.status === 'INDEXED') { batch.indexed += 1; summary.extractionIndexed += 1; }
            else if (extraction.status === 'OCR_REQUIRED') { batch.ocrRequired += 1; summary.extractionOcrRequired += 1; }
            else if (extraction.status === 'INVALID_PDF') { batch.invalid += 1; summary.extractionInvalid += 1; }
            else if (['FAILED', 'EXTRACTION_FAILED'].includes(extraction.status)) { batch.extractionFailed += 1; summary.extractionFailed += 1; }
            batch.pagesAdded += Number(extraction.pageCount || 0);
            summary.pagesAdded += Number(extraction.pageCount || 0);
            batch.charactersAdded += Number(extraction.characterCount || 0);
            summary.charactersAdded += Number(extraction.characterCount || 0);
          } else if (legal.status === 'EXACT_FILE_MATCH') {
            batch.existingDocumentsLinked += 1;
            summary.existingDocumentsLinked += 1;
          }
          batch.completedLegalDocuments += 1;
          summary.completedLegalDocuments += 1;
          summary.provenanceLinksProcessed += group.length;
          appendCheckpoint({ at: new Date().toISOString(), legalDocumentKey: legal.legalDocumentKey, status: 'COMPLETED', legalStatus: legal.status, sourceRecords: group.length, sha256: groupShas, outcomes: outcomes.map(item => ({ status: item.status, documentId: item.documentId, ingestionId: item.ingestionId, reused: item.reused, pageCount: item.pageCount, characterCount: item.characterCount })) });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          batch.errors.push({ legalDocumentKey: legal.legalDocumentKey, message });
          summary.errors.push({ batch: batch.batch, legalDocumentKey: legal.legalDocumentKey, message });
          atomicJson(path.join(JOURNAL_DIR, 'ingest-progress.json'), { ...summary, currentBatch: batch, stoppedAt: new Date().toISOString() });
          throw error;
        }
      }
      const linksAfter = await prisma.corpusIngestionRecord.count();
      batch.provenanceLinksCreated = Number(linksAfter) - Number(linksBefore);
      atomicJson(path.join(JOURNAL_DIR, `batch-${String(batchIndex).padStart(3, '0')}.json`), { ...batch, finishedAt: new Date().toISOString() });
      summary.batches.push({ ...batch, finishedAt: new Date().toISOString() });
      atomicJson(path.join(JOURNAL_DIR, 'ingest-progress.json'), { ...summary, status: 'RUNNING', updatedAt: new Date().toISOString() });
      console.log(`SPRINT148_BATCH=${batchIndex}/${batchCount}; completed=${batch.completedLegalDocuments}/${batch.plannedLegalDocuments}; new=${batch.newCorpusDocuments}; links=${batch.provenanceLinksCreated}; indexed=${batch.indexed}; OCR_REQUIRED=${batch.ocrRequired}; failed=${batch.extractionFailed}; invalid=${batch.invalid}`);
    }
    summary.status = summary.errors.length ? 'PARTIAL' : 'PASS';
    summary.finishedAt = new Date().toISOString();
    atomicJson(path.join(JOURNAL_DIR, 'ingest-final.json'), summary);
    atomicJson(path.join(JOURNAL_DIR, 'ingest-progress.json'), summary);
    console.log(JSON.stringify(summary, null, 2));
    if (summary.status !== 'PASS') process.exitCode = 1;
  } finally {
    manifest.close();
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'SPRINT148_INGEST_FAILED');
  process.exitCode = 1;
});

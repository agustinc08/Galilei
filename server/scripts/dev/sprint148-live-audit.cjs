'use strict';

// Read-only DEV preflight for the already reconciled Sprint 14.8 checkpoint.
// Invoke only through with-dev-db-guard.cjs sprint148-audit.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WORK = path.join(ROOT, '_recovery-work', 'sprint148');
const MANIFEST_DB = path.join(WORK, 'manifest.sqlite');
const OUT = path.join(WORK, 'live-dry-run.json');
const SAMPLES_OUT = path.join(WORK, 'live-quality-samples.json');
const QUALITY_HOLDS_PATH = path.join(WORK, 'quality-review-holds.json');
const rawUrl = process.env.DATABASE_URL;

function requireDevUrl() {
  if (!rawUrl) throw new Error('SPRINT148_DATABASE_URL_MISSING');
  const url = new URL(rawUrl);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' ||
      url.port !== '55432' || url.pathname !== '/buscador_juridico_civil_dev' ||
      url.username !== 'bjc_dev') throw new Error('SPRINT148_DEV_TARGET_REJECTED');
}

function normDocket(value) {
  const raw = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const match = raw.match(/(\d+)\s*[/-]\s*(\d{2,4})/);
  if (!match) return raw.replace(/[^A-Z0-9]/g, '') || '';
  const number = match[1].replace(/^0+(?=\d)/, '');
  const year = match[2].length === 2 ? match[2] : match[2].replace(/^0+(?=\d)/, '');
  return `${number}/${year}`;
}

function normText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function normCourt(value) { return normText(value).replace(/[^A-Z0-9]/g, ''); }
function normChamber(value) {
  const text = normText(value);
  const match = text.match(/(?:SALA\s*)?\b([A-M])\b/);
  return match ? match[1] : text.replace(/[^A-Z0-9]/g, '');
}
function dateOnly(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
function legalKey(caseNumber, court, chamber, date) {
  const docket = normDocket(caseNumber);
  const tribunal = normCourt(court);
  const room = normChamber(chamber);
  const day = dateOnly(date);
  return docket && tribunal && room && day ? `${docket}|${tribunal}|${room}|${day}` : '';
}
function diceSimilarity(a, b) {
  const stop = new Set(['C', 'S', 'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'OTRO', 'OTROS', 'OTRA', 'OTRAS']);
  const words = value => new Set(normText(value).split(' ').filter(word => word.length > 1 && !stop.has(word)));
  const left = words(a), right = words(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const word of left) if (right.has(word)) overlap++;
  return 2 * overlap / (left.size + right.size);
}
function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
function bump(map, key, amount = 1) { map[key] = (map[key] || 0) + amount; }
function stratifiedSample(items, size, bucketFor) {
  const buckets = new Map();
  for (const item of items) {
    const bucket = bucketFor(item);
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(item);
  }
  const keys = [...buckets.keys()].sort();
  const picked = [];
  while (picked.length < size) {
    let added = false;
    for (const key of keys) {
      const values = buckets.get(key);
      if (values.length) {
        picked.push(values.shift());
        added = true;
        if (picked.length === size) break;
      }
    }
    if (!added) break;
  }
  return picked;
}
function yearRoomSample(items, size) {
  const byYear = new Map();
  for (const item of items) {
    const year = String(item.decisionDate || '').slice(0, 4) || 'UNKNOWN';
    if (!byYear.has(year)) byYear.set(year, new Map());
    const rooms = byYear.get(year);
    const room = item.chamber || 'UNKNOWN';
    if (!rooms.has(room)) rooms.set(room, []);
    rooms.get(room).push(item);
  }
  const years = [...byYear.keys()].sort();
  const selected = [];
  while (selected.length < size) {
    let added = false;
    for (const year of years) {
      const rooms = byYear.get(year);
      const availableRooms = [...rooms.keys()].sort();
      const room = availableRooms.find(key => rooms.get(key).length);
      if (!room) continue;
      selected.push(rooms.get(room).shift());
      added = true;
      if (selected.length === size) break;
    }
    if (!added) break;
  }
  return selected;
}

async function main() {
  requireDevUrl();
  const db = new DatabaseSync(MANIFEST_DB, { readOnly: true });
  const client = new Client({ connectionString: rawUrl, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const identity = (await client.query(`
      SELECT current_database() AS database, current_user AS role,
             inet_server_addr()::text AS address, inet_server_port() AS port,
             current_setting('server_version_num')::integer AS version_num
    `)).rows[0];
    if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' ||
        String(identity.address || '').replace(/\/\d+$/, '') !== '127.0.0.1' ||
        Number(identity.port) !== 55432 || identity.version_num < 160000 || identity.version_num >= 170000) {
      throw new Error('SPRINT148_LIVE_IDENTITY_REJECTED');
    }

    const live = (await client.query(`
      SELECT
        (SELECT count(*)::int FROM "CorpusDocument") AS documents,
        (SELECT count(*)::int FROM "CorpusDocumentFile") AS files,
        (SELECT count(DISTINCT "sha256")::int FROM "CorpusDocumentFile") AS unique_file_hashes,
        (SELECT count(*)::int FROM "CorpusIngestionRecord") AS ingestions,
        (SELECT count(*)::int FROM "CorpusExtraction") AS extractions,
        (SELECT count(*)::int FROM "CorpusDocumentPage") AS pages,
        (SELECT count(*)::int FROM "CorpusSearchToken") AS search_tokens,
        (SELECT count(*)::int FROM "CorpusSearchTokenState") AS projection_documents,
        (SELECT count(*)::int FROM "CorpusDocument" d
          WHERE lower(coalesce(d."court",'')) LIKE '%civil%'
             OR lower(coalesce(d."chamber",'')) LIKE '%civil%') AS civil_documents,
        pg_database_size(current_database())::text AS database_bytes,
        (SELECT count(*)::int FROM "CorpusSearchTokenProjectionControl" WHERE "singleton"=true AND "isReady"=true) AS projection_ready
    `)).rows[0];

    const docs = (await client.query(`
      SELECT d."id", d."title", d."court", d."chamber", d."instance",
             d."caseNumber", d."docket", d."decisionDate", d."status"
        FROM "CorpusDocument" d
       WHERE lower(coalesce(d."court",'')) LIKE '%civil%'
          OR lower(coalesce(d."chamber",'')) LIKE '%civil%'
    `)).rows;
    const files = (await client.query(`
      SELECT f."id" AS file_id, f."sha256", f."documentId" AS document_id,
             d."caseNumber", d."docket", d."court", d."chamber", d."title", d."decisionDate"
        FROM "CorpusDocumentFile" f JOIN "CorpusDocument" d ON d."id"=f."documentId"
    `)).rows;

    const identityIndex = new Map();
    const docketRoomIndex = new Map();
    for (const doc of docs) {
      const key = legalKey(doc.caseNumber || doc.docket, doc.court, doc.chamber, doc.decisionDate);
      if (key) {
        if (!identityIndex.has(key)) identityIndex.set(key, []);
        identityIndex.get(key).push(doc);
      }
      const docket = normDocket(doc.caseNumber || doc.docket);
      const court = normCourt(doc.court);
      const room = normChamber(doc.chamber);
      if (docket && court && room) {
        const partial = `${docket}|${court}|${room}`;
        if (!docketRoomIndex.has(partial)) docketRoomIndex.set(partial, []);
        docketRoomIndex.get(partial).push(doc);
      }
    }
    const filesBySha = new Map();
    for (const file of files) {
      const hash = String(file.sha256 || '').toLowerCase();
      if (!filesBySha.has(hash)) filesBySha.set(hash, []);
      filesBySha.get(hash).push(file);
    }

    const records = db.prepare('SELECT * FROM source_records ORDER BY source_key').all();
    const legalDocs = db.prepare('SELECT * FROM legal_documents ORDER BY legal_document_key').all();
    const objects = db.prepare('SELECT * FROM objects').all();
    const qualityHolds = JSON.parse(fs.readFileSync(QUALITY_HOLDS_PATH, 'utf8'));
    if (!Array.isArray(qualityHolds) || qualityHolds.some(item =>
      !item || typeof item.legalDocumentKey !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(item.sourceDecisionDate || '') ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(item.pdfSignatureDate || '') ||
      item.sourceDecisionDate === item.pdfSignatureDate ||
      !/^[a-f0-9]{64}$/u.test(item.sampleSha256 || '') ||
      typeof item.reason !== 'string')) {
      throw new Error('SPRINT148_QUALITY_HOLDS_INVALID');
    }
    const qualityHoldByKey = new Map(qualityHolds.map(item => [item.legalDocumentKey, item]));
    const byKey = new Map();
    for (const row of records) {
      if (!row.legal_document_key) continue;
      if (!byKey.has(row.legal_document_key)) byKey.set(row.legal_document_key, []);
      byKey.get(row.legal_document_key).push(row);
    }
    if (records.length !== 5710 || legalDocs.length !== 5208 || byKey.size !== legalDocs.length) {
      throw new Error(`SPRINT148_CHECKPOINT_COUNTS_REJECTED:${records.length}/${legalDocs.length}/${byKey.size}`);
    }

    const sourceIds = [...new Set(records.map(row => row.external_id).filter(Boolean))];
    const sourceMatches = [];
    for (const batch of chunks(sourceIds, 400)) {
      sourceMatches.push(...(await client.query(`
        SELECT i."externalId" AS external_id, i."documentId" AS document_id,
               i."fileId" AS file_id, i."checksum", i."status"
          FROM "CorpusIngestionRecord" i
          JOIN "CorpusSourceSystem" s ON s."id"=i."sourceSystemId"
         WHERE s."code"='CIVIL_CUANTIFICACION_DANOS'
           AND i."externalId"=ANY($1::text[])
      `, [batch])).rows);
    }
    const sourceById = new Map();
    for (const row of sourceMatches) {
      if (!sourceById.has(row.external_id)) sourceById.set(row.external_id, []);
      sourceById.get(row.external_id).push(row);
    }

    const statusCounts = {};
    const docsByStatus = {};
    const causes = {};
    const full = [];
    for (const legal of legalDocs) {
      const group = byKey.get(legal.legal_document_key) || [];
      const shas = [...new Set(group.filter(row => row.pdf_valid === 1).map(row => String(row.sha256).toLowerCase()))];
      const fileHits = shas.flatMap(sha => filesBySha.get(sha) || []);
      const hitDocIds = new Set(fileHits.map(row => row.document_id));
      const keyDocs = identityIndex.get(legal.legal_document_key) || [];
      const sourceHits = group.flatMap(row => sourceById.get(row.external_id) || []);
      const sourceDocIds = new Set(sourceHits.map(row => row.document_id));
      const liveDocumentIdsForGroup = new Set([...hitDocIds, ...sourceDocIds, ...keyDocs.map(doc => doc.id)]);
      const provenanceLinksPending = group.reduce((pending, row) => {
        const existing = (sourceById.get(row.external_id) || []).some(source =>
          liveDocumentIdsForGroup.has(source.document_id) && String(source.checksum || '').toLowerCase() === String(row.sha256 || '').toLowerCase());
        return pending + (existing ? 0 : 1);
      }, 0);
      let status = 'NEW_DOCUMENT';
      let cause = 'NO_SHA_SOURCE_ID_OR_EXACT_LEGAL_KEY_MATCH';

      if (legal.valid_pdf !== 1 || group.some(row => row.pdf_valid !== 1)) {
        status = 'INVALID_FILE'; cause = 'INVALID_PDF_OBJECT';
      } else if (legal.identity_status === 'CONFLICT' || legal.sha_conflict === 1) {
        status = 'CONFLICT'; cause = legal.notes || 'INTERNAL_LEGAL_IDENTITY_CONFLICT';
      } else if (hitDocIds.size > 1 || sourceDocIds.size > 1 || keyDocs.length > 1) {
        status = 'CONFLICT'; cause = 'LIVE_SHA_SOURCE_OR_LEGAL_KEY_MATCHES_MULTIPLE_CORPUS_DOCUMENTS';
      } else if (hitDocIds.size === 1) {
        const hitDocId = [...hitDocIds][0];
        const matching = keyDocs.find(doc => doc.id === hitDocId);
        const fileDocs = fileHits.filter(file => file.document_id === hitDocId);
        const completeKeys = fileDocs.map(file => legalKey(file.caseNumber || file.docket, file.court, file.chamber, file.decisionDate)).filter(Boolean);
        const explicitDocketConflict = fileDocs.some(file => {
          const stored = normDocket(file.caseNumber || file.docket);
          return /\d\s*[/\-]\s*\d{2,4}/.test(String(file.caseNumber || file.docket || '')) && stored !== legal.normalized_case_number;
        });
        if ((completeKeys.some(key => key !== legal.legal_document_key) || explicitDocketConflict) && !matching) {
          status = 'CONFLICT'; cause = 'SHA_MATCHES_CORPUS_DOCUMENT_WITH_CONTRADICTORY_LEGAL_METADATA';
        } else if (shas.every(sha => (filesBySha.get(sha) || []).some(file => file.document_id === hitDocId))) {
          status = 'EXACT_FILE_MATCH'; cause = matching ? 'SHA_AND_LEGAL_IDENTITY_MATCH' : 'SHA_MATCHES_ONE_CORPUS_FILE_WITHOUT_CONTRADICTORY_COMPLETE_IDENTITY';
        } else {
          status = 'SAME_DOCUMENT_DIFFERENT_FILE'; cause = 'SAME_LEGAL_IDENTITY_WITH_ADDITIONAL_UNMATCHED_SHA';
        }
      } else if (sourceDocIds.size === 1) {
        const sourceDocId = [...sourceDocIds][0];
        if (keyDocs.some(doc => doc.id === sourceDocId)) {
          status = 'EXACT_DOCUMENT_MATCH'; cause = 'SOURCE_EXTERNAL_ID_AND_LEGAL_IDENTITY_MATCH';
        } else {
          status = 'CONFLICT'; cause = 'SOURCE_EXTERNAL_ID_POINTS_TO_DIFFERENT_LEGAL_IDENTITY';
        }
      } else if (keyDocs.length === 1) {
        status = shas.length > 1 ? 'SAME_DOCUMENT_DIFFERENT_FILE' : 'EXACT_DOCUMENT_MATCH';
        cause = shas.length > 1 ? 'EXACT_LEGAL_IDENTITY_MULTIPLE_OR_NEW_PDF_REPRESENTATIONS' : 'EXACT_LEGAL_IDENTITY_DIFFERENT_SHA';
      } else {
        const partial = `${legal.normalized_case_number}|${normCourt(legal.tribunal)}|${normChamber(legal.chamber)}`;
        const related = (docketRoomIndex.get(partial) || []).filter(doc => legalKey(doc.caseNumber || doc.docket, doc.court, doc.chamber, doc.decisionDate) !== legal.legal_document_key);
        const highTitle = related.map(doc => ({ doc, similarity: diceSimilarity(legal.normalized_title, doc.title) }))
          .filter(item => item.similarity >= 0.8);
        if (highTitle.length) {
          status = 'CONFLICT'; cause = 'SAME_DOCKET_COURT_CHAMBER_DIFFERENT_DATE_AND_SIMILAR_TITLE';
        } else if (legal.identity_status === 'CANDIDATE' || legal.identity_status === 'HIGH_CONFIDENCE') {
          status = legal.identity_status; cause = 'OFFLINE_CORPUS_CANDIDATE_REMAINS_UNCONFIRMED';
        } else if (legal.identity_status === 'SAME_DOCUMENT_DIFFERENT_FILE') {
          status = 'SAME_DOCUMENT_DIFFERENT_FILE'; cause = legal.notes || 'INTERNAL_MULTIPLE_PDF_REPRESENTATIONS';
        } else if (!legal.normalized_case_number || !legal.tribunal || !legal.chamber || !legal.decision_date) {
          status = 'INSUFFICIENT_METADATA'; cause = 'LEGAL_IDENTITY_INCOMPLETE';
        }
      }
      const qualityHold = qualityHoldByKey.get(legal.legal_document_key);
      if (qualityHold) {
        const groupShas = new Set(shas);
        if (!groupShas.has(qualityHold.sampleSha256) || dateOnly(legal.decision_date) !== qualityHold.sourceDecisionDate) {
          throw new Error(`SPRINT148_QUALITY_HOLD_EVIDENCE_MISMATCH:${legal.legal_document_key}`);
        }
        status = 'CONFLICT';
        cause = 'SAMPLED_PDF_SIGNATURE_DATE_CONTRADICTS_SOURCE_METADATA_REVIEW_REQUIRED';
      }
      bump(statusCounts, status);
      bump(docsByStatus, status, group.length);
      bump(causes, cause);
      full.push({
        legalDocumentKey: legal.legal_document_key,
        sourceRecords: group.length,
        caseNumber: group[0]?.case_number,
        court: group[0]?.court,
        chamber: group[0]?.chamber,
        decisionDate: group[0]?.decision_date,
        title: group[0]?.title,
        sha256: shas,
        bytes: [...new Set(group.map(row => row.bytes))],
        pages: [...new Set(group.map(row => row.page_count))],
        status,
        cause,
        provenanceLinksPending,
        qualityReview: qualityHold ? {
          sourceDecisionDate: qualityHold.sourceDecisionDate,
          pdfSignatureDate: qualityHold.pdfSignatureDate,
          sampleSha256: qualityHold.sampleSha256,
          reason: qualityHold.reason,
        } : undefined,
        corpusDocumentIds: [...new Set([...hitDocIds, ...sourceDocIds, ...keyDocs.map(doc => doc.id)])],
        liveMatches: [...new Map([...fileHits, ...keyDocs].map(doc => [doc.id || doc.document_id, {
          documentId: doc.id || doc.document_id,
          title: doc.title,
          caseNumber: doc.caseNumber || doc.docket,
          court: doc.court,
          chamber: doc.chamber,
          decisionDate: dateOnly(doc.decisionDate),
          matchedSha: fileHits.filter(file => file.document_id === (doc.id || doc.document_id)).map(file => file.sha256),
        }])).values()],
      });
    }

    const sumLegalStatuses = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
    if (sumLegalStatuses !== legalDocs.length) throw new Error(`SPRINT148_STATUS_SUM_REJECTED:${sumLegalStatuses}`);
    const safe = full.filter(item => ['NEW_DOCUMENT', 'EXACT_FILE_MATCH'].includes(item.status));
    const safeSourceRecords = safe.reduce((sum, item) => sum + item.sourceRecords, 0);
    const safeProvenancePending = safe.reduce((sum, item) => sum + item.provenanceLinksPending, 0);
    const safeNew = full.filter(item => item.status === 'NEW_DOCUMENT');
    const newHashes = new Set(safeNew.flatMap(item => item.sha256));
    const liveHashSet = new Set(files.map(row => String(row.sha256).toLowerCase()));
    const newBlobs = [...newHashes].filter(sha => !liveHashSet.has(sha)).length;
    const report = {
      generatedAt: new Date().toISOString(),
      status: 'SPRINT148_LIVE_DRY_RUN_PASS',
      target: { endpoint: '127.0.0.1:55432', database: identity.database, role: identity.role, postgresVersionNum: identity.version_num },
      input: {
        sourceRecords: records.length,
        physicalPdfs: objects.length,
        uniqueSha: objects.length,
        validPdfs: objects.filter(row => row.pdf_valid === 1).length,
        invalidPdfs: objects.filter(row => row.pdf_valid !== 1).length,
        bytes: objects.reduce((sum, row) => sum + Number(row.bytes || 0), 0),
        pages: objects.reduce((sum, row) => sum + Number(row.page_count || 0), 0),
        offlineLegalKeys: legalDocs.length,
      },
      before: {
        corpusDocuments: Number(live.documents),
        corpusCivilDocuments: Number(live.civil_documents),
        corpusFiles: Number(live.files),
        corpusUniqueFileHashes: Number(live.unique_file_hashes),
        corpusIngestions: Number(live.ingestions),
        corpusExtractions: Number(live.extractions),
        corpusPages: Number(live.pages),
        searchDocuments: Number(live.projection_documents),
        searchTokens: Number(live.search_tokens),
        searchReady: live.projection_ready === 1,
        databaseBytes: Number(live.database_bytes),
        civilChamber: docs.filter(doc => {
          const label = normText(`${doc.court || ''} ${doc.chamber || ''}`);
          return /CAMARA NACIONAL DE APELACIONES EN LO CIVIL/.test(label) && !/CIVIL Y COMERCIAL FEDERAL/.test(label);
        }).length,
        civilFirstInstance: docs.filter(doc => /JUZGADO.*\bCIVIL\b/i.test(normText(`${doc.court || ''} ${doc.chamber || ''}`))).length,
      },
      classification: { legalDocuments: statusCounts, sourceRecordsByLegalDocumentStatus: docsByStatus, causes },
      qualityReviewHolds: full.filter(item => item.qualityReview).map(item => ({
        legalDocumentKey: item.legalDocumentKey,
        sourceRecords: item.sourceRecords,
        ...item.qualityReview,
      })),
      dryRun: {
        safeLegalDocuments: safe.length,
        safeSourceRecords: safeSourceRecords,
        newCorpusDocuments: safeNew.length,
        existingLegalDocumentsLinked: full.filter(item => item.status === 'EXACT_FILE_MATCH').length,
        newCorpusDocumentFiles: newBlobs,
        reusedCorpusFiles: safe.reduce((sum, item) => sum + item.sha256.filter(sha => liveHashSet.has(sha)).length, 0),
        newStorageBlobs: newBlobs,
        reusedStorageBlobs: [...new Set(safe.flatMap(item => item.sha256))].filter(sha => liveHashSet.has(sha)).length,
        provenanceLinksAlreadyPresent: safeSourceRecords - safeProvenancePending,
        newProvenanceLinks: safeProvenancePending,
        reviewRequiredLegalDocuments: full.length - safe.length,
        estimatedExtractionJobs: newBlobs,
        errors: 0,
        statusSum: sumLegalStatuses,
        wouldWrite: false,
      },
      legalDocumentClassifications: full,
      qaSamples: {
        NEW_DOCUMENT: yearRoomSample(full.filter(item => item.status === 'NEW_DOCUMENT'), 20),
        EXACT_FILE_MATCH: yearRoomSample(full.filter(item => item.status === 'EXACT_FILE_MATCH'), 20),
        EXACT_DOCUMENT_MATCH: full.filter(item => item.status === 'EXACT_DOCUMENT_MATCH'),
        SAME_DOCUMENT_DIFFERENT_FILE: full.filter(item => item.status === 'SAME_DOCUMENT_DIFFERENT_FILE'),
        HIGH_CONFIDENCE: full.filter(item => item.status === 'HIGH_CONFIDENCE').slice(0, 20),
        CANDIDATE: yearRoomSample(full.filter(item => item.status === 'CANDIDATE'), 20),
        CONFLICT: stratifiedSample(full.filter(item => item.status === 'CONFLICT'), 20, item => item.cause),
        INVALID_FILE: full.filter(item => item.status === 'INVALID_FILE'),
        INSUFFICIENT_METADATA: full.filter(item => item.status === 'INSUFFICIENT_METADATA').slice(0, 20),
      },
    };
    await client.query('ROLLBACK');
    fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(SAMPLES_OUT, `${JSON.stringify(report.qaSamples, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      status: report.status,
      target: report.target,
      input: report.input,
      before: report.before,
      classification: report.classification,
      dryRun: report.dryRun,
      reportPath: OUT,
      qualitySamplesPath: SAMPLES_OUT,
    }, null, 2));
  } finally {
    await client.end().catch(() => undefined);
    db.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'SPRINT148_LIVE_AUDIT_FAILED');
  process.exitCode = 1;
});

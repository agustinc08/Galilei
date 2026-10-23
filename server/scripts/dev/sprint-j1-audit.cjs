'use strict';

// Read-only J1 audit for the existing local DEV corpus and Sprint 14.8 review manifest.
// Invoke through with-dev-db-guard.cjs sprint-j1-audit.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WORK = path.join(ROOT, '_recovery-work', 'jurisprudencia-j1');
const rawUrl = process.env.DATABASE_URL;
const DISCOVERY = path.join(ROOT, '_recovery-work', 'jurisprudencia-discovery');
const SPRINT148 = path.join(ROOT, '_recovery-work', 'sprint148');
let OUTPUT = WORK;

function assertTarget() {
  const url = new URL(rawUrl);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' ||
      url.pathname !== '/buscador_juridico_civil_dev' || url.username !== 'bjc_dev') {
    throw new Error('J1_DEV_URL_REJECTED');
  }
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(name, value) { fs.writeFileSync(path.join(OUTPUT, name), `${JSON.stringify(value, null, 2)}\n`); }
function norm(value) {
  return String(value || '').normalize('NFC').toLocaleLowerCase('es-AR').replace(/\s+/g, ' ').trim();
}
function flatten(value, prefix = '', out = []) {
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  } else if (value != null) out.push({ key: prefix, value: String(value) });
  return out;
}
function add(map, key, n = 1) { map[key] = (map[key] || 0) + n; }
function csv(value) { return `"${String(value ?? '').replace(/"/gu, '""')}"`; }
function groupRows(rows, keyFor, fields) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (!map.has(key)) map.set(key, { key, count: 0, ...Object.fromEntries(fields.map(f => [f, row[f] ?? null])) });
    map.get(key).count++;
  }
  return [...map.values()].sort((a, b) => String(a.key).localeCompare(String(b.key), 'en'));
}

async function main() {
  assertTarget();
  fs.mkdirSync(WORK, { recursive: true });
  OUTPUT = fs.existsSync(path.join(WORK, 'final-summary.json'))
    ? path.join(WORK, 'runs', new Date().toISOString().replace(/[:.]/gu, '-')) : WORK;
  fs.mkdirSync(OUTPUT, { recursive: true });
  const manifestPath = path.join(SPRINT148, 'manifest.sqlite');
  const livePath = path.join(SPRINT148, 'live-dry-run.json');
  const db = new DatabaseSync(manifestPath, { readOnly: true });
  const client = new Client({ connectionString: rawUrl, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const identity = (await client.query(`SELECT current_database() database,current_user role,
      inet_server_addr()::text address,inet_server_port() port,
      current_setting('server_version_num')::int version_num`)).rows[0];
    if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' ||
        String(identity.address || '').replace(/\/\d+$/, '') !== '127.0.0.1' || Number(identity.port) !== 55432 ||
        identity.version_num < 160000 || identity.version_num >= 170000) throw new Error('J1_LIVE_IDENTITY_REJECTED');

    const baseline = (await client.query(`SELECT
      (SELECT count(*)::int FROM "CorpusDocument") total,
      (SELECT count(*)::int FROM "CorpusDocument" WHERE lower(coalesce("court",'')) LIKE '%civil%' OR lower(coalesce("chamber",'')) LIKE '%civil%') civil,
      (SELECT count(*)::int FROM "CorpusDocument" WHERE lower(coalesce("court",'')) LIKE '%civil%' AND "instance"='SECOND_INSTANCE') second_instance,
      (SELECT count(*)::int FROM "CorpusDocument" WHERE lower(coalesce("court",'')) LIKE '%civil%' AND "instance"='FIRST_INSTANCE') first_instance,
      (SELECT count(*)::int FROM "CorpusDocument" WHERE (lower(coalesce("court",'')) LIKE '%civil%' OR lower(coalesce("chamber",'')) LIKE '%civil%') AND "instance" IS NULL) missing_instance,
      (SELECT count(*)::int FROM "CorpusSearchTokenState") search_documents,
      (SELECT count(*)::int FROM "CorpusSearchToken") search_tokens,
      (SELECT count(*)::int FROM "CorpusSearchTokenProjectionControl" WHERE singleton=true AND "isReady"=true) search_ready`)).rows[0];

    const missing = (await client.query(`SELECT d."id",d."title",d."court",d."chamber",d."instance",
      d."caseNumber",d."docket",d."decisionDate",d."status",d."metadata",d."metadataOriginal",
      s."code" source_code,i."externalId" external_id,i."sourceReference" source_reference,
      i."metadataOriginal" ingestion_metadata
      FROM "CorpusDocument" d
      LEFT JOIN LATERAL (SELECT i."sourceSystemId",i."externalId",i."sourceReference",i."metadataOriginal"
        FROM "CorpusIngestionRecord" i WHERE i."documentId"=d."id" ORDER BY i."createdAt" LIMIT 1) i ON true
      LEFT JOIN "CorpusSourceSystem" s ON s."id"=i."sourceSystemId"
      WHERE (lower(coalesce(d."court",'')) LIKE '%civil%' OR lower(coalesce(d."chamber",'')) LIKE '%civil%')
        AND d."instance" IS NULL ORDER BY d."court",d."chamber",d."decisionDate",d."id"`)).rows;
    const counts = (await client.query(`SELECT coalesce(d."court",'(null)') court,
      coalesce(d."chamber",'(null)') chamber,coalesce(s."code",'(no source)') source_code,count(*)::int count
      FROM "CorpusDocument" d LEFT JOIN LATERAL (SELECT i."sourceSystemId" FROM "CorpusIngestionRecord" i
        WHERE i."documentId"=d."id" ORDER BY i."createdAt" LIMIT 1) i ON true
      LEFT JOIN "CorpusSourceSystem" s ON s."id"=i."sourceSystemId"
      WHERE (lower(coalesce(d."court",'')) LIKE '%civil%' OR lower(coalesce(d."chamber",'')) LIKE '%civil%')
        AND d."instance" IS NULL GROUP BY 1,2,3 ORDER BY 1,2,3`)).rows;

    const coverage = readJson(path.join(DISCOVERY, 'coverage.json'));
    const gap = readJson(path.join(DISCOVERY, 'gap-matrix.json'));
    const live = readJson(livePath);
    if (!Array.isArray(live.legalDocumentClassifications) || live.classification.legalDocuments.EXACT_DOCUMENT_MATCH !== 2) {
      throw new Error('J1_SPRINT148_INPUT_INVALID');
    }
    const manifest = new DatabaseSync(manifestPath, { readOnly: true });
    const sourceRows = manifest.prepare('SELECT * FROM source_records ORDER BY source_key').all();
    const legalRows = manifest.prepare('SELECT * FROM legal_documents ORDER BY legal_document_key').all();
    const sourceByLegal = new Map();
    for (const row of sourceRows) {
      if (!sourceByLegal.has(row.legal_document_key)) sourceByLegal.set(row.legal_document_key, []);
      sourceByLegal.get(row.legal_document_key).push(row);
    }
    const liveByKey = new Map(live.legalDocumentClassifications.map(item => [item.legalDocumentKey, item]));
    const held = live.legalDocumentClassifications.filter(item => item.status !== 'EXACT_FILE_MATCH');
    const exactGroups = live.legalDocumentClassifications.filter(item => item.status === 'EXACT_DOCUMENT_MATCH');
    const sentenceMatches = [];
    for (const item of exactGroups) {
      const digits = String(item.caseNumber).replace(/\D/gu, '');
      const rows = (await client.query(`SELECT id, "legacyId", expediente, fecha, sala, "tribunalOrigen", caratula
        FROM "Sentencia" WHERE regexp_replace(coalesce(expediente,''),'[^0-9]','','g')=$1
          AND fecha::date=$2::date ORDER BY id`, [digits, item.decisionDate])).rows;
      sentenceMatches.push({ legalDocumentKey: item.legalDocumentKey, sourceCaseNumber: item.caseNumber,
        sourceChamber: item.chamber, decisionDate: item.decisionDate, corpusDocumentIds: item.corpusDocumentIds,
        candidates: rows.filter(row => norm(row.sala).replace(/^sala\s*/, '') === norm(item.chamber).replace(/^sala\s*/, '')),
        nonMatchingRoomCandidates: rows.filter(row => norm(row.sala).replace(/^sala\s*/, '') !== norm(item.chamber).replace(/^sala\s*/, '')) });
    }
    const invalidObjects = manifest.prepare(`SELECT sha256,local_path,bytes,actual_sha256,pdf_valid,page_count,parser_error
      FROM objects WHERE pdf_valid<>1 OR pdf_valid IS NULL ORDER BY sha256`).all();
    const reviewInput = held.map(item => ({ ...item, sourceEvidence: sourceByLegal.get(item.legalDocumentKey) || [] }));

    const conflictCauses = { combinations: {}, atomicOccurrences: {} };
    const reviewClassification = [];
    for (const item of held) {
      if (item.status === 'CONFLICT') {
        add(conflictCauses.combinations, item.cause);
        for (const cause of item.cause.split(';')) add(conflictCauses.atomicOccurrences, cause);
      }
      let classification = 'HUMAN_REVIEW';
      let confidence = item.status === 'EXACT_DOCUMENT_MATCH' ? 'HIGH_LEGAL_IDENTITY' :
        item.status === 'CANDIDATE' ? 'MEDIUM' : item.status === 'INVALID_FILE' ? 'REJECT' :
          item.status === 'SAME_DOCUMENT_DIFFERENT_FILE' ? 'CONFLICT_DIFFERENT_FILE' : 'CONFLICT';
      let rationale = item.status === 'SAME_DOCUMENT_DIFFERENT_FILE'
        ? 'Legal key has more than one valid SHA; preserve both file identities and do not replace or deduplicate automatically.' : item.cause;
      if (item.status === 'EXACT_DOCUMENT_MATCH' && item.liveMatches.length === 1 &&
          norm(item.caseNumber) === norm(item.liveMatches[0].caseNumber) &&
          item.decisionDate === item.liveMatches[0].decisionDate &&
          norm(item.court) === norm(item.liveMatches[0].court) &&
          norm(item.chamber).replace(/^sala\s*/, '') === norm(item.liveMatches[0].chamber).replace(/^sala\s*/, '')) {
        confidence = 'HIGH_LEGAL_IDENTITY'; classification = 'HUMAN_REVIEW';
        rationale = 'Exact docket + court + chamber + decision date; title is corroborative. SHA differs and no supported source-record association target exists, so the legal identity is recorded but no DB link or file merge is proposed.';
      }
      reviewClassification.push({ legalDocumentKey: item.legalDocumentKey, sourceRecords: item.sourceRecords,
        caseNumber: item.caseNumber, court: item.court, chamber: item.chamber, decisionDate: item.decisionDate,
        title: item.title, status: item.status, confidence, classification, cause: item.cause, rationale,
        matchedDocuments: item.liveMatches, sha256: item.sha256 });
    }

    const instanceClassified = [];
    const instanceCounts = { SECOND_INSTANCE: 0, FIRST_INSTANCE: 0, UNKNOWN: 0 };
    const courtName = 'cámara nacional de apelaciones en lo civil';
    for (const row of missing) {
      const courtNorm = norm(row.court);
      const chamberNorm = norm(row.chamber);
      const original = [...flatten(row.metadataOriginal), ...flatten(row.ingestion_metadata)];
      let inferred = 'UNKNOWN', rule = 'NO_DETERMINISTIC_COURT_EVIDENCE';
      if (courtNorm === courtName && /^[a-m]$/.test(chamberNorm.replace(/^sala\s*/, ''))) {
        inferred = 'SECOND_INSTANCE'; rule = 'EXACT_CORPUS_COURT_NAME_AND_EXPLICIT_CIVIL_CHAMBER';
      } else if (/^juzgado nacional de primera instancia en lo civil(?: n(?:ro|º|°)?\s*\d+)?$/u.test(courtNorm)) {
        inferred = 'FIRST_INSTANCE'; rule = 'EXACT_CORPUS_FIRST_INSTANCE_COURT_NAME';
      }
      instanceCounts[inferred]++;
      instanceClassified.push({ documentId: row.id, caseNumber: row.caseNumber, docket: row.docket,
        title: row.title, court: row.court, chamber: row.chamber, currentInstance: row.instance,
        inferredInstance: inferred, rule, sourceCode: row.source_code, externalId: row.external_id,
        sourceReference: row.source_reference, decisionDate: row.decisionDate,
        originalCourtEvidence: original.filter(x => /court|tribunal|organ|juzgado|sala|chamber|instance/i.test(x.key)) });
    }

    const byYear = coverage.byYear || [];
    const byChamber = coverage.byChamber || [];
    writeJson('review-input.json', { generatedAt: new Date().toISOString(), sourceRecords: sourceRows.length,
      heldLegalGroups: held.length, groups: reviewInput });
    writeJson('review-classification.json', { generatedAt: new Date().toISOString(), groups: reviewClassification });
    writeJson('match-evidence.json', { generatedAt: new Date().toISOString(), groups: held.map(x => ({
      legalDocumentKey: x.legalDocumentKey, status: x.status, cause: x.cause, sha256: x.sha256,
      liveMatches: x.liveMatches, sourceRecords: sourceByLegal.get(x.legalDocumentKey) || [] })) });
    writeJson('conflict-causes.json', { groupCount: live.classification.legalDocuments.CONFLICT, ...conflictCauses });
    writeJson('exact-resolutions.json', { total: 2, reviewed: live.legalDocumentClassifications.filter(x => x.status === 'EXACT_DOCUMENT_MATCH'),
      proposed: reviewClassification.filter(x => x.status === 'EXACT_DOCUMENT_MATCH'), sentenceMatches });
    writeJson('candidate-resolutions.json', { total: live.classification.legalDocuments.CANDIDATE,
      groups: reviewClassification.filter(x => x.status === 'CANDIDATE') });
    const reviewHeader = ['groupId','legalDocumentKey','caseNumber','year','chamber','court','decisionDate','title',
      'sourceRecords','sha256','corpusDocumentIds','status','confidence','classification','cause','rationale'];
    const reviewLines = [reviewHeader.map(csv).join(',')];
    for (const item of reviewClassification.filter(x => x.classification === 'HUMAN_REVIEW')) {
      reviewLines.push([item.legalDocumentKey,item.legalDocumentKey,item.caseNumber,String(item.decisionDate || '').slice(0,4),
        item.chamber,item.court,item.decisionDate,item.title,item.sourceRecords,item.sha256.join(';'),
        item.matchedDocuments.map(doc => doc.documentId).join(';'),item.status,item.confidence,item.classification,item.cause,item.rationale]
        .map(csv).join(','));
    }
    fs.writeFileSync(path.join(OUTPUT, 'human-review.csv'), `${reviewLines.join('\r\n')}\r\n`, 'utf8');
    writeJson('instance-classification.json', { generatedAt: new Date().toISOString(), beforeMissing: missing.length,
      counts: instanceCounts, byCourtChamberSource: counts, records: instanceClassified });
    writeJson('coverage-before.json', { generatedAt: new Date().toISOString(), scope: coverage.scopeNote,
      discoveryCoverage: coverage, gapMatrix: gap, instance: { missing: missing.length, counts: instanceCounts },
      corpus: baseline, heldQueue: live.classification.legalDocuments });
    writeJson('invalid-pdf-review.json', { count: invalidObjects.length, objects: invalidObjects.map(object => {
      const contents = fs.readFileSync(object.local_path);
      const signature = contents.subarray(0, 8).toString('latin1');
      const eof = contents.subarray(-2048).includes(Buffer.from('%%EOF'));
      return { ...object, signature: signature.startsWith('%PDF-'), hasEofMarker: eof,
        classification: !object.bytes || Number(object.bytes) === 0 ? 'EMPTY' :
          signature.startsWith('%PDF-') && !eof && object.parser_error === 'Invalid PDF structure.' ? 'CORRUPT' :
            signature.startsWith('<!DOCTYPE') || signature.startsWith('<html') ? 'HTML_AS_PDF' : 'OTHER' };
    }) });
    writeJson('coverage-after.json', { generatedAt: new Date().toISOString(), scope: coverage.scopeNote,
      note: 'Dry-run projection only; DB has not been modified.', corpus: { ...baseline,
        missing_instance: missing.length - instanceCounts.SECOND_INSTANCE - instanceCounts.FIRST_INSTANCE },
      proposedInstanceUpdates: instanceCounts.SECOND_INSTANCE + instanceCounts.FIRST_INSTANCE,
      reviewQueue: { before: live.classification.legalDocuments,
        autoResolvable: reviewClassification.filter(x => x.classification === 'AUTO_RESOLVABLE').length,
        remaining: held.length - reviewClassification.filter(x => x.classification === 'AUTO_RESOLVABLE').length } });
    writeJson('db-write-plan.json', { status: 'DRY_RUN_ONLY', target: { address: identity.address, port: identity.port,
      database: identity.database, role: identity.role, version: identity.version_num }, writes: [],
      proposed: { instanceUpdates: instanceClassified.filter(x => x.inferredInstance !== 'UNKNOWN'),
        exactResolutions: reviewClassification.filter(x => x.classification === 'AUTO_RESOLVABLE'),
        exactLegalIdentityNeedsSupportedAssociation: reviewClassification.filter(x => x.status === 'EXACT_DOCUMENT_MATCH') },
      note: 'No writes approved by this audit. Verify instance provenance and legal link contract, then produce a separately guarded plan and backup before mutation.' });
    const summary = { generatedAt: new Date().toISOString(), status: 'J1_READ_ONLY_AUDIT_PASS', target: identity,
      corpus: baseline, reviewQueue: live.classification.legalDocuments,
      conflictCauseOccurrences: conflictCauses.atomicOccurrences,
      conflictCauseCombinations: conflictCauses.combinations,
      exactMatches: reviewClassification.filter(x => x.status === 'EXACT_DOCUMENT_MATCH'),
      candidates: { count: live.classification.legalDocuments.CANDIDATE,
        byDecision: reviewClassification.filter(x => x.status === 'CANDIDATE').reduce((a, x) => (add(a, x.classification), a), {}) },
      instance: { beforeMissing: missing.length, counts: instanceCounts, courtChamberSourceGroups: counts.length },
      coverageScope: coverage.scopeNote, artifacts: OUTPUT };
    writeJson('final-summary.json', summary);
    await client.query('COMMIT');
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
    db.close();
  }
}

main().catch(error => { console.error(`J1_AUDIT_FAILED: ${error.message}`); process.exitCode = 1; });

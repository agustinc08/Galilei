'use strict';

// Finalizes local J1 review exports from the immutable Sprint 14.8 manifest and the
// guarded live dry-run. It does not connect to a database or modify corpus data.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const WORK = path.join(ROOT, '_recovery-work', 'jurisprudencia-j1');
const SOURCE = path.join(ROOT, '_recovery-work', 'sprint148');
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(path.join(WORK, file), `${JSON.stringify(value, null, 2)}\n`); }
function csv(value) { return `"${String(value ?? '').replace(/"/gu, '""')}"`; }
function increment(map, key) { map[key] = (map[key] || 0) + 1; }

function main() {
  const db = new DatabaseSync(path.join(SOURCE, 'manifest.sqlite'), { readOnly: true });
  const live = readJson(path.join(SOURCE, 'live-dry-run.json'));
  const sourceRows = db.prepare('SELECT * FROM source_records ORDER BY legal_document_key,source_key').all();
  const recordsByKey = new Map();
  for (const row of sourceRows) {
    if (!recordsByKey.has(row.legal_document_key)) recordsByKey.set(row.legal_document_key, []);
    recordsByKey.get(row.legal_document_key).push(row);
  }
  const held = live.legalDocumentClassifications.filter(item => item.status !== 'EXACT_FILE_MATCH');
  if (held.length !== 452) throw new Error(`J1_HELD_GROUP_COUNT_REJECTED:${held.length}`);
  const classified = [];
  const causeCombinations = {};
  const atomicCauses = {};
  for (const item of held) {
    let decision = 'HUMAN_REVIEW';
    let confidence = item.status;
    let rationale = item.cause;
    if (item.status === 'CONFLICT') {
      increment(causeCombinations, item.cause);
      for (const cause of item.cause.split(';')) increment(atomicCauses, cause);
      confidence = 'CONFLICT';
    } else if (item.status === 'CANDIDATE') {
      confidence = 'MEDIUM';
      rationale = 'Candidate remains unconfirmed; available exact file/legal identity evidence is insufficient for automatic association.';
    } else if (item.status === 'SAME_DOCUMENT_DIFFERENT_FILE') {
      confidence = 'CONFLICT_DIFFERENT_FILE';
      rationale = 'The exact legal key has multiple valid PDF SHA values. Preserve separate file identities; do not replace or deduplicate automatically.';
    } else if (item.status === 'EXACT_DOCUMENT_MATCH') {
      confidence = 'HIGH_LEGAL_IDENTITY';
      rationale = 'Docket, court, chamber and decision date match exactly, with title as corroboration; the SHA differs. No matching Sentencia row exists and the existing Corpus ingestion linker requires matching SHA, so no supported DB association can be created safely.';
    } else if (item.status === 'INVALID_FILE') {
      decision = 'REJECT'; confidence = 'INVALID_PDF';
      rationale = 'The local file begins with a PDF signature but has no %%EOF marker and the parser reports Invalid PDF structure.';
    }
    classified.push({ legalDocumentKey: item.legalDocumentKey, status: item.status, confidence, decision,
      sourceRecords: item.sourceRecords, caseNumber: item.caseNumber, court: item.court, chamber: item.chamber,
      decisionDate: item.decisionDate, title: item.title, sha256: item.sha256, cause: item.cause, rationale,
      corpusDocuments: item.liveMatches, sourceEvidence: recordsByKey.get(item.legalDocumentKey) || [] });
  }
  const reviewers = classified.filter(row => row.decision === 'HUMAN_REVIEW');
  const rejected = classified.filter(row => row.decision === 'REJECT');
  writeJson('review-input.json', { generatedAt: new Date().toISOString(), sourceRecords: sourceRows.length,
    heldLegalGroups: held.length, groups: classified });
  writeJson('review-classification.json', { generatedAt: new Date().toISOString(), groups: classified });
  writeJson('match-evidence.json', { generatedAt: new Date().toISOString(), groups: classified.map(row => ({
    legalDocumentKey: row.legalDocumentKey, status: row.status, confidence: row.confidence, cause: row.cause,
    sha256: row.sha256, corpusDocuments: row.corpusDocuments, sourceEvidence: row.sourceEvidence })) });
  writeJson('conflict-causes.json', { groupCount: live.classification.legalDocuments.CONFLICT,
    combinations: causeCombinations, atomicOccurrences: atomicCauses });
  const exact = classified.filter(row => row.status === 'EXACT_DOCUMENT_MATCH');
  const previousExact = fs.existsSync(path.join(WORK, 'exact-resolutions.json')) ? readJson(path.join(WORK, 'exact-resolutions.json')) : {};
  writeJson('exact-resolutions.json', { total: 2, reviewed: exact, resolved: [], heldForSupportedLink: exact,
    sentenceMatches: previousExact.sentenceMatches || [], decision: 'No write: the two same-case SHA values differ and no compatible source-record association exists.' });
  const candidates = classified.filter(row => row.status === 'CANDIDATE');
  writeJson('candidate-resolutions.json', { total: candidates.length, autoResolved: [], humanReview: candidates, rejected: [] });
  const invalid = db.prepare('SELECT sha256,local_path,bytes,actual_sha256,pdf_valid,page_count,parser_error FROM objects WHERE pdf_valid<>1 OR pdf_valid IS NULL').all();
  writeJson('invalid-pdf-review.json', { count: invalid.length, objects: invalid.map(row => {
    const content = fs.readFileSync(row.local_path);
    const signature = content.subarray(0,8).toString('latin1');
    const hasEofMarker = content.subarray(-2048).includes(Buffer.from('%%EOF'));
    return { ...row, signature: signature.startsWith('%PDF-'), hasEofMarker,
      classification: signature.startsWith('%PDF-') && !hasEofMarker && row.parser_error === 'Invalid PDF structure.' ? 'CORRUPT' : 'OTHER' };
  }) });
  const header = ['groupId','legalDocumentKey','caseNumber','year','chamber','court','decisionDate','title','sourceRecords',
    'sourceIds','documentUrl','viewerUrl','sha256','corpusDocumentIds','status','confidence','decision','cause','rationale'];
  const csvRows = [header.map(csv).join(',')];
  for (const row of reviewers) {
    const src = row.sourceEvidence[0] || {};
    csvRows.push([row.legalDocumentKey,row.legalDocumentKey,row.caseNumber,String(row.decisionDate || '').slice(0,4),
      row.chamber,row.court,row.decisionDate,row.title,row.sourceRecords,row.sourceEvidence.map(r=>r.external_id).join(';'),
      src.document_url,src.viewer_url,row.sha256.join(';'),row.corpusDocuments.map(d=>d.documentId).join(';'),
      row.status,row.confidence,row.decision,row.cause,row.rationale].map(csv).join(','));
  }
  fs.writeFileSync(path.join(WORK, 'human-review.csv'), `${csvRows.join('\r\n')}\r\n`, 'utf8');
  const plan = readJson(path.join(WORK, 'db-write-plan.json'));
  plan.proposed.exactResolutions = [];
  plan.proposed.exactLegalIdentityNeedsSupportedAssociation = exact;
  plan.writes = [{ entity: 'CorpusDocument', field: 'instance', value: 'SECOND_INSTANCE', rows: 4596,
    evidence: 'exact source court + chamber in metadataOriginal; idempotent transaction; backup verified' }];
  plan.note = 'Exact/High legal identity matches remain unlinked because the compatible Corpus linker requires identical file SHA and no Sentencia target exists.';
  writeJson('db-write-plan.json', plan);
  const summary = readJson(path.join(WORK, 'final-summary.json'));
  summary.reviewAfter = { total: 452, resolved: 0, humanReview: reviewers.length, rejected: rejected.length,
    statusCounts: live.classification.legalDocuments };
  summary.conflictCauseCombinations = causeCombinations;
  summary.exactCasesReviewed = 2;
  summary.exactCasesResolved = 0;
  summary.exactCasesHeld = 2;
  summary.candidates = { total: candidates.length, autoResolved: 0, humanReview: candidates.length, rejected: 0 };
  summary.invalidPdf = { total: invalid.length, classification: 'CORRUPT' };
  summary.humanReviewExport = path.join(WORK, 'human-review.csv');
  writeJson('final-summary.json', summary);
  db.close();
  console.log(JSON.stringify({ status: 'J1_ARTIFACTS_FINALIZED', total: held.length, humanReview: reviewers.length,
    rejected: rejected.length, conflicts: Object.values(causeCombinations).reduce((a,b)=>a+b,0), exactCasesHeld: exact.length,
    candidateHumanReview: candidates.length, humanReviewCsv: path.join(WORK,'human-review.csv') }, null, 2));
}
try { main(); }
catch (error) { console.error(`J1_FINALIZE_FAILED: ${error.message}`); process.exitCode = 1; }

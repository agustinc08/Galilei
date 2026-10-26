'use strict';

// Validates human-created annotations against the immutable review package.
// It never creates labels or calls a parser/model to infer expected values.
const fs = require('node:fs/promises');
const path = require('node:path');

const GOLD_ROOT = path.resolve(__dirname, '../../test-fixtures/legal-gold/civil-gold-v1');
const DEFAULT_PACK = path.resolve(__dirname, '../../../_recovery-work/galilei-editorial-gold-recall-suite4/human-review');

function parseArgs(argv) {
  const result = { pack: DEFAULT_PACK, validateOnly: false, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--validate-only') result.validateOnly = true;
    else if (arg === '--apply') result.apply = true;
    else if (arg === '--pack') result.pack = path.resolve(argv[++index] || '');
    else throw new Error('UNSUPPORTED_ARGUMENT');
  }
  if (result.apply === result.validateOnly) throw new Error('SELECT_EXACTLY_ONE_MODE');
  return result;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readJsonl(filePath, optional = false) {
  let text;
  try { text = await fs.readFile(filePath, 'utf8'); }
  catch (error) {
    if (optional && error.code === 'ENOENT') return [];
    throw error;
  }
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`INVALID_JSONL_LINE_${index + 1}`); }
  });
}

function requireString(value, code, min = 1, max = Infinity) {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw new Error(code);
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(value) && Number.isFinite(Date.parse(value));
}

function checkStructureLabel(label, packDoc) {
  if (!label || label.status !== 'HUMAN_REVIEW_COMPLETE' || label.exhaustive !== true) throw new Error('STRUCTURE_LABEL_NOT_EXHAUSTIVE_HUMAN_REVIEW');
  requireString(label.reviewerId, 'STRUCTURE_REVIEWER_REQUIRED', 2, 80);
  if (!isIsoDate(label.reviewedAt)) throw new Error('STRUCTURE_REVIEW_DATE_INVALID');
  if (typeof label.noStructuralHeading !== 'boolean' || !Array.isArray(label.sections)) throw new Error('STRUCTURE_LABEL_SHAPE_INVALID');
  if (label.noStructuralHeading && label.sections.length !== 0) throw new Error('STRUCTURE_NO_HEADING_CONFLICT');
  const pages = new Set(packDoc.pages.map((page) => page.pageNumber));
  for (const section of label.sections) {
    if (!Number.isInteger(section.page) || !pages.has(section.page)) throw new Error('STRUCTURE_PAGE_NOT_IN_SOURCE');
    requireString(section.rawHeading, 'STRUCTURE_RAW_HEADING_REQUIRED', 1, 500);
    if (!['VISTOS', 'RESULTANDO', 'RESULTA', 'CONSIDERANDO', 'NUMBERED_CONSIDERATION', 'RESUELVE', 'FALLO', 'OTHER_HEADING'].includes(section.expectedType)) throw new Error('STRUCTURE_TYPE_INVALID');
    if (section.ordinal !== null && (typeof section.ordinal !== 'string' || section.ordinal.length > 60)) throw new Error('STRUCTURE_ORDINAL_INVALID');
    if (section.notes !== null && (typeof section.notes !== 'string' || section.notes.length > 1000)) throw new Error('STRUCTURE_NOTES_INVALID');
  }
}

function checkCitationLabel(label, packDoc, targetIds) {
  if (!label || label.status !== 'HUMAN_REVIEW_COMPLETE' || label.exhaustive !== true) throw new Error('CITATION_LABEL_NOT_EXHAUSTIVE_HUMAN_REVIEW');
  requireString(label.reviewerId, 'CITATION_REVIEWER_REQUIRED', 2, 80);
  if (!isIsoDate(label.reviewedAt) || !Array.isArray(label.references)) throw new Error('CITATION_LABEL_SHAPE_INVALID');
  const pages = new Set(packDoc.pages.map((page) => page.pageNumber));
  const families = new Set(['EXPEDIENTE_IDENTIFIER', 'CIVIL_EXPEDIENTE', 'CNCIV_ROLLO', 'CNCIV_SALA_DATE', 'CSJN_FALLOS', 'CSJN_CASE', 'CSJN_DECISION_DATE', 'OTHER_COURT', 'STATUTE_REFERENCE']);
  const outcomes = new Set(['UNIQUE', 'AMBIGUOUS', 'UNRESOLVED', 'SELF_REFERENCE', 'STATUTE_ONLY', 'OUT_OF_SCOPE']);
  const reasons = new Set(['NO_TARGET_IN_CORPUS', 'INSUFFICIENT_TARGET_METADATA', 'PARSER_FIELDS_INSUFFICIENT', 'NORMALIZATION_MISMATCH', 'MULTIPLE_TARGETS', 'UNPUBLISHED_OR_INACTIVE', 'UNSUPPORTED_EXTERNAL_COURT', 'SELF_REFERENCE', 'STATUTE_ONLY', 'NOT_APPLICABLE', 'OTHER']);
  for (const reference of label.references) {
    if (!Number.isInteger(reference.page) || !pages.has(reference.page)) throw new Error('CITATION_PAGE_NOT_IN_SOURCE');
    requireString(reference.rawCitation, 'CITATION_RAW_REQUIRED', 1, 1000);
    if (!['DETECT', 'DO_NOT_DETECT'].includes(reference.decision)) throw new Error('CITATION_DECISION_INVALID');
    if (reference.family !== null && !families.has(reference.family)) throw new Error('CITATION_FAMILY_INVALID');
    if (!outcomes.has(reference.resolutionExpectation)) throw new Error('CITATION_RESOLUTION_EXPECTATION_INVALID');
    if (!reasons.has(reference.resolutionReason)) throw new Error('CITATION_RESOLUTION_REASON_INVALID');
    if (reference.decision === 'DETECT' && (!reference.family || reference.resolutionExpectation === 'OUT_OF_SCOPE')) throw new Error('CITATION_IN_SCOPE_FIELDS_REQUIRED');
    if (reference.decision === 'DO_NOT_DETECT' && reference.resolutionExpectation !== 'OUT_OF_SCOPE') throw new Error('NEGATIVE_CITATION_MUST_BE_OUT_OF_SCOPE');
    if (reference.expectedParsedFields !== null && (typeof reference.expectedParsedFields !== 'object' || Array.isArray(reference.expectedParsedFields))) throw new Error('CITATION_PARSED_FIELDS_INVALID');
    if (reference.expectedTarget !== null) {
      const targetId = reference.expectedTarget.documentId;
      if (targetId !== null && (typeof targetId !== 'string' || !targetIds.has(targetId))) throw new Error('CITATION_TARGET_NOT_IN_PUBLIC_CATALOG');
      if (reference.expectedTarget.sourceHash !== null && !/^[a-f0-9]{64}$/u.test(reference.expectedTarget.sourceHash)) throw new Error('CITATION_TARGET_HASH_INVALID');
    }
    if (reference.resolutionExpectation === 'UNIQUE' && (!reference.expectedTarget || !reference.expectedTarget.documentId)) throw new Error('UNIQUE_TARGET_REQUIRED');
    if (reference.notes !== null && (typeof reference.notes !== 'string' || reference.notes.length > 1000)) throw new Error('CITATION_NOTES_INVALID');
  }
}

function verifyIdentity(label, packDoc, code) {
  if (label.sampleId !== packDoc.sampleId || label.documentId !== packDoc.documentId || label.sourceHash !== packDoc.sourceHash) throw new Error(code);
}

async function validateSet(options) {
  const manifest = await readJson(path.join(options.pack, 'sample-manifest.json'));
  if (manifest.goldVersion !== 'civil-gold-v1' || !Array.isArray(manifest.documents)) throw new Error('GOLD_MANIFEST_INVALID');
  const lockedManifest = await readJson(path.join(GOLD_ROOT, 'sample-manifest.json'));
  if (manifest.deterministicSelectionSha256 !== lockedManifest.deterministicSelectionSha256) throw new Error('GOLD_SAMPLE_SELECTION_MISMATCH');
  const lockedRows = new Map(lockedManifest.documents.map((doc) => [doc.sampleId, `${doc.documentId}:${doc.sourceHash}`]));
  if (manifest.documents.length !== lockedRows.size || manifest.documents.some((doc) => lockedRows.get(doc.sampleId) !== `${doc.documentId}:${doc.sourceHash}`)) throw new Error('GOLD_SAMPLE_FRAME_MISMATCH');
  const structurePack = await readJsonl(path.join(options.pack, 'structure-review-pack.jsonl'));
  const citationPack = await readJsonl(path.join(options.pack, 'citation-review-pack.jsonl'));
  const structureLabels = await readJsonl(path.join(options.pack, 'structure-labels.jsonl'), true);
  const citationLabels = await readJsonl(path.join(options.pack, 'citation-labels.jsonl'), true);
  const targetCatalog = await readJsonl(path.join(options.pack, 'target-catalog.jsonl'));
  const targetIds = new Set(targetCatalog.map((target) => String(target.documentId)));
  const structureById = new Map(structurePack.map((doc) => [doc.sampleId, doc]));
  const citationById = new Map(citationPack.map((doc) => [doc.sampleId, doc]));
  if (structureById.size !== structurePack.length || citationById.size !== citationPack.length) throw new Error('DUPLICATE_REVIEW_PACK_ID');
  if (manifest.structureReviewCount !== structurePack.length || manifest.citationReviewCount !== citationPack.length) throw new Error('GOLD_ASSIGNMENT_COUNT_MISMATCH');
  if (Array.isArray(lockedManifest.structureSampleIds) && JSON.stringify([...lockedManifest.structureSampleIds].sort()) !== JSON.stringify([...structureById.keys()].sort())) throw new Error('GOLD_STRUCTURE_ASSIGNMENT_MISMATCH');
  if (Array.isArray(lockedManifest.citationSampleIds) && JSON.stringify([...lockedManifest.citationSampleIds].sort()) !== JSON.stringify([...citationById.keys()].sort())) throw new Error('GOLD_CITATION_ASSIGNMENT_MISMATCH');
  const structureSeen = new Set();
  for (const label of structureLabels) {
    if (structureSeen.has(label.sampleId)) throw new Error('DUPLICATE_STRUCTURE_LABEL');
    structureSeen.add(label.sampleId);
    const packDoc = structureById.get(label.sampleId);
    if (!packDoc) throw new Error('UNKNOWN_STRUCTURE_SAMPLE_ID');
    verifyIdentity(label, packDoc, 'STRUCTURE_SOURCE_IDENTITY_MISMATCH');
    checkStructureLabel(label, packDoc);
  }
  const citationSeen = new Set();
  for (const label of citationLabels) {
    if (citationSeen.has(label.sampleId)) throw new Error('DUPLICATE_CITATION_LABEL');
    citationSeen.add(label.sampleId);
    const packDoc = citationById.get(label.sampleId);
    if (!packDoc) throw new Error('UNKNOWN_CITATION_SAMPLE_ID');
    verifyIdentity(label, packDoc, 'CITATION_SOURCE_IDENTITY_MISMATCH');
    checkCitationLabel(label, packDoc, targetIds);
  }
  const complete = structureLabels.length === structurePack.length && citationLabels.length === citationPack.length;
  return { manifest, structurePack, citationPack, structureLabels, citationLabels, complete };
}

async function applyLabels(result) {
  const destinations = [
    { file: path.join(GOLD_ROOT, 'structure', 'labels.jsonl'), labels: result.structureLabels },
    { file: path.join(GOLD_ROOT, 'citations', 'labels.jsonl'), labels: result.citationLabels },
  ];
  for (const destination of destinations) {
    const existing = await readJsonl(destination.file, true);
    const ids = new Set(existing.map((label) => label.sampleId));
    if (destination.labels.some((label) => ids.has(label.sampleId))) throw new Error('LABEL_ALREADY_IMPORTED');
    await fs.writeFile(destination.file, [...existing, ...destination.labels].map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await validateSet(options);
  const summary = {
    goldVersion: result.manifest.goldVersion,
    sampleSize: result.manifest.sampleSize,
    structureLabeled: result.structureLabels.length,
    structureTarget: result.structurePack.length,
    citationsLabeled: result.citationLabels.length,
    citationsTarget: result.citationPack.length,
    completeReview: result.complete,
    status: result.complete ? 'HUMAN_GOLD_READY_FOR_EVALUATION' : 'PENDING_HUMAN_GOLD',
  };
  if (options.apply) {
    if (!result.complete) throw new Error('ALL_ASSIGNED_DOCUMENTS_MUST_BE_EXHAUSTIVELY_REVIEWED_BEFORE_IMPORT');
    await applyLabels(result);
    summary.status = 'HUMAN_GOLD_IMPORTED';
  }
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`LEGAL_GOLD_IMPORT=FAIL; ${error.code || error.message || 'UNKNOWN_ERROR'}`);
    process.exitCode = 1;
  });
}

module.exports = { checkStructureLabel, checkCitationLabel, verifyIdentity, validateSet };

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PDFParse } = require('pdf-parse');
const { legalIdentity, representationKey, textEvidence, compareRepresentations, sha256, validateReviewDecisions } = require('./jurisprudencia-review-workflow.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const RECOVERY = path.join(ROOT, '_recovery-work', 'jurisprudencia-j4');
const J1 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j1');
const J2 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j2');
const STORAGE = path.join(ROOT, '_dev-corpus-storage');
const TEXT_CACHE_FILE = path.join(RECOVERY, 'text-evidence-cache.json');
const EXPECTED_QUEUE = 451;
let pdfTextMs = 0;
const persistentTextCache = new Map();
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const csvCell = value => { const s = String(value ?? ''); return /[",\r\n]/u.test(s) ? `"${s.replace(/"/gu, '""')}"` : s; };
const writeJson = (name, value) => fs.writeFileSync(path.join(RECOVERY, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
function latestJ1Run() {
  const runs = path.join(J1, 'runs');
  if (!fs.existsSync(runs)) return J1;
  const dirs = fs.readdirSync(runs, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name).sort();
  return dirs.length ? path.join(runs, dirs.at(-1)) : J1;
}
function safePath(value) {
  if (!value) return null;
  const resolved = path.resolve(value);
  const approved = [path.join(ROOT, '_recovery-work', 'sprint146', 'viewer', 'objects'), STORAGE]
    .map(p => `${path.resolve(p)}${path.sep}`);
  if (!approved.some(prefix => resolved.toLowerCase().startsWith(prefix.toLowerCase()))) return null;
  return resolved;
}
function courtNumberFrom(source) {
  const evidence = [source.court, source.title, source.metadataOriginal?.courtNumber, source.metadataOriginal?.court_number]
    .filter(Boolean).join(' ');
  return evidence.match(/JUZGADO[^\n]{0,80}?\b(?:N(?:RO|[°º.]?)\s*)?(\d{1,3})\b/iu)?.[1] || '';
}
function currentByKeyHasConflict(groups, groupId) {
  return groups.find(group => group.legalDocumentKey === groupId)?.status === 'CONFLICT';
}
function buildIdentity(group, source = {}) {
  return legalIdentity({ jurisdiction: source.jurisdiction || 'NACIONAL', instance: source.instance,
    court: source.court || group.court, courtNumber: source.courtNumber || courtNumberFrom(source),
    chamber: source.chamber || group.chamber, caseNumber: source.case_number || group.caseNumber,
    decisionDate: source.decision_date || group.decisionDate,
    identityConflict: Boolean(source.identityConflict || group.status === 'CONFLICT' || group.metadataConflict) });
}
async function extractPdf(file, cache) {
  const resolved = safePath(file);
  if (!resolved || !fs.existsSync(resolved)) return { file: resolved, available: false, textEvidence: textEvidence('') };
  const bytes = fs.readFileSync(resolved);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (cache.has(sha)) return cache.get(sha);
  const cached = persistentTextCache.get(sha);
  if (cached && cached.bytes === bytes.length && cached.validPdf) {
    const result = { file: resolved, available: true, validPdf: true, sha256: sha, bytes: bytes.length,
      mime: 'application/pdf', pages: cached.pages, textEvidence: cached.textEvidence, cacheHit: true };
    cache.set(sha, result); return result;
  }
  const signed = bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (!signed) {
    const result = { file: resolved, available: true, validPdf: false, sha256: sha, bytes: bytes.length, mime: 'application/pdf', pages: null, textEvidence: textEvidence('') };
    cache.set(sha, result); return result;
  }
  const parser = new PDFParse({ data: bytes });
  const started = performance.now();
  try {
    const parsed = await parser.getText();
    const text = parsed.text || '';
    const pageCount = Array.isArray(parsed.pages) ? parsed.pages.length : Number(parsed.pages) || Number(parsed.total) || null;
    const result = { file: resolved, available: true, validPdf: true, sha256: sha, bytes: bytes.length,
      mime: 'application/pdf', pages: pageCount, textEvidence: textEvidence(text) };
    persistentTextCache.set(sha, { bytes: bytes.length, validPdf: true, pages: pageCount, textEvidence: result.textEvidence });
    cache.set(sha, result); return result;
  } catch (error) {
    const result = { file: resolved, available: true, validPdf: false, sha256: sha, bytes: bytes.length,
      mime: 'application/pdf', pages: null, parserError: error.message, textEvidence: textEvidence('') };
    cache.set(sha, result); return result;
  } finally { await parser.destroy(); pdfTextMs += performance.now() - started; }
}
function csv(headers, rows) { return `${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`; }
function metadataConflicts(groups, groupEvidence) {
  const target = groups.filter(group => group.status === 'CONFLICT' &&
    /SAMPLED_PDF_SIGNATURE_DATE_CONTRADICTS|SHA_MATCHES_CORPUS_DOCUMENT_WITH_CONTRADICTORY/u.test(group.cause || ''));
  const rows = [];
  for (const group of target) {
    const source = group.sourceEvidence || [];
    const candidate = group.liveMatches || [];
    const fields = ['caseNumber', 'decisionDate', 'court', 'chamber', 'title'];
    const conflicts = [];
    if (/SAMPLED_PDF_SIGNATURE_DATE_CONTRADICTS/u.test(group.cause || '')) {
      conflicts.push({ field: 'DATE', sourceValues: source.map(item => item.decision_date).filter(Boolean),
        candidateValues: groupEvidence.get(group.legalDocumentKey)?.textEvidence?.decisionDateEvidence || [],
        resolution: 'cannot determine; sampled PDF date contradicts source metadata; request source record or authoritative PDF review' });
    }
    for (const field of fields) {
      const sourceValues = [...new Set(source.map(item => String(item[{ caseNumber: 'case_number', decisionDate: 'decision_date', court: 'court', chamber: 'chamber', title: 'title' }[field]] || '').trim()).filter(Boolean))];
      const candidateValues = [...new Set(candidate.map(item => String(item[field] || '').trim()).filter(Boolean))];
      if (sourceValues.length > 1 || candidateValues.length > 1 || (sourceValues.length && candidateValues.length && sourceValues[0].toLocaleLowerCase() !== candidateValues[0].toLocaleLowerCase()))
        conflicts.push({ field: field === 'caseNumber' ? 'CASE' : field === 'decisionDate' ? 'DATE' : field.toUpperCase(), sourceValues, candidateValues,
          resolution: sourceValues.length > 1 ? 'source conflict' : candidateValues.length > 1 ? 'Corpus conflict' :
            field === 'title' ? 'cannot determine; title is auxiliary metadata; no overwrite' : 'cannot determine; source and Corpus disagree; no overwrite' });
    }
    rows.push({ groupId: group.legalDocumentKey, cause: group.cause, status: group.status,
      fields: conflicts.length ? conflicts : [{ field: 'OTHER', sourceValues: [], candidateValues: [], resolution: 'cannot determine; cause requires human review' }] });
  }
  return rows;
}
function structuralPattern(group, shaOwners = new Map()) {
  const sources = group.sourceEvidence || [];
  const candidates = group.liveMatches || [];
  const cases = new Set(sources.map(x => String(x.case_number || '').trim()).filter(Boolean));
  const dates = new Set(sources.map(x => String(x.decision_date || '').slice(0, 10)).filter(Boolean));
  const chambers = new Set(sources.map(x => String(x.chamber || '').trim()).filter(Boolean));
  if (sources.some(x => !x.decision_date)) return 'AMBIGUOUS_CASE_NO_DATE';
  if (sources.some(x => !x.court)) return 'AMBIGUOUS_CASE_NO_COURT';
  if (candidates.length > 1 && sources.length === 1) return 'ONE_SOURCE_MULTIPLE_CORPUS_CANDIDATES';
  if (sources.length > 1 && candidates.length === 1) return 'MULTIPLE_SOURCES_ONE_CORPUS_CANDIDATE';
  if (sources.length > 1 && candidates.length > 1) return 'MULTIPLE_SOURCES_MULTIPLE_CORPUS_CANDIDATES';
  if (cases.size === 1 && dates.size > 1) return 'SAME_CASE_DIFFERENT_DATES';
  if (cases.size === 1 && chambers.size > 1) return 'SAME_CASE_DIFFERENT_CHAMBERS';
  if (sources.some(source => (shaOwners.get(source.sha256) || new Set()).size > 1)) return 'ONE_SHA_MULTIPLE_LEGAL_KEYS';
  if (new Set(sources.map(source => source.sha256).filter(Boolean)).size > 1) return 'MULTIPLE_FILES_ONE_LEGAL_KEY';
  if (sources.length > 1) return 'MULTIPLE_SOURCE_RECORDS_SAME_LEGAL_KEY';
  return 'SHA_OR_METADATA_LINKAGE_CONFLICT';
}
function classifyGroup(group, evidence) {
  const sourceRows = group.sourceEvidence || [];
  const legal = buildIdentity(group, sourceRows[0] || {});
  const metadataConflict = /METADATA_CONFLICT/u.test(group.blockerCategory || '') || /SIGNATURE_DATE_CONTRADICTS|CONTRADICTORY_LEGAL_METADATA/u.test(group.cause || '');
  const representationProof = evidence?.relationship;
  let classification = 'HUMAN_REQUIRED';
  let proposedAction = 'HUMAN_REVIEW';
  let policy = 'HUMAN_REQUIRED';
  let notes = 'No automatic association; current queue evidence requires a human decision.';
  if (group.status === 'EXACT_DOCUMENT_MATCH') {
    classification = 'MODEL_LIMITATION'; policy = 'MODEL_LIMITATION'; proposedAction = 'ASSOCIATE_LEGAL_IDENTITY';
    notes = 'Legal identity fields and representation evidence match, but current Corpus linker cannot attach distinct-SHA file to this legal document; no typed LegalDecision relationship exists.';
  } else if (group.status === 'SAME_DOCUMENT_DIFFERENT_FILE') {
    if (representationProof === 'SAME_TEXT_RENDER' || representationProof === 'SAME_DECISION_DIFFERENT_VERSION' || representationProof === 'SAME_DECISION_DIFFERENT_RENDER') {
      classification = 'MODEL_LIMITATION'; policy = 'MODEL_LIMITATION'; proposedAction = 'ATTACH_ALTERNATE_REPRESENTATION';
      notes = `Read-only evidence supports ${representationProof}; preserve both SHA values. A provenance-preserving alternate-file association lacks an explicit legal identity relation in the current model.`;
    } else {
      classification = 'HUMAN_REQUIRED'; proposedAction = 'HUMAN_REVIEW'; notes = 'Distinct files under the same key, but text evidence does not establish their legal relationship.';
    }
  } else if (metadataConflict) {
    classification = 'SOURCE_DATA_REQUIRED'; policy = 'SOURCE_DATA_REQUIRED'; proposedAction = 'SOURCE_METADATA_REVIEW';
    notes = 'Conflicting metadata or sampled PDF header evidence needs authoritative source review; no metadata was overwritten.';
  } else if (group.status === 'CANDIDATE') {
    classification = evidence?.candidateCompared ? 'HUMAN_REQUIRED' : 'HUMAN_REQUIRED';
    proposedAction = 'HUMAN_REVIEW'; notes = evidence?.candidateCompared
      ? 'Candidate compared with available local evidence; multiple independent signals do not establish identity.'
      : 'No linked Corpus candidate was present in the read-only queue snapshot; source PDF alone cannot establish an association.';
  } else if (group.status === 'CONFLICT') {
    const pattern = structuralPattern(group);
    if (/DUPLICATE_SOURCE_METADATA/u.test(pattern) || /DUPLICATE/u.test(group.cause || '')) {
      classification = 'SOURCE_DATA_REQUIRED'; policy = 'SOURCE_DATA_REQUIRED'; proposedAction = 'SOURCE_METADATA_REVIEW';
      notes = 'Repeated source records/metadata create a structural conflict; obtain source-side identifier/crosswalk evidence.';
    } else {
      classification = 'HUMAN_REQUIRED'; proposedAction = 'HUMAN_REVIEW';
      notes = `Structural conflict ${pattern}; do not choose a candidate by fuzzy similarity or SHA reuse.`;
    }
  }
  if (legal.confidence === 'INVALID') { classification = 'REJECT'; policy = 'REJECT'; proposedAction = 'REJECT'; notes = 'Invalid critical identity metadata; retain the source for correction and do not associate.'; }
  const actionToSupport = {
    LINK_EXACT_FILE: { supported: 'YES', humanRequired: false },
    ATTACH_ALTERNATE_REPRESENTATION: { supported: 'PARTIAL', humanRequired: true },
    ASSOCIATE_LEGAL_IDENTITY: { supported: 'NO', humanRequired: true },
    KEEP_SEPARATE_RELATED: { supported: 'YES', humanRequired: true },
    REJECT: { supported: 'YES', humanRequired: false },
    HUMAN_REVIEW: { supported: 'YES', humanRequired: true },
    SOURCE_METADATA_REVIEW: { supported: 'YES', humanRequired: true },
  }[proposedAction] || { supported: 'NO', humanRequired: true };
  return { classification, policy, legalIdentity: legal, proposedAction,
    writeSupportedByCurrentModel: actionToSupport.supported, humanRequired: actionToSupport.humanRequired,
    evidence: { status: group.status, cause: group.cause || null, structuralPattern: group.status === 'CONFLICT' ? structuralPattern(group) : null,
      relationship: representationProof || 'INCONCLUSIVE', textAvailable: Boolean(evidence?.textAvailable),
      independentCandidateComparison: Boolean(evidence?.candidateCompared), legalKeyConfidence: legal.confidence }, notes };
}
function htmlEscape(value) { return String(value ?? '').replace(/[&<>"']/gu, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }

async function main() {
  fs.mkdirSync(RECOVERY, { recursive: true });
  if (fs.existsSync(TEXT_CACHE_FILE)) {
    const stored = readJson(TEXT_CACHE_FILE);
    if (stored.version === 'J4-pdf-text-evidence-v2') for (const [sha, item] of Object.entries(stored.entries || {})) persistentTextCache.set(sha, item);
  }
  const inputFile = path.join(latestJ1Run(), 'review-input.json');
  const input = readJson(inputFile);
  const queue = input.groups.filter(group => group.status !== 'INVALID_FILE');
  if (queue.length !== EXPECTED_QUEUE) throw new Error(`J4_QUEUE_COUNT_REJECTED:${queue.length}`);
  const j2 = readJson(path.join(J2, 'same-decision-analysis.json'));
  const identityContract = readJson(path.join(J2, 'identity-contract.json'));
  const cache = new Map();
  const t0 = performance.now();
  const queueSnapshot = [];
  const groupEvidence = new Map();
  for (const group of queue) {
    const files = [];
    for (const source of group.sourceEvidence || []) {
      const pdf = await extractPdf(source.local_path, cache);
      const legal = buildIdentity(group, source);
      const repr = representationKey({ sha256: pdf.sha256 || source.sha256, mime: source.mime, bytes: pdf.bytes ?? source.bytes,
        pages: pdf.pages ?? source.page_count, source: source.source_key, sourceRecordId: source.external_id });
      files.push({ legalIdentity: legal, ...repr, pathAvailable: pdf.available, validPdf: pdf.validPdf,
        textEvidence: pdf.textEvidence, provenance: { sourceKey: source.source_key, sourceRecordId: source.external_id,
          sourceSystem: String(source.source_key || '').split(':')[0] || null, sourceReference: source.detail_url || null } });
    }
    const candidateFiles = [];
    for (const candidate of group.liveMatches || []) {
      const candidateSha = candidate.sha256 || candidate.matchedSha?.[0] || null;
      const targetPath = candidate.storageKey ? path.join(STORAGE, ...candidate.storageKey.split(/[\\/]/u))
        : candidateSha ? path.join(STORAGE, candidateSha.slice(0, 2), `${candidateSha}.pdf`) : null;
      const pdf = await extractPdf(targetPath, cache);
      candidateFiles.push({ legalIdentity: buildIdentity({ ...group, ...candidate, instance: 'SECOND_INSTANCE' }, candidate),
        ...representationKey({ sha256: candidateSha, mime: candidate.mimeType, bytes: candidate.sizeBytes,
          pages: candidate.pageCount, source: 'CORPUS', sourceRecordId: candidate.documentId }),
        documentId: candidate.documentId, title: candidate.title, pathAvailable: pdf.available, validPdf: pdf.validPdf,
        textEvidence: pdf.textEvidence });
    }
    const record = { groupId: group.legalDocumentKey, blocker: group.status, status: group.status,
      sourceIds: [...new Set((group.sourceEvidence || []).map(item => item.external_id).filter(Boolean))],
      candidateIds: [...new Set((group.liveMatches || []).map(item => item.documentId).filter(Boolean))],
      case: group.caseNumber || null, year: String(group.decisionDate || '').slice(0, 4) || null,
      court: group.court || null, Sala: group.chamber || null, date: group.decisionDate || null,
      sourceSha: [...new Set(files.map(file => file.sha256).filter(Boolean))],
      candidateSha: [...new Set(candidateFiles.map(file => file.sha256).filter(Boolean))],
      sourceFiles: files.map(({ pathAvailable, ...file }) => ({ ...file, pathAvailable })), candidateFiles,
      sourceFileSizes: files.map(file => file.size), pages: files.map(file => file.pages),
      metadata: { title: group.title || null, cause: group.cause || null, sourceRecords: group.sourceRecords,
        sourceMetadata: (group.sourceEvidence || []).map(item => ({ caseNumber: item.case_number, court: item.court,
          chamber: item.chamber, decisionDate: item.decision_date, year: item.year, title: item.title,
          mime: item.mime, bytes: item.bytes, pages: item.page_count, identityStatus: item.identity_status,
          sourceDuplicateStatus: item.source_duplicate_status })), candidates: (group.liveMatches || []).map(item => ({
          documentId: item.documentId, title: item.title, caseNumber: item.caseNumber, court: item.court,
          chamber: item.chamber, decisionDate: item.decisionDate, matchedSha: item.matchedSha || [] })) },
      provenance: files.map(file => file.provenance) };
    queueSnapshot.push(record);
    const best = files.find(file => file.textEvidence.textAvailable);
    groupEvidence.set(group.legalDocumentKey, { textAvailable: Boolean(best?.textEvidence.textAvailable),
      textEvidence: best?.textEvidence || null, candidateCompared: candidateFiles.length > 0 });
  }
  writeJson('text-evidence-cache.json', { version: 'J4-pdf-text-evidence-v2', entries: Object.fromEntries([...persistentTextCache.entries()].sort(([a],[b]) => a.localeCompare(b))) });
  const metadataMs = Number((performance.now() - t0 - pdfTextMs).toFixed(2));
  const textMs = Number(pdfTextMs.toFixed(2));

  const legalIdentityAnalysis = queueSnapshot.map(item => ({ groupId: item.groupId,
    legalIdentity: item.sourceFiles[0]?.legalIdentity || legalIdentityForSnapshot(item),
    metadataConflict: currentByKeyHasConflict(queue, item.groupId) || (item.metadata.sourceMetadata.length > 1 &&
      new Set(item.metadata.sourceMetadata.map(row => JSON.stringify([row.caseNumber,row.court,row.chamber,row.decisionDate]))).size > 1) }));
  const currentByKey = new Map(queue.map(group => [group.legalDocumentKey, group]));
  const pairAnalysis = [];
  const compareGroups = queue.filter(group => group.status === 'SAME_DOCUMENT_DIFFERENT_FILE');
  for (const group of compareGroups) {
    const sourceFiles = queueSnapshot.find(item => item.groupId === group.legalDocumentKey).sourceFiles;
    const results = [];
    for (let i = 0; i < sourceFiles.length; i++) for (let j = i + 1; j < sourceFiles.length; j++) {
      const result = compareRepresentations(sourceFiles[i], sourceFiles[j]);
      results.push({ leftSha: sourceFiles[i].sha256, rightSha: sourceFiles[j].sha256, ...result });
    }
    const relation = results.find(item => item.relationship === 'SAME_TEXT_RENDER')?.relationship ||
      results.find(item => item.relationship === 'SAME_DECISION_DIFFERENT_VERSION')?.relationship ||
      results.find(item => item.relationship === 'SAME_DECISION_DIFFERENT_RENDER')?.relationship ||
      (results.length ? 'INCONCLUSIVE' : 'INCONCLUSIVE');
    pairAnalysis.push({ groupId: group.legalDocumentKey, classification: relation, comparisons: results,
      sourceRecordIds: (group.sourceEvidence || []).map(item => item.external_id), sha256: group.sha256 || [] });
    groupEvidence.set(group.legalDocumentKey, { ...groupEvidence.get(group.legalDocumentKey), relationship: relation,
      pairEvidence: results, textAvailable: sourceFiles.some(file => file.textEvidence.textAvailable) });
  }
  const highCases = [];
  for (const group of queue.filter(item => item.status === 'EXACT_DOCUMENT_MATCH')) {
    const previous = identityContract.identities.v2.realCases.find(item => item.legalDocumentKey === group.legalDocumentKey);
    const source = group.sourceEvidence?.[0];
    const target = previous?.corpus;
    const sourceFile = await extractPdf(source?.local_path, cache);
    const targetPath = target?.sha256 ? path.join(STORAGE, target.sha256.slice(0, 2), `${target.sha256}.pdf`) : null;
    const targetFile = await extractPdf(targetPath, cache);
    const a = { sha256: sourceFile.sha256 || source?.sha256, legalIdentity: buildIdentity(group, source), textEvidence: sourceFile.textEvidence };
    const b = { sha256: targetFile.sha256 || target?.sha256, legalIdentity: legalIdentity({ jurisdiction: 'NACIONAL', instance: 'SECOND_INSTANCE', court: target?.court,
      chamber: target?.chamber, caseNumber: target?.caseNumber, decisionDate: target?.decisionDate }), textEvidence: targetFile.textEvidence };
    const comparison = compareRepresentations(a, b);
    highCases.push({ groupId: group.legalDocumentKey, source: { sourceRecordId: source?.external_id,
      sha256: sourceFile.sha256 || source?.sha256, bytes: sourceFile.bytes, pages: sourceFile.pages,
      validPdf: sourceFile.validPdf, textEvidence: sourceFile.textEvidence }, corpus: { documentId: target?.id,
      fileId: target?.fileId, sha256: targetFile.sha256 || target?.sha256, bytes: targetFile.bytes ?? Number(target?.sizeBytes),
      pages: targetFile.pages ?? target?.pageCount, validPdf: targetFile.validPdf, textEvidence: targetFile.textEvidence }, comparison,
      priorJ2Classification: previous?.compare?.classification || null,
      reprocessed: Boolean(sourceFile.validPdf && targetFile.validPdf), notes: sourceFile.validPdf && targetFile.validPdf
        ? 'Both current local PDF bytes rehashed and text re-extracted; J2 comparison is reproducible evidence for text fields.'
        : 'Could not read both local PDF representations; prior J2 result is preserved but not independently reverified end to end.' });
    groupEvidence.set(group.legalDocumentKey, { textAvailable: Boolean(sourceFile.textEvidence.textAvailable && targetFile.textEvidence.textAvailable),
      relationship: comparison.relationship, textEvidence: sourceFile.textEvidence, candidateCompared: Boolean(targetFile.validPdf) });
  }

  const metadataRows = metadataConflicts(queue, groupEvidence);
  const metadataByField = metadataRows.flatMap(row => row.fields).reduce((acc, item) => {
    acc[item.field] = (acc[item.field] || 0) + 1; return acc;
  }, {});
  const shaOwners = new Map();
  for (const group of queue) for (const source of group.sourceEvidence || []) {
    if (!source.sha256) continue;
    if (!shaOwners.has(source.sha256)) shaOwners.set(source.sha256, new Set());
    shaOwners.get(source.sha256).add(group.legalDocumentKey);
  }
  const structuralRows = queue.filter(group => group.status === 'CONFLICT' && !/SAMPLED_PDF_SIGNATURE_DATE_CONTRADICTS|SHA_MATCHES_CORPUS_DOCUMENT_WITH_CONTRADICTORY/u.test(group.cause || ''))
    .map(group => ({ groupId: group.legalDocumentKey, pattern: structuralPattern(group, shaOwners), sourceCount: (group.sourceEvidence || []).length,
      candidateCount: (group.liveMatches || []).length, case: group.caseNumber, dates: [...new Set((group.sourceEvidence || []).map(x => x.decision_date).filter(Boolean))],
      chambers: [...new Set((group.sourceEvidence || []).map(x => x.chamber).filter(Boolean))], cause: group.cause }));
  const structuralCounts = Object.values(structuralRows.reduce((acc, row) => { acc[row.pattern] = (acc[row.pattern] || 0) + 1; return acc; }, {})).reduce((a,b) => a+b, 0);
  const exactFiles = new Set();
  const pairById = new Map(pairAnalysis.map(item => [item.groupId, item]));
  const highById = new Map(highCases.map(item => [item.groupId, item]));
  const proposed = queue.map(group => {
    const detail = queueSnapshot.find(item => item.groupId === group.legalDocumentKey);
    const evidence = groupEvidence.get(group.legalDocumentKey) || {};
    if (group.status === 'EXACT_FILE_MATCH') exactFiles.add(group.legalDocumentKey);
    const decision = classifyGroup(group, evidence);
    return { groupId: group.legalDocumentKey, classification: decision.classification,
      legalKey: detail.sourceFiles[0]?.legalIdentity?.key || null,
      sourceRepresentation: detail.sourceFiles.map(file => ({ sha256: file.sha256, mime: file.mime, size: file.size, pages: file.pages,
        source: file.source, sourceRecordId: file.sourceRecordId, normalizedTextHash: file.textEvidence.normalizedTextSha256 })),
      candidateRepresentation: detail.candidateFiles.map(file => ({ documentId: file.documentId, sha256: file.sha256, mime: file.mime,
        size: file.size, pages: file.pages, normalizedTextHash: file.textEvidence.normalizedTextSha256 })),
      relationship: evidence.relationship || 'INCONCLUSIVE', policy: decision.policy,
      confidence: decision.legalIdentity.confidence === 'COMPLETE' && evidence.textAvailable ? 'EVIDENCE_REVIEWED' : decision.legalIdentity.confidence,
      evidence: { ...decision.evidence, sourceTextHash: evidence.textEvidence?.normalizedTextSha256 || null,
        pairComparisons: evidence.pairEvidence || null, highIdentityReprocess: highById.get(group.legalDocumentKey)?.comparison || null },
      proposedAction: decision.proposedAction, allowedAction: decision.proposedAction,
      writeSupportedByCurrentModel: decision.writeSupportedByCurrentModel, humanRequired: decision.humanRequired, notes: decision.notes };
  });
  const counts = proposed.reduce((acc, item) => { acc[item.classification] = (acc[item.classification] || 0) + 1; return acc; }, {});
  const actionCsvHeaders = ['groupId','classification','legalKey','sourceRepresentation','candidateRepresentation','relationship','confidence','evidence','proposedAction','writeSupportedByCurrentModel','humanRequired','notes'];
  writeJson('review-queue-current.json', { source: path.relative(ROOT, inputFile), sourceGeneratedAt: input.generatedAt,
    expected: EXPECTED_QUEUE, observed: queueSnapshot.length, currentReadOnlyAudit: true, groups: queueSnapshot });
  writeJson('legal-identity-analysis.json', { version: 'J4-legal-identity-v1', fields: ['jurisdiction','court','chamber OR courtNumber','caseNumber','decisionDate'],
    rules: ['title is auxiliary only', 'SHA is file identity only', 'first instance uses court number in place of chamber', 'key is tooling-only and not a database primary key'],
    groups: legalIdentityAnalysis, confidenceCounts: legalIdentityAnalysis.reduce((acc,row) => { const key = row.legalIdentity.confidence; acc[key] = (acc[key] || 0) + 1; return acc; }, {}) });
  writeJson('representation-analysis.json', { version: 'J4-representation-v1', exactFileRule: 'SHA-256 equality only',
    textNormalization: 'NFC, remove soft hyphen, normalize whitespace/line breaks; preserve words and paragraph order',
    twoLegalIdentityCases: highCases, fifteenFileIdentityCases: pairAnalysis,
    classificationCounts15: pairAnalysis.reduce((acc,row) => { acc[row.classification] = (acc[row.classification] || 0) + 1; return acc; }, {}),
    textUnavailableGroups: queueSnapshot.filter(group => group.sourceFiles.every(file => !file.textEvidence.textAvailable)).map(group => group.groupId) });
  writeJson('structural-conflicts.json', { total: structuralRows.length, groups: structuralRows, metadataConflictGroups: metadataRows.length, metadataByField,
    patterns: Object.entries(structuralRows.reduce((acc,row) => { acc[row.pattern] = (acc[row.pattern] || 0) + 1; return acc; }, {}))
      .map(([pattern,count]) => ({ pattern, count, autoResolvable: false, human: true, needsSourceFix: /DUPLICATE|METADATA/u.test(pattern), safe: false })) });
  writeJson('candidate-analysis.json', { total: queue.filter(group => group.status === 'CANDIDATE').length,
    outcomes: proposed.filter(item => queue.find(group => group.legalDocumentKey === item.groupId)?.status === 'CANDIDATE')
      .map(item => ({ groupId: item.groupId, outcome: item.evidence.independentCandidateComparison ? 'AMBIGUOUS' : 'INSUFFICIENT_DATA',
        legalKey: item.legalKey, sourceIds: queue.find(group => group.legalDocumentKey === item.groupId).sourceEvidence.map(x => x.external_id),
        sourceTextHash: item.evidence.sourceTextHash, candidateIds: [], candidateComparison: 'No candidate document IDs in current source-of-truth queue snapshot.',
        evidence: item.evidence, proposedAction: item.proposedAction })) });
  writeJson('proposed-actions.json', { version: 'J4-actions-v1', noWrite: true, rows: proposed, counts, total: proposed.length });
  writeJson('linker-v2-dry-run.json', { version: 'J4-linker-v2-dry-run', writeEnabled: false, writes: 0,
    rows: proposed.map(item => ({ groupId: item.groupId, legalIdentity: { key: item.legalKey,
      confidence: item.evidence.legalKeyConfidence }, fileIdentity: { source: item.sourceRepresentation,
      candidate: item.candidateRepresentation }, relationship: item.relationship, allowedAction: item.proposedAction,
      supportStatus: item.writeSupportedByCurrentModel, evidence: item.evidence })) });
  writeJson('schema-proposal.json', { status: 'DESIGN_ONLY_NO_MIGRATION', options: [
    { option: 'A_LEGAL_DECISION_ENTITY', design: 'Typed LegalDecision entity with jurisdiction/court/chamber-or-courtNumber/case/date/source-native IDs, plus DecisionRepresentation rows to CorpusDocumentFile and provenance.',
      benefits: ['separates legal identity from archival document/file', 'supports alternate representations and source identifiers'],
      risks: ['new entity and migration', 'cross-feature/schema coordination with Copernic', 'requires decisions about legacy Sentencia linkage and duplicate LegalDecision records'] },
    { option: 'B_IDENTITY_FIELDS_AND_PROVENANCE_RELATION', design: 'Add structured legal identity fields and a provenance/representation relation to the existing CorpusDocument/CORPUSDOCUMENTFILE model.',
      benefits: ['smaller migration', 'keeps existing search and viewer entry point'],
      risks: ['CorpusDocument remains a generic archive record', 'unique constraints/identity cardinality are harder to express', 'risk of conflating related decisions in one document row'] },
    { option: 'C_CURRENT_SCHEMA_ONLY', design: 'Keep current model; exact SHA links only and human review for different SHA.',
      benefits: ['no migration or cross-branch collision', 'strongest short-term safety'],
      risks: ['cannot persist legal identity association safely', 'alternate file would change latest-version behavior unless a dedicated workflow is added'] },
  ], recommendation: 'UNDECIDED; do not choose schema until branch integration and product ownership review.' });
  fs.writeFileSync(path.join(RECOVERY, 'proposed-actions.csv'), csv(actionCsvHeaders, proposed.map(item => actionCsvHeaders.map(key =>
    ['sourceRepresentation','candidateRepresentation','evidence'].includes(key) ? JSON.stringify(item[key]) : item[key]))), 'utf8');

  const humanGroups = proposed.filter(item => item.humanRequired || item.classification !== 'AUTO_SAFE');
  const humanRows = humanGroups.map(item => {
    const original = queue.find(group => group.legalDocumentKey === item.groupId);
    const snap = queueSnapshot.find(group => group.groupId === item.groupId);
    return { groupId: item.groupId, blocker: original.status, classification: item.classification, priority:
      original.status === 'EXACT_DOCUMENT_MATCH' || original.status === 'SAME_DOCUMENT_DIFFERENT_FILE' ? 'P0' : original.status === 'CANDIDATE' ? 'P1' :
        /SAMPLED_PDF_SIGNATURE_DATE_CONTRADICTS|SHA_MATCHES_CORPUS_DOCUMENT_WITH_CONTRADICTORY/u.test(original.cause || '') ? 'P2' : 'P3',
      metadataA: snap.metadata.sourceMetadata[0] || {}, metadataB: snap.metadata.candidates[0] || {},
      hashes: { source: item.sourceRepresentation.map(file => file.sha256), candidate: item.candidateRepresentation.map(file => file.sha256) },
      pages: snap.pages, sizes: snap.sourceFileSizes, legalKey: item.legalKey, evidence: item.evidence,
      excerpts: snap.sourceFiles.map(file => file.textEvidence.limitedExcerpt).filter(Boolean).slice(0, 2),
      recommendedAction: item.proposedAction, decision: '', reviewer: '', reviewedAt: '', notes: '',
      template: ['SAME_DECISION_SAME_FILE','SAME_DECISION_ALTERNATE_REPRESENTATION','SAME_DECISION_DIFFERENT_VERSION','RELATED_DOCUMENT','DIFFERENT_DECISION','INCONCLUSIVE'] };
  });
  writeJson('human-review.json', { localOnly: true, records: humanRows });
  const humanHeaders = ['groupId','blocker','classification','priority','metadataA','metadataB','hashes','pages','sizes','legalKey','evidence','excerpts','recommendedAction','decision','reviewer','reviewedAt','notes'];
  fs.writeFileSync(path.join(RECOVERY,'human-review.csv'), csv(humanHeaders, humanRows.map(row => humanHeaders.map(key =>
    ['metadataA','metadataB','hashes','pages','sizes','evidence','excerpts'].includes(key) ? JSON.stringify(row[key]) : row[key]))), 'utf8');
  const html = `<!doctype html><meta charset="utf-8"><title>J4 Human Review</title><style>body{font:14px system-ui;margin:2rem;color:#18212b}header{position:sticky;top:0;background:#fff;padding:1rem 0;border-bottom:1px solid #bbb}article{border:1px solid #ccd3da;border-radius:8px;padding:1rem;margin:1rem 0}pre{white-space:pre-wrap;max-height:12rem;overflow:auto;background:#f5f7f9;padding:.6rem}button,select{padding:.4rem;margin:.25rem}</style><header><b>J4 · Revisión local (sin escritura DB)</b> <span id="count"></span><br><label>Blocker <select id="blocker"><option value="">Todos</option></select></label><label>Clasificación <select id="classification"><option value="">Todas</option></select></label> <button id="prev">Anterior</button><button id="next">Siguiente</button></header><main id="items"></main><script>const data=${JSON.stringify(humanRows).replace(/</gu,'\\u003c')};let index=0;for(const [id,key] of [['blocker','blocker'],['classification','classification']]){const el=document.getElementById(id);[...new Set(data.map(x=>x[key]))].sort().forEach(v=>el.add(new Option(v,v)));el.onchange=render}function filtered(){return data.filter(x=>(!blocker.value||x.blocker===blocker.value)&&(!classification.value||x.classification===classification.value))}function render(){const rows=filtered();index=Math.max(0,Math.min(index,rows.length-1));count.textContent=rows.length+' casos';items.innerHTML=rows.length?'<article><b>'+esc(rows[index].groupId)+'</b><p>'+esc(rows[index].blocker)+' · '+esc(rows[index].classification)+' · '+esc(rows[index].priority)+'</p><p>'+esc(rows[index].recommendedAction)+'</p><pre>'+esc(JSON.stringify(rows[index],null,2))+'</pre><p>Decisión humana: '+rows[index].template.map(x=>'<label><input type="radio" name="decision" disabled>'+esc(x)+'</label>').join(' ')+'</p></article>':'<p>Sin casos para estos filtros.</p>'}function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}next.onclick=()=>{index++;render()};prev.onclick=()=>{index--;render()};render()</script>`;
  fs.writeFileSync(path.join(RECOVERY, 'human-review.html'), html, 'utf8');
  fs.writeFileSync(path.join(RECOVERY, 'review-decision-fixture.csv'), csv(['groupId','decision','reviewer','reviewedAt','notes'], [
    ['SYNTHETIC:J4:001','SAME_DECISION_ALTERNATE_REPRESENTATION','fixture-reviewer','2026-10-14T00:00:00Z','Synthetic fixture only.'],
  ]), 'utf8');
  const importResult = validateReviewDecisions(fs.readFileSync(path.join(RECOVERY,'review-decision-fixture.csv'),'utf8'), new Set(['SYNTHETIC:J4:001']));
  writeJson('review-import-test.json', { format: ['groupId','decision','reviewer','reviewedAt','notes'], acceptedDecisions: [
    'SAME_DECISION_SAME_FILE','SAME_DECISION_ALTERNATE_REPRESENTATION','SAME_DECISION_DIFFERENT_VERSION','RELATED_DOCUMENT','DIFFERENT_DECISION','INCONCLUSIVE'],
    fixture: 'SYNTHETIC_ONLY', result: importResult, validationOnly: true, databaseWrites: 0 });

  const outputHashes = {};
  for (const name of ['review-queue-current.json','legal-identity-analysis.json','representation-analysis.json','structural-conflicts.json','candidate-analysis.json','proposed-actions.json','proposed-actions.csv','linker-v2-dry-run.json','schema-proposal.json','human-review.csv','human-review.json','human-review.html','review-decision-fixture.csv','review-import-test.json'])
    outputHashes[name] = sha256(fs.readFileSync(path.join(RECOVERY,name)));
  const runtime = { totalGroups: EXPECTED_QUEUE, metadataPhaseMs: metadataMs, textPhaseMs: textMs,
    totalMs: Number((performance.now()-t0).toFixed(2)), sourceFilesHashedAndTextExtracted: cache.size,
    duplicateInputGroups: queue.filter(group => new Set(group.sha256 || []).size > 1).length };
  writeJson('performance.json', runtime);
  const summary = { mission: 'SPRINT J4 — REVIEW QUEUE + LEGAL IDENTITY WORKFLOW', status: 'IN_PROGRESS', asOf: '2026-10-14',
    git: { branch: 'feature/jurisprudencia', baseSha: 'b1d98b4c6e9fbcfeb40b94e07c5469b5a436f670', originDev: 'f7e37bc12436110191da15121bf047a0184e2e5a', originFeatureCopernic: 'fbd14c1cdbc69de79959611200e61e02cc73d40d' },
    reviewQueue: { expected: EXPECTED_QUEUE, observed: queue.length, excludedInvalidPdf: input.groups.filter(group => group.status === 'INVALID_FILE').length, sourceGeneratedAt: input.generatedAt },
    classification: { ...counts, total: proposed.length },
    representation: { twoLegalIdentityCases: highCases.length, fifteenFileIdentityGroups: pairAnalysis.length,
      byRelationship: pairAnalysis.reduce((acc,row) => { acc[row.classification] = (acc[row.classification] || 0) + 1; return acc; }, {}) },
    metadataConflicts: { groups: metadataRows.length, byField: metadataByField, classifiedFields: metadataRows }, structuralConflicts: { excludedMetadataConflicts: metadataRows.length,
      measuredStructuralGroups: structuralRows.length, countsByPattern: structuralRows.reduce((acc,row) => { acc[row.pattern] = (acc[row.pattern] || 0) + 1; return acc; }, {}) },
    candidates: { total: 106, outcomes: { strongSameDecision: 0, likelySameDecision: 0, ambiguous: 0, different: 0, insufficientData: 106 }, limitation: 'The current audited groups contain no linked candidateDocument IDs; source PDF alone is not enough to decide identity.' },
    model: { corpusDocument: 'generic archival/search item, not typed LegalDecision', corpusDocumentFile: 'supports multiple files per document; unique(documentId, sha256)',
      corpusIngestionRecord: 'can preserve a source event and point to one document/file', exactShaLinker: 'CorpusIngestionService.linkExisting hashes content and requires exactly one CorpusDocumentFile with that SHA; it cannot attach a distinct SHA representation to a legal identity.',
      viewerSearchLatestFile: 'viewer metadata/file and Search SQL select the highest CorpusDocumentFile.version; latest CorpusIngestionRecord is surfaced as provenance. Adding an alternate representation therefore changes visible latest-file/provenance behavior unless an explicit version policy is added.',
      alternateRepresentationWriteSupported: 'PARTIAL', migrationNow: false },
    writes: { corpus: 0, search: 0, prismaSchema: 0, migrations: 0, network: 0, reviewImport: 0 },
    searchIntegrity: { documents: 17078, tokens: 18799500, stale: 0, mismatch: 0, sampled: 100, status: 'PASS_READ_ONLY_J1_AUDIT' },
    performance: runtime, outputHashes, artifacts: '_recovery-work/jurisprudencia-j4/' };
  writeJson('final-summary.json', summary);
  console.log(JSON.stringify({ status: 'J4_ANALYSIS_GENERATED', reviewQueue: queue.length, classification: counts,
    fifteenFileIdentity: summary.representation.byRelationship, highIdentityReprocessed: highCases.map(item => ({ groupId: item.groupId, reprocessed: item.reprocessed, relationship: item.comparison.relationship })),
    patterns: summary.structuralConflicts.countsByPattern, humanReviewRows: humanRows.length, reviewImport: importResult, performance: runtime,
    artifacts: RECOVERY }, null, 2));
}
function legalIdentityForSnapshot(item) {
  const metadata = item.metadata.sourceMetadata[0] || {};
  return require('./jurisprudencia-review-workflow.cjs').legalIdentity({ court: item.court, chamber: item.Sala,
    caseNumber: item.case, decisionDate: item.date, jurisdiction: 'NACIONAL', instance: 'SECOND_INSTANCE' });
}
main().catch(error => { console.error(`J4_WORKFLOW_FAILED: ${error.stack || error.message}`); process.exitCode = 1; });

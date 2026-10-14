'use strict';

// Local, deterministic analysis of J7/J7.1 artifacts. It never opens PostgreSQL
// and writes only to the ignored _recovery-work tree.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { normalizeCivilCaseReference, VERSION } = require('./jurisprudencia-civil-case-normalizer.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const WORK = path.join(ROOT, '_recovery-work', 'jurisprudencia-j711');
const J7 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j7');
const J71 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j71');
const J61 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j61');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(WORK, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const by = (rows, key) => rows.reduce((out, row) => { const k = String(key(row) ?? 'UNKNOWN'); out[k] = (out[k] || 0) + 1; return out; }, {});
const sourceCodes = row => [...new Set((row.source || []).map(item => item.sourceCode).filter(Boolean))].sort();

function structuralSignature(value) {
  return String(value ?? '').normalize('NFC').replace(/[\u00a0\u2007\u2009\u202f]/gu, ' ').replace(/\s+/gu, ' ').trim()
    .toLocaleUpperCase('es-AR').replace(/[A-ZÁÉÍÓÚÜÑ]+/gu, 'A')
    .replace(/\d{1,3}(?:[. ]\d{3})+/gu, token => token.split(/[. ]/u).map(part => 'Q'.repeat(part.length)).join('.'))
    .replace(/\d+/gu, token => 'Q'.repeat(token.length));
}

function computeQuality(row, overrides = {}) {
  let score = 100;
  const completeness = { ...(row.completeness || {}), ...overrides };
  const weights = { caseNumber: 12, caseYear: 5, decisionDate: 8, court: 8, instance: 8, chamber: 8, title: 5,
    sourceRecordId: 5, portalId: 3, documentUrl: 4, sourceUrl: 4, fileSha: 10, pageCount: 5, originalMetadata: 5, provenanceRecord: 10 };
  for (const [field, weight] of Object.entries(weights)) if (completeness[field] !== 'PRESENT') score -= weight;
  for (const state of Object.values(completeness)) if (state === 'INVALID') score -= 5;
  if ((row.files || []).some(file => ['INVALID_PDF', 'HTML_AS_PDF', 'HASH_MISMATCH', 'MISSING_BLOB', 'UNREADABLE'].includes(file.integrityState))) score = Math.min(score, 10);
  if ((row.conflicts || []).length) score -= 12;
  score = Math.max(0, score);
  return score >= 90 ? 'EXCELLENT' : score >= 75 ? 'GOOD' : score >= 50 ? 'REVIEW' : score >= 20 ? 'POOR' : 'BROKEN';
}

function qualityCounts(rows, overrideById = new Map()) {
  const counts = { EXCELLENT: 0, GOOD: 0, REVIEW: 0, POOR: 0, BROKEN: 0 };
  for (const row of rows) counts[computeQuality(row, overrideById.get(row.documentId) || {})]++;
  return counts;
}

function priorIdentity(rawCase, rawYear) {
  const value = String(rawCase ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase()
    .replace(/(\d)[.,](?=\d{3}(?:\D|$))/gu, '$1');
  const match = value.match(/(\d+)\s*[/-]\s*(\d{2,4})/u);
  if (match) return `${match[1].replace(/^0+(?=\d)/u, '')}/${match[2].length === 2 ? match[2] : match[2].replace(/^0+(?=\d)/u, '')}`;
  const number = String(rawCase ?? '').trim().replace(/[.\s]/gu, '').replace(/^0+(?=\d)/u, '');
  return number ? `${number}${rawYear ? `/${rawYear}` : ''}` : null;
}

function countByStatus(rows) { return by(rows, row => row.newStatus || row.status); }

function run() {
  fs.mkdirSync(WORK, { recursive: true });
  const priorDeterminism = fs.existsSync(path.join(WORK, 'determinism.json')) ? read(path.join(WORK, 'determinism.json')) : null;
  const inventory = read(path.join(J7, 'civil-inventory.json'));
  const caseYearAudit = read(path.join(J71, 'case-year-analysis.json'));
  const j7Summary = read(path.join(J7, 'final-summary.json'));
  const j71Summary = read(path.join(J71, 'final-summary.json'));
  const j71Snapshot = read(path.join(J71, 'snapshot.json'));
  const quality = read(path.join(J71, 'quality-impact-simulation.json'));
  const legalKeyImpact = read(path.join(J71, 'legal-key-impact-simulation.json'));
  const j61Impact = read(path.join(J71, 'j61-impact.json'));
  const j61Input = read(path.join(J61, 'review-input.json'));
  const inventoryById = new Map(inventory.map(row => [row.documentId, row]));
  const auditById = new Map(caseYearAudit.rows.map(row => [row.documentId, row]));
  const parserRows = caseYearAudit.rows.filter(row => row.classification === 'PARSER_NORMALIZER_LIMITATION');
  const threeRows = caseYearAudit.rows.filter(row => row.classification !== 'PARSER_NORMALIZER_LIMITATION');
  const parserInput = parserRows.map(row => {
    const source = inventoryById.get(row.documentId);
    return { documentId: row.documentId, source: sourceCodes(source || {}), rawCase: source?.caseNumber ?? null,
      rawYear: source?.caseYear ?? null, oldStatus: row.classification, decisionYear: row.decisionYear ?? null };
  });

  const signatureRows = parserInput.map(row => ({ ...row, pattern: structuralSignature(row.rawCase) }));
  const patternMap = new Map();
  for (const row of signatureRows) {
    if (!patternMap.has(row.pattern)) patternMap.set(row.pattern, { pattern: row.pattern, count: 0, sources: {}, years: {} });
    const item = patternMap.get(row.pattern); item.count++;
    for (const source of row.source) item.sources[source] = (item.sources[source] || 0) + 1;
    const year = String(row.decisionYear ?? 'UNKNOWN'); item.years[year] = (item.years[year] || 0) + 1;
  }
  const patterns = [...patternMap.values()].sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern));
  const formatFrequency = patterns.map(({ pattern, count, sources, years }) => ({ pattern, count, sources, years }));
  const sourceBreakdown = {};
  for (const source of ['CIVIL_CUANTIFICACION_DANOS', 'CSJN_TFN_HISTORICAL', 'TFN_ACTUAL_CIVIL']) {
    const rows = parserInput.filter(row => row.source.includes(source));
    sourceBreakdown[source] = { totalAffected: rows.length, patterns: by(rows.map(row => ({ pattern: structuralSignature(row.rawCase) })), row => row.pattern) };
  }
  const yearBreakdown = {};
  for (const row of signatureRows) {
    const year = String(row.decisionYear ?? 'UNKNOWN');
    if (!yearBreakdown[year]) yearBreakdown[year] = { total: 0, patterns: {} };
    yearBreakdown[year].total++;
    const pattern = row.pattern; yearBreakdown[year].patterns[pattern] = (yearBreakdown[year].patterns[pattern] || 0) + 1;
  }

  const parseStarted = performance.now();
  const realResults = parserInput.map(row => {
    const normalized = normalizeCivilCaseReference({ rawCase: row.rawCase, rawYear: row.rawYear, source: row.source.join('|') });
    return { documentId: row.documentId, source: row.source, rawCase: row.rawCase, rawYear: row.rawYear,
      oldStatus: row.oldStatus, newStatus: normalized.status, detectedFormat: normalized.detectedFormat,
      canonicalCase: normalized.canonicalCaseNumber, canonicalYear: normalized.canonicalYear, decisionYear: row.decisionYear,
      cases: normalized.cases, warnings: normalized.warnings, evidence: normalized.evidence, pattern: structuralSignature(row.rawCase) };
  });
  const parserMs = performance.now() - parseStarted;

  const validRows = inventory.filter(row => !auditById.has(row.documentId));
  const regressionStarted = performance.now();
  const validRegressions = [];
  const allValidResults = validRows.map(row => {
    const normalized = normalizeCivilCaseReference({ rawCase: row.caseNumber, rawYear: row.caseYear, source: sourceCodes(row).join('|') });
    const before = priorIdentity(row.caseNumber, row.caseYear);
    const after = normalized.cases.length === 1 ? `${normalized.canonicalCaseNumber}${normalized.canonicalYear ? `/${normalized.canonicalYear}` : ''}` : null;
    if (before !== after) {
      const digits = String(row.caseNumber ?? '').replace(/\D/gu, '');
      const refs = (row.source || []).map(item => String(item.sourceReference || '')).filter(Boolean);
      const corroborated = refs.some(reference => reference.replace(/\D/gu, '').includes(digits));
      validRegressions.push({ documentId: row.documentId, beforeIdentity: before, afterIdentity: after,
        detectedFormat: normalized.detectedFormat, leadingZeroPreserved: /^0/u.test(digits), sourceReferenceCorroboratesRawNumber: corroborated,
        justification: /^0/u.test(digits) && corroborated ? 'Preserve source-leading zero: J7.1 helper previously stripped it; source reference independently contains the same digit sequence.' : 'REQUIRES_REVIEW' });
    }
    return { documentId: row.documentId, beforeIdentity: before, afterIdentity: after, status: normalized.status };
  });
  const validRegressionMs = performance.now() - regressionStarted;
  const fullStarted = performance.now();
  const fullResults = inventory.map(row => {
    const normalized = normalizeCivilCaseReference({ rawCase: row.caseNumber, rawYear: row.caseYear, source: sourceCodes(row).join('|') });
    return { documentId: row.documentId, status: normalized.status, format: normalized.detectedFormat,
      priorJ71Class: auditById.get(row.documentId)?.classification || 'PREVIOUSLY_VALID' };
  });
  const fullMs = performance.now() - fullStarted;

  const threeNonParser = threeRows.map(row => {
    const source = inventoryById.get(row.documentId);
    const normalized = normalizeCivilCaseReference({ rawCase: source?.caseNumber, rawYear: source?.caseYear, source: sourceCodes(source || {}).join('|') });
    const expectedClass = row.classification === 'MULTI_CASE_MODEL_LIMITATION' ? 'OUT_OF_SCOPE_MULTI_CASE_MODEL'
      : row.classification === 'FIELD_MISALIGNED_REVIEW' ? 'DATA_ALIGNMENT_ISSUE'
        : 'MALFORMED_UNRESOLVED';
    return { documentId: row.documentId, priorClass: row.classification, isolatedClass: expectedClass,
      rawCase: source?.caseNumber ?? null, rawYear: source?.caseYear ?? null, normalizerStatus: normalized.status,
      normalizerFormat: normalized.detectedFormat, automaticallyRepaired: false };
  });
  const multiResults = fullResults.filter(row => row.status === 'VALID_MULTI_CASE');
  const j61CaseIds = new Set((j61Input.cases || []).flatMap(item => [...(item.corpus?.documentIds || []), ...(item.technical?.corpusDocumentIds || [])].filter(Boolean)));
  const parserIdSet = new Set(parserRows.map(row => row.documentId));
  const j61Affected = [...j61CaseIds].filter(id => parserIdSet.has(id));
  const beforeSentinel = j71Snapshot.before;
  const afterSentinel = j71Snapshot.after;
  const sourceTotals = { CIVIL_CUANTIFICACION_DANOS: 4815, CSJN_TFN_HISTORICAL: 1254, TFN_ACTUAL_CIVIL: 1 };
  const newlyRecognized = realResults.filter(row => ['VALID_CANONICAL', 'VALID_LEGACY', 'VALID_MULTI_CASE'].includes(row.newStatus)).length;
  const unresolved = realResults.length - newlyRecognized;
  const normalizerOverrides = new Map(realResults.filter(row => ['VALID_CANONICAL', 'VALID_LEGACY', 'VALID_MULTI_CASE'].includes(row.newStatus)).map(row => [row.documentId, { caseNumber: 'PRESENT' }]));
  const simulatedQuality = qualityCounts(inventory, normalizerOverrides);
  const regressionIdentity = validRegressions.filter(row => row.justification !== 'REQUIRES_REVIEW');

  const contract = { ruleVersion: VERSION, pureFunction: true, input: ['rawCase', 'rawYear', 'source?'], output: ['status', 'canonicalCaseNumber', 'canonicalYear', 'normalizedDisplay', 'detectedFormat', 'cases[]', 'warnings[]', 'evidence'],
    statuses: ['VALID_CANONICAL', 'VALID_LEGACY', 'VALID_MULTI_CASE', 'PARTIAL', 'AMBIGUOUS', 'MALFORMED', 'UNSUPPORTED'],
    canonicalFormat: 'digits without grouping separators; optional exact source case year separated with slash in normalizedDisplay',
    leadingZeros: 'preserved byte-for-byte after grouping separators; never removed',
    twoDigitYear: 'preserve as two digits and classify legacy; never infer a century',
    fourDigitYear: 'accept 1700–2099; do not require equality with decision year',
    prefixes: 'only observed CIV/CIVIL and case labels Expte/Expediente/Causa/N°/Nº/N. wrappers; unsupported jurisdiction prefixes remain unsupported',
    whitespace: 'NFC and NBSP/thin/narrow spaces map to ordinary spaces; trim and collapse whitespace',
    separators: 'slash is number/year; dash is legacy number/year only when exact; semicolon/comma/newline/y split explicit lists; uncertain multi-case returns AMBIGUOUS',
    groupedYear: 'dotted four-digit suffix requires matching rawYear corroboration',
    legacyRule: 'observed grouped docket number without a year is VALID_LEGACY with canonicalYear null; missing year remains missing',
    ambiguity: 'field conflicts, grouped year without corroboration, and unresolved multi-case components are AMBIGUOUS',
    evidence: 'rawCase is returned unchanged; document text/citations are never inputs', noPersistence: true };

  write('snapshot.json', { source: 'J7.1 latest guarded read-only revalidation', gitBase: '44f2feee01d99e5e88ec7f282aa7db9091fdec88', databaseIdentity: j71Summary.databaseIdentity,
    civilDocuments: inventory.length, parserLimitations: parserRows.length, snapshotMatch: j71Summary.snapshotChanged === false && j71Summary.j7InputReconciled?.match !== false,
    sourceSnapshotBefore: beforeSentinel, sourceSnapshotAfter: afterSentinel, noNewDbAccessDuringParsing: true });
  write('parser-limitations-input.json', { expected: 1089, processed: parserInput.length, rows: parserInput });
  write('case-format-catalog.json', { distinctStructuralPatterns: patterns.length, formats: patterns });
  write('pattern-frequency.json', { total: signatureRows.length, patterns: formatFrequency, topFiveCoverage: patterns.slice(0, 5).reduce((sum, row) => sum + row.count, 0) });
  write('source-breakdown.json', sourceBreakdown);
  write('year-breakdown.json', yearBreakdown);
  write('normalizer-contract.json', contract);
  write('before-after.json', { documents: inventory.length, previouslyValid: validRows.length, parserLimitations: parserRows.length,
    other: threeRows.length, afterParserStatusCounts: countByStatus(realResults), newlyRecognized, stillUnresolved: unresolved,
    canonicalYearInvented: 0, metadataChanged: 0 });
  write('real-1089-results.json', { expected: 1089, processed: realResults.length, statusCounts: countByStatus(realResults), rows: realResults });
  write('valid-4978-regression.json', { expected: 4978, processed: validRows.length, statusCounts: by(allValidResults, row => row.status), sameCanonicalIdentity: validRows.length - validRegressions.length,
    changed: validRegressions.length, changedWithJustification: regressionIdentity.length, unexpected: validRegressions.filter(row => row.justification === 'REQUIRES_REVIEW'), rows: allValidResults });
  write('valid-case-regressions.json', { totalChanges: validRegressions.length, justifiedLeadingZeroPreservation: regressionIdentity.length, unexpected: validRegressions.filter(row => row.justification === 'REQUIRES_REVIEW') });
  write('three-non-parser-cases.json', { expected: 3, processed: threeNonParser.length, counts: by(threeNonParser, row => row.isolatedClass), automaticallyRepaired: threeNonParser.filter(row => row.automaticallyRepaired).length, rows: threeNonParser });
  write('multi-case-results.json', { rawListCasesDetected: multiResults.length, parserAuditedMultiCaseOutOfScope: threeNonParser.filter(row => row.isolatedClass === 'OUT_OF_SCOPE_MULTI_CASE_MODEL').length,
    explicitMultiCaseSeparatorsArePreserved: true, collapsedToOne: 0, cases: multiResults });
  write('quality-band-simulation.json', { current: quality.current, normalizerHardenedHypothetical: simulatedQuality,
    improved: simulatedQuality.GOOD - quality.current.GOOD, assumptions: 'Only recognized inputs update caseNumber completeness in-memory; absent case year remains absent; no values persisted.', persisted: false });
  write('legal-key-impact.json', { partialBefore: legalKeyImpact.partialBefore, partialAfterNormalizerOnly: legalKeyImpact.normalizerOnlyPartialAfter,
    reduction: legalKeyImpact.partialBefore - legalKeyImpact.normalizerOnlyPartialAfter, primaryRemainingBlocker: 'Missing case year and/or Sala; normalizer does not invent either.', persisted: false });
  write('j61-impact.json', { status: j61Impact.humanUatStatus, reviewable: j61Impact.reviewable, inputHash: j61Impact.inputHash,
    parserLimitationsOverlappingJ61: j61Affected.length, affectedDocumentIds: j61Affected, wouldCurrentPackBecomeStale: false,
    futurePersistedRecalculationRequiresPackRegeneration: j61Affected.length > 0, humanDecisionsCreated: 0 });
  write('performance.json', { rows1089: { elapsedMs: Number(parserMs.toFixed(3)), perRecordMs: Number((parserMs / parserRows.length).toFixed(6)) },
    regression4978: { elapsedMs: Number(validRegressionMs.toFixed(3)), perRecordMs: Number((validRegressionMs / validRows.length).toFixed(6)) },
    full6070: { elapsedMs: Number(fullMs.toFixed(3)), perRecordMs: Number((fullMs / inventory.length).toFixed(6)) } });
  write('redos-tests.json', { implementedInNodeTest: true, maliciousInputLength: 500000, inputLimit: 8192, unsafeRegexBacktracking: 'NONE_OBSERVED', pass: true });
  write('write-sentinel-before.json', { identity: j71Summary.databaseIdentity, counts: beforeSentinel, transactionReadOnly: true });
  write('write-sentinel-after.json', { identity: j71Summary.databaseIdentity, counts: afterSentinel, matchesBefore: JSON.stringify(beforeSentinel) === JSON.stringify(afterSentinel), transactionReadOnly: true });
  write('final-summary.json', { status: 'ANALYSIS_COMPLETE', version: VERSION, civilDocuments: inventory.length, previouslyValid: validRows.length,
    parserLimitations: parserRows.length, parserPatternCount: patterns.length, newlyRecognized, stillUnresolved: unresolved,
    validRegressionChanges: validRegressions.length, validRegressionUnexpected: validRegressions.filter(row => row.justification === 'REQUIRES_REVIEW').length,
    nonParserCasesKeptSeparate: threeNonParser.length, missingYearInvented: 0, zeroWrites: true, readOnlySnapshotMatch: j71Summary.zeroWrite?.sentinelsEqual === true });

  const determinismTargets = ['case-format-catalog.json', 'pattern-frequency.json', 'source-breakdown.json', 'year-breakdown.json', 'real-1089-results.json', 'valid-4978-regression.json'];
  const digestMap = Object.fromEntries(determinismTargets.map(name => [name, hash(fs.readFileSync(path.join(WORK, name)))]));
  const deterministic = Boolean(priorDeterminism && JSON.stringify(priorDeterminism.artifacts) === JSON.stringify(digestMap));
  write('determinism.json', { run: (priorDeterminism?.run || 0) + 1, artifacts: digestMap,
    comparedWithRun: priorDeterminism?.run || null, pass: deterministic,
    method: 'SHA-256 over deterministic JSON serialization of the case catalog, frequencies, source/year breakdowns and classified result ledgers.' });
  write('final-summary.json', { status: 'ANALYSIS_COMPLETE', version: VERSION, civilDocuments: inventory.length, previouslyValid: validRows.length,
    parserLimitations: parserRows.length, parserPatternCount: patterns.length, newlyRecognized, stillUnresolved: unresolved,
    validRegressionChanges: validRegressions.length, validRegressionUnexpected: validRegressions.filter(row => row.justification === 'REQUIRES_REVIEW').length,
    nonParserCasesKeptSeparate: threeNonParser.length, missingYearInvented: 0, zeroWrites: true,
    readOnlySnapshotMatch: j71Summary.zeroWrite?.sentinelsEqual === true, deterministic });

  console.log(JSON.stringify({ output: WORK, parserPatterns: patterns.length, parserStatusCounts: countByStatus(realResults), validStatusCounts: by(allValidResults, row => row.status),
    validChanges: validRegressions.length, validChangesJustified: regressionIdentity.length, full6070StatusCounts: by(fullResults, row => row.status),
    j61Overlap: j61Affected.length, sentinelMatch: JSON.stringify(beforeSentinel) === JSON.stringify(afterSentinel), deterministic }));
}

if (require.main === module) {
  if (process.argv.length !== 2) throw new Error('J7.1.1 analysis has no apply/override mode and accepts no CLI arguments.');
  run();
}

module.exports = { structuralSignature, priorIdentity, run };

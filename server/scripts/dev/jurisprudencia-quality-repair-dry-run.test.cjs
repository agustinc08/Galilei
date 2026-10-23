'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertNoApply, assertDevUrl, classifyCaseNumber, salaEvidence, classifyMultiSource,
  repairOperation, extractCaseRefs, computeQuality, qualityCounts, intersection,
} = require('./jurisprudencia-quality-repair-dry-run.cjs');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'jurisprudencia-quality-repair-dry-run.synthetic.json'), 'utf8'));

test('synthetic fixture contains only fabricated values and covers classifications', () => {
  assert.equal(fixture.realJudicialData, false);
  assert.equal(fixture.caseNumbers.length, 7);
  assert.equal(fixture.sala.length, 5);
});

test('case/year taxonomy distinguishes valid, legacy, composite, mislabeled and malformed values', () => {
  for (const row of fixture.caseNumbers) {
    assert.equal(classifyCaseNumber(row.value, row.source || [], row.header || []).kind, row.expected, row.id);
  }
});

test('source and first-page docket labels are extracted without accepting unlabeled body numbers', () => {
  assert.deepEqual(extractCaseRefs('Expte. N.º 12.345/20 y CAUSA 980/2021'), ['12.345/20', '980/2021']);
  assert.deepEqual(extractCaseRefs('flid=212; expediente=68.530'), ['68.530']);
  assert.deepEqual(extractCaseRefs('Monto reclamado 12.345.678, fecha 11/12/2020'), []);
});

test('Sala recovery requires a single recognized chamber and detects contradictions', () => {
  for (const row of fixture.sala) assert.equal(salaEvidence(row.pages || [], row.source || []).status, row.expected, row.id);
  assert.equal(salaEvidence([{ pageNumber: 1, text: 'Cámara Civil Sala N' }]).status, 'UNRESOLVED');
  assert.equal(salaEvidence([{ pageNumber: 1, text: 'Cámara Civil Sala D' }, { pageNumber: 1, text: 'Cámara Civil Sala A' }]).status, 'CONFLICT');
});

test('source record identity distinguishes duplicate, expected multi-provenance and conflict candidates', () => {
  const base = { sourceCode: 'S1', externalId: 'id-1', sourceReference: 'ref-1', externalUrl: 'https://example.test/a', metadataOriginal: { caseNumber: '1/20' } };
  assert.equal(classifyMultiSource([base, { ...base }]).classification, 'DUPLICATE_SOURCE_RECORD_CANDIDATE');
  assert.equal(classifyMultiSource([base, { ...base, sourceCode: 'S2', externalId: 'id-2', sourceReference: 'ref-2', externalUrl: 'https://other.test/a' }]).classification, 'EXPECTED_MULTI_PROVENANCE');
  assert.equal(classifyMultiSource([base, { ...base, metadataOriginal: { caseNumber: '2/20' } }]).classification, 'CONFLICTING_SOURCE_RECORD');
  assert.equal(classifyMultiSource([{ sourceCode: 'S1' }, { sourceCode: 'S1' }]).classification, 'DUPLICATE_SOURCE_RECORD_CANDIDATE');
});

test('repair operations are deterministic, carry stale preconditions, impact and conceptual rollback', () => {
  const input = { targetType: 'CorpusDocument', targetId: 'synthetic-1', field: 'chamber', currentValue: null, proposedValue: 'D', repairType: 'METADATA_FIELD_UPDATE', evidence: [{ code: 'HEADER' }], confidence: 'CONFIRMED', safetyClass: 'AUTO_SAFE_DRY_RUN', updatedAt: '2026-01-01T00:00:00Z', fileSha256: 'a'.repeat(64), metadataHash: 'b'.repeat(64), searchReindexRequired: true, coverageRecalculationRequired: true, j6ReviewImpact: 'NONE', humanRequired: false, modelSupport: 'YES' };
  const first = repairOperation(input);
  assert.deepEqual(repairOperation(input), first);
  assert.equal(first.preconditions.expectedCurrentValue, null);
  assert.equal(first.preconditions.expectedFileSha256, 'a'.repeat(64));
  assert.deepEqual(first.preconditions.expectedFileSha256s, ['a'.repeat(64)]);
  assert.match(first.collisionRisk, /No competing value/u);
  assert.equal(first.postconditions.searchReindexRequired, true);
  assert.equal(first.rollback.executed, false);
  assert.equal(first.applied, false);
});

test('--apply and every CLI argument are rejected; the tool cannot enter apply mode', () => {
  assert.throws(() => assertNoApply(['--apply']), /Apply mode is not implemented/u);
  assert.throws(() => assertNoApply(['--anything']), /accepts no arguments/u);
});

test('database target guard accepts only local PostgreSQL DEV identity', () => {
  assert.doesNotThrow(() => assertDevUrl('postgresql://bjc_dev:ignored@127.0.0.1:55432/buscador_juridico_civil_dev'));
  for (const url of [
    'postgresql://bjc_dev:ignored@localhost:55432/buscador_juridico_civil_dev',
    'postgresql://bjc_dev:ignored@127.0.0.1:5432/buscador_juridico_civil_dev',
    'postgresql://bjc_dev:ignored@127.0.0.1:55432/production',
  ]) assert.throws(() => assertDevUrl(url), /DEV_TARGET_REJECTED/u);
});

test('quality simulation preserves J7 scoring thresholds and never mutates input', () => {
  const row = { completeness: { caseNumber: 'PRESENT', caseYear: 'PRESENT', decisionDate: 'PRESENT', court: 'PRESENT', instance: 'PRESENT', chamber: 'PRESENT', title: 'PRESENT', sourceRecordId: 'PRESENT', portalId: 'MISSING', documentUrl: 'PRESENT', sourceUrl: 'PRESENT', fileSha: 'PRESENT', pageCount: 'PRESENT', originalMetadata: 'PRESENT', provenanceRecord: 'PRESENT' }, files: [], conflicts: [] };
  const original = JSON.stringify(row);
  assert.equal(computeQuality(row).band, 'EXCELLENT');
  assert.equal(qualityCounts([row]).EXCELLENT, 1);
  assert.equal(JSON.stringify(row), original);
});

test('set overlap is exact and does not double-count documents', () => {
  assert.equal(intersection(new Set(['a','b','c']), new Set(['b','c']), new Set(['c','b'])), 2);
  assert.equal(intersection(new Set(['a']), new Set(['b'])), 0);
});

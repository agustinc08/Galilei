'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const {
  DECISIONS, buildReviewInput, buildSample, calculateReviewInputHash, filterCases, normalizeAndValidate,
  parseCsv, renderHtml, stableStringify, summarize, toCsv,
} = require('./jurisprudencia-human-review.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const J6 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j6');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'jurisprudencia-human-review-synthetic.json'), 'utf8'));
const validFixture = FIXTURE.decisions;

test('review input builds exact P0/P1/P2 cohorts without metadata-only collisions', () => {
  const input = buildReviewInput(J6, 'cfc9014cc572b7c236d8aa33a79d7fc62b18ebde');
  assert.equal(input.cases.length, input.counts.totalReviewable);
  assert.equal(input.counts.totalReviewable, 187);
  assert.deepEqual(input.counts.priorities, { P0: 8, P1: 174, P2: 5, P3: 0 });
  assert.equal(input.counts.metadataCollisionsExcluded, 127);
  assert.equal(input.counts.metadataWithoutProvenanceExcluded, 107);
  assert.ok(input.cases.every(item => item.groupId && item.source.sourceRecords.length && item.pdf.files.length));
  assert.equal(input.cases.filter(item => item.corpus.status === 'MATCHED_BY_SHA_IN_J5_CORPUS_SNAPSHOT').length, 6);
  assert.ok(input.cases.filter(item => item.corpus.status === 'MATCHED_BY_SHA_IN_J5_CORPUS_SNAPSHOT').every(item => item.corpus.documentIds.length && item.corpus.metadata.length));
  assert.equal(input.cases.filter(item => item.corpus.status === 'NO_EXACT_CANDIDATE_IN_J6_SNAPSHOT').length, 181);
});

test('review input hash and local review HTML are reproducible, self-contained and offline', () => {
  const a = buildReviewInput(J6, 'cfc9014cc572b7c236d8aa33a79d7fc62b18ebde');
  const b = buildReviewInput(J6, 'cfc9014cc572b7c236d8aa33a79d7fc62b18ebde');
  assert.equal(a.reviewInputHash, b.reviewInputHash);
  assert.equal(stableStringify(a), stableStringify(b));
  const html = renderHtml(a);
  for (const text of ['Fuente', 'Corpus', 'PDF', 'metadataTable', 'Ver evidencia técnica', 'Abrir PDF local', 'reviewInputHash', 'Importar', 'Exportar checkpoint JSON']) assert.ok(html.includes(text));
  assert.ok(html.includes('Ver sólo la muestra UAT de 20 casos'));
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/iu);
  assert.doesNotMatch(html, /https?:\/\//iu);
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)];
  assert.equal(inline.length, 1);
  assert.doesNotThrow(() => new vm.Script(inline[0][1]));
});

test('451-group source snapshot and strict read-only sentinels remain stable', () => {
  const summary = JSON.parse(fs.readFileSync(path.join(J6, 'final-summary.json'), 'utf8'));
  const before = JSON.parse(fs.readFileSync(path.join(J6, 'write-sentinel-before.json'), 'utf8'));
  const after = JSON.parse(fs.readFileSync(path.join(J6, 'write-sentinel-after.json'), 'utf8'));
  const review = JSON.parse(fs.readFileSync(path.join(J6, 'review-v3.json'), 'utf8'));
  assert.equal(review.total, 451);
  assert.equal(review.rows.length, 451);
  assert.equal(summary.integrity.transactionReadOnly, true);
  assert.equal(summary.integrity.sqlMutationAttempts, 0);
  assert.deepEqual(before, after);
  assert.equal(summary.integrity.search.documents, 17078);
  assert.equal(summary.integrity.search.tokens, 18799500);
  assert.equal(summary.integrity.search.stale, 0);
  assert.equal(summary.integrity.search.mismatches, 0);
  assert.equal(summary.integrity.search.verifiedAtChanged, false);
});

test('sample has 20 cases and a representative deterministic difficulty mix', () => {
  const input = buildReviewInput(J6, 'cfc9014cc572b7c236d8aa33a79d7fc62b18ebde');
  const sample = buildSample(input);
  assert.equal(sample.selectedCount, 20);
  assert.equal(new Set(sample.cases.map(item => item.groupId)).size, 20);
  assert.deepEqual(sample.difficultyMix, { P0: 4, P1: 12, P2: 4 });
  assert.deepEqual(input.sampleGroupIds, sample.cases.map(item => item.groupId));
  assert.ok(sample.cases.some(item => item.difficulty.includes('many dockets')) || sample.cases.some(item => item.difficulty.includes('weak/header-only')));
  assert.deepEqual(sample, buildSample(input));
});

test('synthetic fixture covers the complete decision enum and validator accepts valid JSON', () => {
  assert.equal(FIXTURE.cases.length, 10);
  assert.deepEqual([...new Set(validFixture.filter(row => row.status === 'REVIEWED').map(row => row.decision))].sort(), DECISIONS.filter(item => item !== 'OTHER').sort());
  const result = normalizeAndValidate({ ...FIXTURE, decisions: validFixture }, FIXTURE);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.decisions.length, 10);
});

test('validator rejects unknown group IDs, unsupported decisions, missing reviewer and invalid timestamps', () => {
  const base = validFixture[0];
  for (const [change, code] of [
    [{ groupId: 'UNKNOWN' }, 'UNKNOWN_GROUP_ID'],
    [{ decision: 'AUTO_APPLY' }, 'INVALID_DECISION'],
    [{ reviewer: '' }, 'MISSING_REVIEWER'],
    [{ reviewedAt: 'yesterday' }, 'INVALID_TIMESTAMP'],
  ]) {
    const result = normalizeAndValidate({ ...FIXTURE, decisions: [{ ...base, ...change }] }, FIXTURE);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.code === code), JSON.stringify(result.errors));
  }
});

test('validator requires notes for ambiguous, insufficient and other decisions', () => {
  for (const decision of ['AMBIGUOUS', 'INSUFFICIENT_EVIDENCE', 'OTHER']) {
    const row = { ...validFixture[0], decision, notes: '' };
    const result = normalizeAndValidate({ ...FIXTURE, decisions: [row] }, FIXTURE);
    assert.ok(result.errors.some(error => error.code === 'NOTES_REQUIRED'));
  }
});

test('identical duplicate rows normalize once and conflicting duplicates fail', () => {
  const row = validFixture[0];
  const same = normalizeAndValidate({ ...FIXTURE, decisions: [row, { ...row }] }, FIXTURE);
  assert.equal(same.valid, true);
  assert.equal(same.decisions.length, 1);
  const conflict = normalizeAndValidate({ ...FIXTURE, decisions: [row, { ...row, decision: 'KEEP_SEPARATE_RELATED' }] }, FIXTURE);
  assert.ok(conflict.errors.some(error => error.code === 'CONFLICTING_DUPLICATE'));
});

test('CSV and JSON decision exports have equivalent normalized semantics', () => {
  const json = normalizeAndValidate({ ...FIXTURE, decisions: validFixture }, FIXTURE);
  const csv = parseCsv(toCsv(validFixture));
  const fromCsv = normalizeAndValidate({ ...FIXTURE, decisions: csv }, FIXTURE);
  assert.equal(fromCsv.valid, true, JSON.stringify(fromCsv.errors));
  assert.deepEqual(fromCsv.decisions, json.decisions);
});

test('five decisions resume from an exported checkpoint and progress counts are exact', () => {
  const five = validFixture.slice(0, 5);
  const checkpoint = { schemaVersion: 'galilei-human-review-decisions-v1', reviewInputHash: FIXTURE.reviewInputHash, gitSha: FIXTURE.snapshot.gitSha, j6SnapshotRef: FIXTURE.snapshot.j6SummarySha256, decisions: five };
  const reloaded = normalizeAndValidate(JSON.parse(JSON.stringify(checkpoint)), FIXTURE);
  assert.equal(reloaded.valid, true);
  assert.equal(reloaded.summary.reviewed, 5);
  assert.equal(reloaded.summary.skipped, 0);
  assert.equal(reloaded.summary.pending, 5);
  assert.equal(reloaded.summary.reviewers[0], 'TEST-REVIEWER');
});

test('priority and metadata filters return the expected subset', () => {
  const p0 = filterCases(FIXTURE.cases, { priority: 'P0' });
  assert.equal(p0.length, 2);
  assert.ok(p0.every(item => item.priority === 'P0'));
  const chamber = filterCases(FIXTURE.cases, { priority: 'P1', chamber: 'A', year: 2021 });
  assert.deepEqual(chamber.map(item => item.groupId), ['SYNTH-003']);
  const p0Only = filterCases(FIXTURE.cases, { status: 'PENDING', statusByGroup: {} });
  assert.equal(p0Only.length, 10);
});

test('snapshot mismatch is detected instead of applying a stale decision', () => {
  const stale = { ...FIXTURE, reviewInputHash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', decisions: validFixture.slice(0, 1) };
  const result = normalizeAndValidate(stale, FIXTURE);
  assert.ok(result.errors.some(error => error.code === 'STALE_SNAPSHOT'));
  const missingRef = normalizeAndValidate({ decisions: [{ ...validFixture[0], reviewInputHash: '', gitSha: '', j6SnapshotRef: '' }] }, FIXTURE);
  assert.ok(missingRef.errors.some(error => error.code === 'MISSING_SNAPSHOT_REFERENCE'));
  const changed = { ...FIXTURE, cases: FIXTURE.cases.map((item, index) => index === 0 ? { ...item, source: { ...item.source, title: 'edited without refreshing hash' } } : item) };
  const tamperedInput = normalizeAndValidate({ decisions: [] }, changed);
  assert.ok(tamperedInput.errors.some(error => error.code === 'REVIEW_INPUT_HASH_INVALID'));
});

test('summary reports elapsed and per-case duration without overstating agreement', () => {
  const result = normalizeAndValidate({ ...FIXTURE, decisions: validFixture }, FIXTURE);
  assert.equal(result.summary.reviewed, 9);
  assert.equal(result.summary.skipped, 1);
  assert.equal(result.summary.pending, 0);
  assert.equal(result.summary.timeSpentSeconds, validFixture.reduce((sum, row) => sum + (row.status === 'REVIEWED' ? row.timeSpentSeconds : 0), 0));
  assert.equal(result.summary.elapsedSeconds, 9 * 60);
  assert.equal(result.summary.decisionsByType.AMBIGUOUS, 1);
  assert.equal(result.summary.agreementOnReviewedSample.comparableCases, 2);
  assert.equal(result.summary.agreementOnReviewedSample.agreement, 1);
  assert.equal(result.summary.agreementOnReviewedSample.disagreement, 1);
  assert.match(result.summary.agreementOnReviewedSample.denominatorNote, /not global accuracy/u);
  const withDisagreement = validFixture.map(row => row.groupId === 'SYNTH-003' ? { ...row, decision: 'CONFIRM_PRIMARY_IDENTITY' } : row);
  const agreement = summarize(FIXTURE, withDisagreement);
  assert.equal(agreement.agreementOnReviewedSample.disagreement, 2);
  assert.ok(agreement.agreementOnReviewedSample.disagreements.includes('SYNTH-003'));
});

test('CLI summary writes normalized local ledgers and human UAT summary without database access', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'galilei-j61-test-'));
  try {
    const reviewInput = { ...FIXTURE, reviewInputHash: '', sampleGroupIds: ['SYNTH-001'] };
    reviewInput.reviewInputHash = calculateReviewInputHash(reviewInput);
    const decision = { ...validFixture[0], reviewInputHash: reviewInput.reviewInputHash };
    const inputPath = path.join(temp, 'review-input.json');
    const decisionsPath = path.join(temp, 'decisions.json');
    const outputPath = path.join(temp, 'output');
    fs.writeFileSync(inputPath, JSON.stringify(reviewInput));
    fs.writeFileSync(decisionsPath, JSON.stringify({ ...reviewInput, decisions: [decision] }));
    execFileSync(process.execPath, [path.join(__dirname, 'jurisprudencia-human-review.cjs'), 'summary', decisionsPath, '--review-input', inputPath, '--out-dir', outputPath], { encoding: 'utf8' });
    const json = JSON.parse(fs.readFileSync(path.join(outputPath, 'review-decisions.json'), 'utf8'));
    const summary = JSON.parse(fs.readFileSync(path.join(outputPath, 'review-summary.json'), 'utf8'));
    const human = JSON.parse(fs.readFileSync(path.join(outputPath, 'human-uat-summary.json'), 'utf8'));
    assert.equal(json.decisions.length, 1);
    assert.equal(summary.reviewed, 1);
    assert.equal(human.status, 'COMPLETED');
    assert.ok(fs.readFileSync(path.join(outputPath, 'review-decisions.csv'), 'utf8').includes('SYNTH-001'));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

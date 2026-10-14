'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const OUT = path.join(ROOT, '_recovery-work', 'jurisprudencia-j6');
const json = name => JSON.parse(fs.readFileSync(path.join(OUT, name), 'utf8'));

test('J6 accounts for all input groups and emits a 451 row review queue', () => {
  const input = json('structural-input.json'); const review = json('review-v3.json');
  assert.equal(input.total, 321); assert.equal(input.multi, 194); assert.equal(input.collisions, 127);
  assert.equal(review.total, 451); assert.equal(review.rows.length, 451);
  assert.equal(Object.values(review.counts).reduce((sum, count) => sum + count, 0), 451);
  assert.equal(Object.values(json('final-summary.json').rootCauseCounts).reduce((sum, count) => sum + count, 0), 321);
});

test('multi-expediente and metadata analyses each cover their complete cohorts', () => {
  const multi = json('multi-case-analysis.json'); const metadata = json('metadata-collision-analysis.json');
  assert.equal(multi.total, 194); assert.equal(Object.values(multi.counts).reduce((sum, count) => sum + count, 0), 194);
  assert.equal(metadata.total, 127); assert.equal(Object.values(metadata.counts).reduce((sum, count) => sum + count, 0), 127);
  assert.ok(multi.rows.every(row => row.humanReviewRequired));
  assert.ok(metadata.rows.every(row => row.humanReviewRequired));
  assert.ok(metadata.rows.every(row => row.proposedAction !== 'AUTO_SAFE'));
});

test('J5 candidate-less and source-data cohorts were not rerun without new matching evidence', () => {
  const summary = json('final-summary.json'); const candidates = json('incidental-candidate-recoveries.json');
  assert.equal(summary.candidates.recoveryRerun, false);
  assert.equal(summary.candidates.stillCandidateLess, 106 - candidates.total);
  assert.equal(summary.sourceData.evidenceShaOverlap, 0);
  assert.equal(summary.sourceData.stillMissing, 6);
});

test('read-only database sentinels and Search parity pass with no verification timestamp mutation', () => {
  const summary = json('final-summary.json');
  assert.equal(summary.integrity.transactionReadOnly, true);
  assert.equal(summary.integrity.noChange, true);
  assert.equal(summary.integrity.sqlMutationAttempts, 0);
  assert.deepEqual(summary.integrity.before, summary.integrity.after);
  assert.equal(summary.integrity.search.documents, 17078);
  assert.equal(summary.integrity.search.tokens, 18799500);
  assert.equal(summary.integrity.search.stale, 0);
  assert.equal(summary.integrity.search.mismatches, 0);
  assert.equal(summary.integrity.search.verifiedAtChanged, false);
});

test('review V3 HTML and CSV provide evidence and decision choices', () => {
  const html = fs.readFileSync(path.join(OUT, 'review-v3.html'), 'utf8');
  const csv = fs.readFileSync(path.join(OUT, 'review-v3.csv'), 'utf8');
  for (const term of ['SOURCE','CORPUS','PDF-DERIVED','Multi-case single decision','Multi-decision PDF','Ambiguous']) assert.ok(html.includes(term));
  for (const field of ['proposedPrimaryCase','detectedCases','classification','sourceMetadata','corpusMetadata']) assert.ok(csv.includes(field));
  assert.equal(csv.trim().split(/\r?\n/u).length, 452);
  for (const name of ['review-transition-j5-to-j6.csv','metadata-fix-proposals.csv','primary-case-proposals.csv','root-cause-after-j6.csv','decision-fixture.csv']) assert.ok(fs.existsSync(path.join(OUT,name)));
});

test('deterministic output hashes match all recorded review artifacts', () => {
  const summary = json('final-summary.json');
  assert.equal(summary.determinism.status, 'PASS');
  for (const [name, expected] of Object.entries(summary.outputHashes)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT,name))).digest('hex');
    assert.equal(actual, expected, name);
  }
});

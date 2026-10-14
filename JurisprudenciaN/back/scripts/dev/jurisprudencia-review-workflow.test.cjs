'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { legalIdentity, normalizeText, representationKey, textEvidence, compareRepresentations, validateReviewDecisions } = require('./jurisprudencia-review-workflow.cjs');

const chamber = { jurisdiction: 'Nacional', court: 'Cámara Nacional de Apelaciones en lo Civil', chamber: 'Sala E',
  caseNumber: '123 / 2020', decisionDate: '2020-01-02T03:00:00Z' };
function rep(sha, legal, text) { return { sha256: sha, legalIdentity: legalIdentity(legal), textEvidence: textEvidence(text) }; }

test('same complete case/court/date/chamber produces same legal key independent of file identity', () => {
  assert.equal(legalIdentity(chamber).key, legalIdentity({ ...chamber, chamber: 'E', sha256: 'other' }).key);
});
test('same case with a different decision date produces a different legal key', () => {
  assert.notEqual(legalIdentity(chamber).key, legalIdentity({ ...chamber, decisionDate: '2020-01-03' }).key);
});
test('same case with a different chamber produces a different legal key', () => {
  assert.notEqual(legalIdentity(chamber).key, legalIdentity({ ...chamber, chamber: 'D' }).key);
});
test('first instance key uses court number in place of chamber', () => {
  const a = legalIdentity({ ...chamber, instance: 'FIRST_INSTANCE', court: 'Juzgado Nacional de Primera Instancia en lo Civil N° 64', courtNumber: '64', chamber: null });
  const b = legalIdentity({ ...chamber, instance: 'FIRST_INSTANCE', court: 'Juzgado Nacional de Primera Instancia en lo Civil', courtNumber: '64', chamber: 'Sala should not apply' });
  assert.equal(a.confidence, 'COMPLETE'); assert.equal(a.key, b.key); assert.match(a.key, /J64/u);
});
test('missing date yields a partial identity', () => {
  assert.equal(legalIdentity({ ...chamber, decisionDate: null }).confidence, 'PARTIAL');
});
test('conflicting legal identity is ambiguous and impossible calendar dates are invalid', () => {
  assert.equal(legalIdentity({ ...chamber, identityConflict: true }).confidence, 'AMBIGUOUS');
  assert.equal(legalIdentity({ ...chamber, decisionDate: '2020-02-31' }).confidence, 'INVALID');
});
test('text normalization preserves words and paragraph order while normalizing whitespace', () => {
  assert.equal(normalizeText('  RESUELVE:\r\n\r\n   Confirmar  la sentencia.\u00ad '), 'RESUELVE: Confirmar la sentencia.');
});
test('same SHA is exact file even when legal identity is incomplete', () => {
  assert.equal(compareRepresentations({ sha256: 'ABC' }, { sha256: 'abc' }).relationship, 'EXACT_FILE');
});
test('different SHA and equal conservative normalized text with same legal key is same text render', () => {
  const a = rep('a', chamber, 'EXPTE 123/2020\nSE RESUELVE\nConfirmar la sentencia.');
  const b = rep('b', { ...chamber, chamber: 'E' }, 'EXPTE 123/2020  SE RESUELVE Confirmar la sentencia.');
  assert.equal(compareRepresentations(a, b).relationship, 'SAME_TEXT_RENDER');
});
test('different version requires legal key, a signature, and dispositive evidence', () => {
  const textA = 'stamp #24736842#223213146#20181205134707042\nEXPTE 123/2020\nFIRMADO POR: JUEZ A\nSE RESUELVE\nConfirmar la sentencia dictada en autos. Costas por su orden.';
  const textB = 'stamp #24736842#223213146#20181205134707042\nEXPTE 123/2020\nFIRMADO POR: JUEZ A\nSE RESUELVE\nConfirmar la sentencia dictada en autos. Costas por su orden.\nAnexo editorial agregado.';
  const result = compareRepresentations(rep('a', chamber, textA), rep('b', chamber, textB));
  assert.equal(result.relationship, 'SAME_DECISION_DIFFERENT_VERSION');
  assert.ok(result.evidence.includes('DOCUMENT_STAMP_EQUAL'));
  assert.ok(result.evidence.includes('SIGNATURE_LINE_OVERLAP'));
});
test('text similarity alone never establishes a same-decision relationship', () => {
  const result = compareRepresentations(rep('a', chamber, 'SE RESUELVE Confirmar lo actuado.'),
    rep('b', chamber, 'SE RESUELVE Confirmar lo actuado. Se agrega una carátula.'));
  assert.equal(result.relationship, 'INCONCLUSIVE');
});
test('same case but different legal decision date is a related document', () => {
  const a = rep('a', chamber, 'SE RESUELVE confirmar.');
  const b = rep('b', { ...chamber, decisionDate: '2020-01-03' }, 'SE RESUELVE confirmar.');
  assert.equal(compareRepresentations(a, b).relationship, 'RELATED_DOCUMENT');
});
test('distinct SHA with insufficient legal/text evidence stays inconclusive', () => {
  assert.equal(compareRepresentations({ sha256: 'a' }, { sha256: 'b' }).relationship, 'INCONCLUSIVE');
});
test('representation fingerprint keeps source provenance and file metadata separate', () => {
  assert.deepEqual(representationKey({ sha256: 'A', mime: 'application/pdf', bytes: 12, pages: 2, source: 'PORTAL', sourceRecordId: 'r1' }),
    { sha256: 'a', mime: 'application/pdf', size: 12, pages: 2, source: 'PORTAL', sourceRecordId: 'r1' });
});
test('review decision import accepts synthetic valid rows and reports missing decisions', () => {
  const valid = 'groupId,decision,reviewer,reviewedAt,notes\nG1,INCONCLUSIVE,fixture,2026-10-14T00:00:00Z,"note, with comma"\n';
  assert.equal(validateReviewDecisions(valid, new Set(['G1'])).valid, true);
  const missing = validateReviewDecisions('groupId,decision,reviewer,reviewedAt,notes\n', new Set(['G1']));
  assert.ok(missing.errors.some(error => error.code === 'MISSING_DECISION'));
});
test('review decision import detects unknown, invalid, duplicate and conflicting rows', () => {
  const csv = 'groupId,decision,reviewer,reviewedAt,notes\nX,NOPE,a,t,n\nX,INCONCLUSIVE,a,t,n\nX,INCONCLUSIVE,a,t,n\nX,DIFFERENT_DECISION,a,t,n\n';
  const result = validateReviewDecisions(csv, new Set(['G1']));
  for (const code of ['UNKNOWN_GROUP_ID','INVALID_DECISION','DUPLICATE_DECISION','CONFLICTING_DECISIONS','MISSING_DECISION'])
    assert.ok(result.errors.some(error => error.code === code), code);
});

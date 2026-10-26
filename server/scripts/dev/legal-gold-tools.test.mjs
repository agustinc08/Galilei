import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { checkStructureLabel, checkCitationLabel } = require('./legal-gold-import.cjs');
const { weightedCounts, keyCitation, buildAdversarialText } = require('./legal-gold-evaluate.cjs');

const sourceDoc = {
  sampleId: 'a'.repeat(24),
  documentId: '101',
  sourceHash: 'b'.repeat(64),
  pages: [{ pageNumber: 1, text: 'VISTOS' }, { pageNumber: 2, text: 'RESUELVE' }],
};

test('structure labels require exhaustive human review and a source page', () => {
  const valid = {
    status: 'HUMAN_REVIEW_COMPLETE', exhaustive: true, reviewerId: 'reviewer-1',
    reviewedAt: '2026-10-26T12:00:00Z', noStructuralHeading: false,
    sections: [{ page: 1, rawHeading: 'VISTOS', expectedType: 'VISTOS', ordinal: null, notes: null }],
  };
  assert.doesNotThrow(() => checkStructureLabel(valid, sourceDoc));
  assert.throws(() => checkStructureLabel({ ...valid, exhaustive: false }, sourceDoc), /NOT_EXHAUSTIVE/);
  assert.throws(() => checkStructureLabel({ ...valid, sections: [{ ...valid.sections[0], page: 3 }] }, sourceDoc), /PAGE_NOT_IN_SOURCE/);
});

test('citation labels validate exact public targets and explicit negative examples', () => {
  const valid = {
    status: 'HUMAN_REVIEW_COMPLETE', exhaustive: true, reviewerId: 'reviewer-1',
    reviewedAt: '2026-10-26T12:00:00Z',
    references: [{ page: 1, rawCitation: 'Expte. CIV 12/2020', decision: 'DETECT', family: 'CIVIL_EXPEDIENTE',
      expectedParsedFields: { expediente: '12/2020' }, expectedTarget: { documentId: '202', sourceHash: null },
      resolutionExpectation: 'UNIQUE', resolutionReason: 'NOT_APPLICABLE', notes: null }],
  };
  assert.doesNotThrow(() => checkCitationLabel(valid, sourceDoc, new Set(['202'])));
  assert.throws(() => checkCitationLabel(valid, sourceDoc, new Set(['303'])), /TARGET_NOT_IN_PUBLIC_CATALOG/);
  const negative = { ...valid, references: [{ page: 1, rawCitation: 'SCBA', decision: 'DO_NOT_DETECT', family: null,
    expectedParsedFields: null, expectedTarget: null, resolutionExpectation: 'OUT_OF_SCOPE',
    resolutionReason: 'UNSUPPORTED_EXTERNAL_COURT', notes: 'Mención sin cita a un caso.' }] };
  assert.doesNotThrow(() => checkCitationLabel(negative, sourceDoc, new Set()));
});

test('metric calculator counts false positive and false negative separately with design weights', () => {
  const predictions = new Map([['sample-1', [
    { sourcePage: 1, family: 'CIVIL_EXPEDIENTE', rawCitation: 'Expte. CIV 12/2020' },
    { sourcePage: 2, family: 'CSJN_CASE', rawCitation: 'CSJN 999/2020/CS1' },
  ]]]);
  const labels = new Map([['sample-1', [
    { page: 1, family: 'CIVIL_EXPEDIENTE', rawCitation: 'Expte. CIV 12/2020', decision: 'DETECT' },
    { page: 2, family: 'CSJN_CASE', rawCitation: 'CSJN 123/2020/CS1', decision: 'DETECT' },
  ]]]);
  const result = weightedCounts(predictions, labels, keyCitation, () => 2);
  assert.equal(result.truePositives, 1);
  assert.equal(result.falsePositives, 1);
  assert.equal(result.falseNegatives, 1);
  assert.equal(result.prevalenceWeighted.truePositives, 2);
  assert.equal(result.prevalenceWeighted.falsePositives, 2);
  assert.equal(result.prevalenceWeighted.falseNegatives, 2);
});

test('regex stress input is bounded and reproducible', () => {
  assert.equal(Buffer.byteLength(buildAdversarialText()), 900_000);
});

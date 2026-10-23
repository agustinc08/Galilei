'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateIdentity } = require('./jurisprudencia-identity-contract.cjs');

const base = { caseNumber: '123/2020', court: 'Cámara Nacional de Apelaciones en lo Civil', chamber: 'Sala E', decisionDate: '2020-01-02', title: 'Actor c/ Demandado' };

test('same SHA and same legal metadata permits exact file link', () => {
  assert.equal(evaluateIdentity({ ...base, sha256: 'a' }, { ...base, sha256: 'a' }).allowedAction, 'LINK_FILE_EXACT');
});
test('different SHA with exact legal fields is high legal identity but review only', () => {
  assert.deepEqual(evaluateIdentity({ ...base, sha256: 'a' }, { ...base, sha256: 'b' }), {
    confidence: 'HIGH', legalIdentityMatch: true, fileIdentityMatch: false,
    reasons: ['SAMECASE_MATCH','SAMECOURT_MATCH','SAMECHAMBER_MATCH','SAMEDATE_MATCH','DISTINCT_SHA_REPRESENTATION_REQUIRES_REVIEW'],
    allowedAction: 'REVIEW', proposedAction: 'LINK_LEGAL_IDENTITY',
  });
});
test('same case but different decision date is a conflict', () => {
  assert.equal(evaluateIdentity({ ...base, sha256: 'a' }, { ...base, decisionDate: '2020-01-03', sha256: 'b' }).allowedAction, 'REJECT');
});
test('title only remains low confidence and review', () => {
  const result = evaluateIdentity({ title: base.title, sha256: 'a' }, { title: base.title, sha256: 'b' });
  assert.equal(result.confidence, 'LOW');
  assert.equal(result.allowedAction, 'REVIEW');
});

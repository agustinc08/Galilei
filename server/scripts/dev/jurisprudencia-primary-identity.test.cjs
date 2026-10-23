'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { candidateOccurrences, documentStructure, classifyDocument, validateJ6DecisionCsv, J6_DECISIONS, normCase } = require('./jurisprudencia-primary-identity.cjs');

const rows = (cases, overrides = {}) => cases.map((caseNumber, index) => ({ caseNumber, normalizedCaseNumber: normCase(caseNumber).replace(/\D/gu,''),
  page: 1, offset: index * 80, context: `Expte. ${caseNumber}`, zone: 'OPENING_HEADER', header: true, resolutory: false,
  citation: false, accumulation: false, ...overrides[index] }));

test('primary case wins over a cited precedent on later pages', () => {
  const pages = ['Poder Judicial de la Nación. Cámara Civil Sala A. Autos CIV 100/2020. Carátula. EXPTE 100/2020',
    '', '', 'Conforme al precedente citado en CIV 500/2012, corresponde confirmar.'];
  const found = candidateOccurrences(pages);
  const result = classifyDocument({ occurrences: found, structure: documentStructure(pages), sourceCases: ['CIV 100/2020'], sourceRows: [{}] });
  assert.equal(result.proposedPrimaryCase, '100/2020');
  assert.equal(result.primaryStatus, 'PRIMARY_CASE_CONFIRMED');
  assert.ok(result.roles.some(row => row.caseNumber === '500/2012' && row.role === 'SECONDARY_REFERENCE'));
});

test('two accumulated cases and one resolutory unit are not a multi-decision PDF', () => {
  const pages = ['Poder Judicial de la Nación. Cámara Civil Sala A. Buenos Aires a los días del mes de mayo de 2026. Autos CIV 100/2020 acumulados a CIV 200/2021. Se resuelve confirmar ambas sentencias.'];
  const result = classifyDocument({ occurrences: candidateOccurrences(pages), structure: documentStructure(pages), sourceCases: ['100/2020','200/2021'], sourceRows: [{case_number:'100/2020'},{case_number:'200/2021'}] });
  assert.equal(result.classification, 'MULTI_CASE_SINGLE_DECISION');
  assert.equal(result.decisionEvidence.multiDecisionEvidence, false);
});

test('two separately headed and dispositive rulings qualify as true multi-decision', () => {
  const pages = ['Poder Judicial de la Nación. Cámara Civil Sala A. Buenos Aires, 3 de mayo de 2020. Expte. 100/2020. Se resuelve confirmar el fallo.',
    'Poder Judicial de la Nación. Cámara Civil Sala A. Buenos Aires, 8 de julio de 2021. Expte. 200/2021. Por ello se resuelve revocar la sentencia.'];
  const result = classifyDocument({ occurrences: candidateOccurrences(pages), structure: documentStructure(pages), sourceCases: ['100/2020','200/2021'], sourceRows: [{},{}] });
  assert.equal(result.classification, 'TRUE_MULTI_DECISION_PDF');
  assert.equal(result.primaryStatus, 'AMBIGUOUS_PRIMARY_CASE');
});

test('source metadata error proposal only when PDF primary matches Corpus', () => {
  const pages = ['Cámara Civil Sala A. Expte. CIV 200/2021. Expte. 200/2021. Se resuelve confirmar.']; const occurrences = candidateOccurrences(pages);
  const result = classifyDocument({ occurrences, structure: documentStructure(pages), sourceCases: ['100/2020'], sourceRows: [{}], corpusCases: ['200/2021'],
    sourceMetadata: [{ caseNumber: '100/2020' }], corpusMetadata: [{ caseNumber: '200/2021' }] });
  assert.equal(result.collisionType, 'SOURCE_WRONG_CORPUS_RIGHT');
  assert.equal(result.proposedMetadataAction, 'REVIEW_SOURCE');
});

test('Corpus correction remains a proposal when source metadata and PDF agree', () => {
  const pages = ['Cámara Civil Sala A. Expte. CIV 200/2021. Expte. 200/2021. Se resuelve confirmar.']; const occurrences = candidateOccurrences(pages);
  const result = classifyDocument({ occurrences, structure: documentStructure(pages), sourceCases: ['200/2021'], sourceRows: [{}], corpusCases: ['100/2020'],
    sourceMetadata: [{ caseNumber: '200/2021' }], corpusMetadata: [{ caseNumber: '100/2020' }] });
  assert.equal(result.collisionType, 'SOURCE_RIGHT_CORPUS_WRONG');
  assert.equal(result.proposedMetadataAction, 'CORRECT_CORPUS_PROPOSAL');
});

test('similar primary evidence is classified ambiguous', () => {
  const cases = rows(['100/2020','200/2021']);
  const result = classifyDocument({ occurrences: cases, structure: documentStructure([]), sourceCases: ['100/2020','200/2021'], sourceRows: [{},{}] });
  assert.equal(result.classification, 'AMBIGUOUS');
  assert.equal(result.primaryStatus, 'AMBIGUOUS_PRIMARY_CASE');
});

test('input row order does not change the proposed primary case or candidate ordering', () => {
  const pages = ['Poder Judicial de la Nación. Cámara Civil Sala A. Autos CIV 100/2020. Expte. 100/2020; expte. 200/2021.'];
  const occurrences = candidateOccurrences(pages);
  const first = classifyDocument({ occurrences, structure: documentStructure(pages), sourceCases: ['100/2020','200/2021'], sourceRows: [{case_number:'100/2020'},{case_number:'200/2021'}] });
  const second = classifyDocument({ occurrences: [...occurrences].reverse(), structure: documentStructure(pages), sourceCases: ['200/2021','100/2020'], sourceRows: [{case_number:'200/2021'},{case_number:'100/2020'}] });
  assert.equal(first.classification, second.classification);
  assert.equal(first.proposedPrimaryCase, second.proposedPrimaryCase);
  assert.deepEqual(first.candidates.map(row => row.normalizedCaseNumber), second.candidates.map(row => row.normalizedCaseNumber));
});

test('no usable document text stays insufficient and candidate roles stay unknown', () => {
  const result = classifyDocument({ occurrences: [], structure: documentStructure([]), sourceCases: ['100/2020'], sourceRows: [{}] });
  assert.equal(result.classification, 'INSUFFICIENT');
  assert.equal(result.primaryStatus, 'NO_PRIMARY_CASE_FOUND');
});

test('J6 decision validator accepts documented choices and rejects duplicates/unknown values', () => {
  assert.ok(J6_DECISIONS.has('MULTI_CASE_SINGLE_DECISION'));
  const csv = 'groupId,decision,reviewer,reviewedAt,notes\ng1,MULTI_CASE_SINGLE_DECISION,A,2026-10-14,"review, with comma"\n';
  assert.equal(validateJ6DecisionCsv(csv, new Set(['g1'])).valid, true);
  const invalid = validateJ6DecisionCsv(csv.replace('MULTI_CASE_SINGLE_DECISION','MAGIC') + 'g1,OTHER,A,2026-10-14,duplicate\n', new Set(['g1']));
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some(error => error.code === 'INVALID_DECISION'));
  assert.ok(invalid.errors.some(error => error.code === 'DUPLICATE_GROUP'));
});

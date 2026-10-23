'use strict';

const assert = require('node:assert/strict');
const { normalize, pairEvidence, buildMatches } = require('./quantification-crossmatch.cjs');

assert.equal(normalize('CIV 68.426 / 2021'), '684262021');
const record = { source_key: 'q:1', category: 'LESIONES_POST_2015', case_record_id: '1', case_number: '68426/2021',
  title: 'PISO, CARLOS ALBERTO C/ LOPEZ, HECTOR DANIEL', decision_date: '2025-09-12', chamber: 'A', metadata_json: '{}' };
const exact = pairEvidence(record, { id: 'doc-1', caseNumber: '68426 / 2021', decisionDate: '2025-09-12', chamber: 'Sala A', title: record.title }, 'BJC_CORPUS');
assert.equal(exact.status, 'EXACT');
const high = pairEvidence(record, { id: 'doc-2', caseNumber: '68426/2021', decisionDate: '2025-09-12', title: record.title }, 'HISTORICAL_TFN');
assert.equal(high.status, 'HIGH_CONFIDENCE');
const candidate = pairEvidence(record, { id: 'doc-3', caseNumber: '68426/2021', decisionDate: '2024-01-01', title: 'Otra carátula' }, 'HISTORICAL_TFN');
assert.equal(candidate.status, 'CANDIDATE');
const unresolved = pairEvidence(record, { id: 'doc-4', caseNumber: '1/2000', decisionDate: '2000-01-01', title: 'Caso distinto' }, 'BJC_CORPUS');
assert.equal(unresolved.status, 'UNRESOLVED');
assert.equal(buildMatches([record], [{ id: 'doc-2', caseNumber: '68426/2021', decisionDate: '2025-09-12' }, { id: 'doc-1', caseNumber: '68426/2021', decisionDate: '2025-09-12', chamber: 'A' }], [])[0].corpus.matches[0].documentId, 'doc-1');
assert.equal(buildMatches([record], [], []).length, 1);
console.log('quantification crossmatch: 7 assertions PASS');

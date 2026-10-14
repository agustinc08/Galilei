'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDocIndex, recoverCandidate, structuralCause, chooseSourceData, legalKey, classifyDocketEvidence, extractDocketCandidates } = require('./jurisprudencia-candidate-recovery.cjs');

const baseDoc = (id, overrides = {}) => ({ id, title: `case ${id}`, jurisdiction: 'CIVIL', court: 'Cámara Nacional de Apelaciones en lo Civil',
  chamber: 'A', instance: 'SECOND_INSTANCE', caseNumber: '123/2020', docket: null, decisionDate: '2021-02-03',
  metadata: {}, metadataOriginal: {}, ...overrides });
const makeIndex = ({ docs = [], files = [], ingestions = [] } = {}) => makeDocIndex(docs, files, ingestions);
const group = (overrides = {}) => ({ legalDocumentKey: '123/2020|CAMARA|A|2021-02-03', caseNumber: '123/2020',
  court: 'Cámara Nacional de Apelaciones en lo Civil', chamber: 'A', decisionDate: '2021-02-03',
  sourceEvidence: [{ external_id: 'src-1', source_key: 'PORTAL:src-1', quantification_id: 'portal-1', sha256: 'sha-1',
    case_number: '123/2020', court: 'Cámara Nacional de Apelaciones en lo Civil', chamber: 'A', decision_date: '2021-02-03' }], ...overrides });
const source = (overrides = {}) => ({ groupId: group().legalDocumentKey, sourceRecordId: 'src-1', sourceKey: 'PORTAL:src-1',
  portalId: 'portal-1', sha256: 'sha-1', legalKey: 'legal-1', metadata: { caseNumber: '123/2020', court: 'court', chamber: 'A', decisionDate: '2021-02-03' },
  legacyIds: [], ...overrides });
const file = (id, documentId, sha256) => ({ id, documentId, sha256, mimeType: 'application/pdf', sizeBytes: 100n, pageCount: 1, version: 1 });
const ingest = (id, documentId, overrides = {}) => ({ id, documentId, fileId: null, externalId: null, sourceReference: null,
  externalUrl: null, checksum: '', metadataOriginal: {}, sourceCode: 'TEST', ...overrides });

test('exact source SHA recovers a Corpus document', () => {
  const index = makeIndex({ docs: [baseDoc('doc-1')], files: [file('file-1','doc-1','sha-1')] });
  const result = recoverCandidate(group(), index, [source()]);
  assert.equal(result.status, 'EXACT_RECOVERED');
  assert.deepEqual(result.candidateDocumentIds, ['doc-1']);
  assert.ok(result.methods.some(item => item.method === 'SOURCE_SHA_EXACT'));
});

test('exact source/portal IDs recover through ingestion provenance', () => {
  const index = makeIndex({ docs: [baseDoc('doc-1')], ingestions: [ingest('ing-1','doc-1',{ externalId: 'portal-1' })] });
  const result = recoverCandidate(group(), index, [source()]);
  assert.equal(result.status, 'EXACT_RECOVERED');
  assert.ok(result.methods.some(item => item.method === 'PORTAL_OR_LEGACY_ID_EXACT'));
});

test('one exact legal key recovers one candidate at high confidence', () => {
  const index = makeIndex({ docs: [baseDoc('doc-1')] });
  const result = recoverCandidate(group(), index, [source({ sha256: 'absent' })]);
  assert.equal(result.status, 'EXACT_RECOVERED');
  assert.equal(result.legalKeyOnly, true);
  assert.ok(result.methods.some(item => item.method === 'LEGAL_KEY_EXACT' && item.confidence === 'HIGH'));
});

test('multiple exact legal-key candidates remain ambiguous', () => {
  const index = makeIndex({ docs: [baseDoc('doc-1'), baseDoc('doc-2')] });
  const result = recoverCandidate(group(), index, [source({ sha256: 'absent' })]);
  assert.equal(result.status, 'MULTIPLE_RECOVERED');
  assert.equal(result.candidateDocumentIds.length, 2);
});

test('no evidence does not guess a candidate', () => {
  const index = makeIndex({ docs: [baseDoc('other',{ caseNumber:'999/1999' })] });
  const result = recoverCandidate(group(), index, [source({ sha256: 'absent', sourceRecordId:'none', sourceKey:'none', portalId:'none' })]);
  assert.equal(result.status, 'NOT_RECOVERED');
  assert.deepEqual(result.candidateDocumentIds, []);
});

test('same SHA and repeated identical source rows are identified as source duplicates', () => {
  const row = source();
  const result = structuralCause(group(), [row, { ...row }], makeIndex());
  assert.equal(result.cause, 'DUPLICATE_SOURCE_ROWS');
});

test('same SHA with conflicting source dates is metadata collision', () => {
  const rows = [source(), source({ groupId:'other-group', sourceRecordId:'src-2', sourceKey:'PORTAL:src-2', legalKey:'other-key', metadata:{...source().metadata,decisionDate:'2021-02-04'} })];
  const result = structuralCause(group(), rows, makeIndex());
  assert.equal(result.cause, 'SOURCE_METADATA_COLLISION');
});

test('same SHA mapped to multiple Corpus documents is ingestion collision', () => {
  const rows = [source(), source({ groupId:'other-group', legalKey:'other-key' })];
  const index = makeIndex({ docs:[baseDoc('doc-1'),baseDoc('doc-2')],files:[file('f1','doc-1','sha-1'),file('f2','doc-2','sha-1')] });
  const result = structuralCause(group(), rows, index);
  assert.equal(result.cause, 'INGESTION_LINK_COLLISION');
  assert.equal(result.corpusDocumentCount, 2);
});

test('multi-docket evidence requires two exact source docket matches and does not overclaim separate decisions', () => {
  const positive = classifyDocketEvidence(['123/2020','456/2021'],['Expte. 123/2020','Expte. 456/2021','other 999/2022']);
  assert.equal(positive.multiDocketPdf,true);
  assert.equal(positive.decisionMultiplicity,'NOT_ESTABLISHED_FROM_DOCKET_EVIDENCE');
  assert.equal(positive.matchedSourceDockets.length,2);
  const negative = classifyDocketEvidence(['123/2020','456/2021'],['Expte. 123/2020','Expte. 999/2022']);
  assert.equal(negative.multiDocketPdf,false);
});

test('docket extraction recognizes source headings and Civil docket abbreviations', () => {
  assert.deepEqual(extractDocketCandidates('Expte. n.° 105.277/2007; L.CIV 23.631/2009 - CIV. 5.337/2010/CA001'),
    ['1052772007','236312009','53372010']);
});

test('missing source field is recovered only from exact SHA metadata', () => {
  const item = group({ sourceEvidence:[{...group().sourceEvidence[0],decision_date:null}] });
  const index = makeIndex({ docs:[baseDoc('doc-1',{ metadataOriginal:{ decision_date:'2021-02-03' } })],
    files:[file('file-1','doc-1','sha-1')] });
  const result = chooseSourceData(item,index,[source()]);
  assert.equal(result.recoveredFields.decision_date.recovered,true);
  assert.equal(result.recoveredFields.decision_date.value,'2021-02-03');
  assert.equal(result.unresolved,false);
});

test('legal key normalization remains deterministic and docket-only evidence is not enough', () => {
  assert.equal(legalKey({caseNumber:'123 / 2020',court:'Cámara Nacional de Apelaciones en lo Civil',chamber:'Sala A',decisionDate:'2021-02-03',instance:'SECOND_INSTANCE'}),
    legalKey({caseNumber:'123/2020',court:'Cámara Nacional de Apelaciones en lo Civil',chamber:'A',decisionDate:'2021-02-03',instance:'SECOND_INSTANCE'}));
  assert.equal(legalKey({caseNumber:'123/2020'}),null);
});

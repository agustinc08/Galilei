'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname,'..','..','..','..');
const WORK = path.join(ROOT,'_recovery-work','jurisprudencia-j5');
const json = name => JSON.parse(fs.readFileSync(path.join(WORK,name),'utf8'));

test('J5 review artifacts cover all 451 groups and all five review tiers', () => {
  const queue=json('enriched-review-queue.json');
  assert.equal(queue.total,451);
  assert.equal(queue.rows.length,451);
  assert.deepEqual(queue.summary.reviewTiers,{HUMAN_READY:2,HUMAN_NEEDS_CANDIDATE:106,HUMAN_NEEDS_SOURCE_DATA:6,HUMAN_STRUCTURAL:321,MODEL_LIMITATION:16});
  assert.equal(queue.rows.filter(row=>row.reviewCategory==='CANDIDATE').length,106);
  assert.equal(queue.rows.filter(row=>row.reviewCategory==='STRUCTURAL').length,321);
  assert.equal(queue.rows.filter(row=>row.reviewCategory==='SOURCE_DATA_REQUIRED').length,6);
  assert.equal(queue.rows.filter(row=>row.reviewCategory==='MODEL_LIMITATION').length,16);
});

test('all 106 candidates have a recovery result and no fuzzy-title method', () => {
  const result=json('candidate-recovery.json');
  assert.equal(result.total,106);
  assert.equal(result.rows.length,106);
  assert.ok(result.rows.every(row=>['EXACT_RECOVERED','MULTIPLE_RECOVERED','PARTIAL_RECOVERED','NOT_RECOVERED'].includes(row.status)));
  assert.ok(result.rows.every(row=>row.methods.every(method=>!method.method.toLowerCase().includes('title'))));
});

test('structural causes cover 321 groups; docket evidence does not claim multiple decisions', () => {
  const result=json('structural-root-causes.json');
  assert.equal(result.total,321);
  assert.equal(Object.values(result.counts).reduce((sum,value)=>sum+value,0),321);
  assert.equal(result.pdfTextAudit.parsed+result.pdfTextAudit.cacheHits,result.pdfTextAudit.uniqueSha);
  assert.ok(result.pdfTextAudit.results.every(row=>row.decisionMultiplicity==='NOT_ESTABLISHED_FROM_DOCKET_EVIDENCE'||row.decisionMultiplicity==='UNKNOWN'));
});

test('source data stays unresolved unless exact provenance recovers each conflict', () => {
  const result=json('source-data-recovery.json');
  assert.equal(result.total,7);
  assert.equal(result.rows.length,7);
  assert.equal(result.recovered,1);
  assert.equal(result.stillMissing,6);
});

test('review V2 HTML and CSV expose candidate, structural, source-data and model filters', () => {
  const html=fs.readFileSync(path.join(WORK,'review-v2.html'),'utf8');
  const csv=fs.readFileSync(path.join(WORK,'review-v2.csv'),'utf8');
  for(const value of ['CANDIDATE','STRUCTURAL','SOURCE_DATA_REQUIRED','MODEL_LIMITATION','recovery']) assert.ok(html.includes(value));
  for(const value of ['reviewCategory','recoveryStatus','candidateDocumentIds','sourceFileSha','corpusDocumentIds','legalKeys']) assert.ok(csv.includes(value));
  assert.equal(csv.trim().split(/\r?\n/u).length,452);
});

test('read-only snapshot has no Corpus/Search changes and Search verify is complete', () => {
  const summary=json('final-summary.json');
  assert.equal(summary.status,'PARTIAL');
  assert.equal(summary.writeAudit.noWriteGate,'FAIL_TRANSIENT_SEARCH_CONTROL_MARKER_WRITE_RESTORED');
  assert.equal(summary.writeAudit.netDataStateUnchanged,true);
  assert.equal(summary.snapshot.dbTarget.host,'127.0.0.1');
  assert.equal(summary.snapshot.dbTarget.port,55432);
  assert.equal(summary.snapshot.dbTarget.database,'buscador_juridico_civil_dev');
  assert.equal(summary.snapshot.dbTarget.role,'bjc_dev');
  assert.equal(summary.snapshot.corpusCounts.match,true);
  assert.equal(summary.snapshot.readOnly,true);
  assert.deepEqual(summary.snapshot.writes,{corpus:0,search:0,prisma:0,migrations:0});
  assert.equal(summary.writeAudit.searchVerifyControlMarker.temporaryUpdateOccurred,true);
  assert.equal(summary.writeAudit.searchVerifyControlMarker.restored,true);
  assert.equal(summary.searchIntegrity.documents,17078);
  assert.equal(summary.searchIntegrity.tokens,18799500);
  assert.equal(summary.searchIntegrity.stale,0);
  assert.equal(summary.searchIntegrity.mismatch,0);
  assert.equal(summary.searchIntegrity.rebuiltDocuments,0);
});

test('recorded artifact hashes match the current review package', () => {
  const summary=json('final-summary.json');
  for(const [name,expected] of Object.entries(summary.outputHashes)) {
    const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(WORK,name))).digest('hex');
    assert.equal(actual,expected,name);
  }
});

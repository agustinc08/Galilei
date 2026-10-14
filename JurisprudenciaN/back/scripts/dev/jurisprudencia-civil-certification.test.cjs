'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./jurisprudencia-civil-certification.cjs');

function row(documentId, certificationInput = {}) {
  return {
    documentId,
    source: 'SYNTHETIC',
    decisionDate: '2026-01-01',
    fileIntegrity: 'VALID',
    fileSha: 'a'.repeat(64),
    provenance: 'COMPLETE',
    pageStatus: 'OK',
    search: 'SEARCH_READY',
    viewer: 'READY',
    caseNormalizationStatus: 'VALID_CANONICAL',
    salaStatus: 'KNOWN_SALA',
    legalKeyStatus: 'COMPLETE',
    representationStatus: 'SINGLE_REPRESENTATION',
    qualityFlags: [],
    humanReviewRequired: false,
    certificationInput: {
      fileIntegrity: 'VALID', provenance: 'COMPLETE', pageIntegrity: 'OK', search: 'READY', viewer: 'READY',
      sourceStatus: 'KNOWN', identityStatus: 'KNOWN', ...certificationInput,
    },
  };
}

test('clean document is certified and known historical gaps stay non-broken', () => {
  assert.equal(C.classifyDocument(row('a').certificationInput).certificationStatus, 'CERTIFIED');
  const knownGap = row('b', { knownGaps: ['HISTORICAL_SALA_NO_SELF_EVIDENCE'] });
  assert.equal(C.classifyDocument(knownGap.certificationInput).certificationStatus, 'CERTIFIED_WITH_KNOWN_GAP');
  const human = row('c', { humanReviewRequired: true });
  assert.equal(C.classifyDocument(human.certificationInput).certificationStatus, 'HUMAN_REVIEW_PENDING');
});

test('model limitations, broken, unresolved, and unknown remain distinct', () => {
  assert.equal(C.classifyDocument(row('m', { modelLimitations: ['MULTIPLE_REPRESENTATIONS'] }).certificationInput).certificationStatus, 'MODEL_LIMITATION');
  assert.equal(C.classifyDocument(row('b', { search: 'BROKEN' }).certificationInput).certificationStatus, 'BROKEN');
  assert.equal(C.classifyDocument(row('u', { identityStatus: 'UNRESOLVED' }).certificationInput).certificationStatus, 'UNRESOLVED');
  assert.equal(C.classifyDocument(row('x', { sourceStatus: 'UNKNOWN' }).certificationInput).certificationStatus, 'UNKNOWN');
});

test('manifest coverage detects duplicate or missing identity and never marks broken as clean', () => {
  const manifest = C.buildManifest([
    row('same'),
    row('same', { knownGaps: ['KNOWN_GAP'] }),
    row('broken', { fileIntegrity: 'MISSING' }),
  ]);
  const summary = C.validateManifest(manifest, 3);
  assert.equal(summary.reconciles, false);
  assert.equal(summary.duplicates, 1);
  assert.equal(manifest.find(x => x.documentId === 'broken').certificationStatus, 'BROKEN');
});

test('sample selection and manifest hashing are deterministic', () => {
  const input = Array.from({ length: 130 }, (_, index) => ({ documentId: `doc-${index}`, source: `S${index % 3}`, decisionDate: `202${index % 7}-01-01`, sala: `Sala ${String.fromCharCode(65 + index % 5)}`, fileKind: index % 2 ? 'PDF' : 'TEXT', qualityBand: `Q${index % 4}`, certificationStatus: 'CERTIFIED' }));
  const first = C.chooseSearchSample(input, 100);
  const second = C.chooseSearchSample([...input].reverse(), 100);
  assert.deepEqual(first.map(x => x.documentId), second.map(x => x.documentId));
  assert.equal(first.length, 100);
  assert.equal(C.sha256(C.stable(first.map(x => x.documentId))), C.sha256(C.stable(second.map(x => x.documentId))));
});

test('local certification HTML exposes working status and human-review filters', async () => {
  const { chromium } = require(require.resolve('@playwright/test', { paths: [require('node:path').resolve(__dirname, '..', '..', '..', 'front')] }));
  const browser = await chromium.launch({ headless: true, executablePath: require('node:fs').existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined });
  try {
    const rows = [
      { ...row('clean').certificationInput, documentId: 'clean', source: 'SOURCE_A', decisionDate: '2020-01-01', salaStatus: 'KNOWN_SALA', viewerStatus: 'READY', knownGaps: [], modelLimitation: [], humanReviewRequired: false, certificationStatus: 'CERTIFIED' },
      { ...row('human', { humanReviewRequired: true }).certificationInput, documentId: 'human', source: 'SOURCE_B', decisionDate: '2008-01-01', salaStatus: 'PROBABLE_HUMAN_CONFIRMATION', viewerStatus: 'READY', knownGaps: ['HISTORICAL_SALA_HUMAN_REVIEW_PENDING'], modelLimitation: [], humanReviewRequired: true, certificationStatus: 'HUMAN_REVIEW_PENDING' },
    ];
    const html = C.renderHtml({ snapshot: { civilDocuments: 2 }, documentCoverage: { coveragePercent: 100 }, states: { BROKEN: 0, UNKNOWN: 0 }, search: { searchReady: 2 }, sala: { known: 1 }, globalStatus: 'CERTIFIED_WITH_KNOWN_GAPS', conclusion: 'synthetic' }, rows);
    const page = await browser.newPage();
    await page.setContent(html);
    assert.equal(await page.locator('#rows tr').count(), 2);
    await page.locator('#status').selectOption('CERTIFIED');
    assert.equal(await page.locator('#rows tr:visible').count(), 1);
    await page.locator('#status').selectOption('');
    await page.locator('#human').check();
    assert.equal(await page.locator('#rows tr:visible').count(), 1);
  } finally { await browser.close(); }
});

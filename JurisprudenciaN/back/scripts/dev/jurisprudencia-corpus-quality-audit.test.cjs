'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  stable, sha256, docket, legalKey, normalizeChamber, classifyProvenance, quality, pageAudit, textHash, shingles, jaccard,
  priority, normalizeFileKind, makeFlags, buildIndexes, buildDuplicates, sourceAliasCandidates,
} = require('./jurisprudencia-corpus-quality-audit.cjs');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'jurisprudencia-corpus-quality-synthetic.json'), 'utf8'));

test('synthetic fixture covers all requested quality audit scenarios', () => {
  assert.ok(fixture.documents.length >= 10);
  const scenarios = new Set(fixture.documents.map(row => row.scenario));
  for (const scenario of [
    'missing provenance', 'same SHA shared by two documents', 'different SHA same normalized text',
    'missing page number', 'all empty page text', 'court and instance conflict', 'Search projection missing',
    'one decision multiple files', 'potential source alias', 'near-text candidate with same legal key',
  ]) assert.ok(scenarios.has(scenario), scenario);
});

test('stable hashes and legal docket normalization are deterministic', () => {
  assert.equal(stable({ z: 1, a: 2 }), stable({ a: 2, z: 1 }));
  assert.equal(stable({ at: new Date('2026-10-14T00:00:00.000Z') }), stable({ at: '2026-10-14T00:00:00.000Z' }));
  assert.equal(sha256(stable({ a: 1 })), sha256(stable({ a: 1 })));
  assert.equal(docket('Expte. 00123 / 2017'), '123/2017');
  assert.equal(docket('Expte. 56.261/99'), '56261/99');
  assert.equal(normalizeChamber('Sala J'), normalizeChamber('J'));
  assert.equal(legalKey({ court: 'Cámara Civil', chamber: 'Sala A', caseNumber: '123/2017', decisionDate: '2018-03-02' }), 'camara civil|sala a|123/2017|2018-03-02');
});

test('provenance completeness states distinguish missing records and complete references', () => {
  assert.equal(classifyProvenance([]), 'MISSING_INGESTION_RECORD');
  assert.equal(classifyProvenance([{ sourceCode: 'PORTAL', externalId: null, sourceReference: null, externalUrl: null }]), 'MISSING_SOURCE_RECORD');
  assert.equal(classifyProvenance([{ sourceCode: 'PORTAL', externalId: 'id-1', externalUrl: null }]), 'MISSING_SOURCE_URL');
  assert.equal(classifyProvenance([{ sourceCode: 'PORTAL', externalId: 'id-1', externalUrl: 'https://example.invalid/doc' }]), 'COMPLETE');
  assert.equal(classifyProvenance([{ sourceCode: 'A', externalId: '1' }, { sourceCode: 'B', externalId: '2' }]), 'MULTIPLE_CONFLICTING_PROVENANCE');
});

test('file classification detects PDF, invalid PDF, HTML-as-PDF and empty files', () => {
  assert.equal(normalizeFileKind({ mimeType: 'application/pdf', originalFilename: 'x.pdf' }, '%PDF-1.7'), 'PDF');
  assert.equal(normalizeFileKind({ mimeType: 'application/pdf', originalFilename: 'x.pdf' }, '<html><body>error'), 'HTML_AS_PDF');
  assert.equal(normalizeFileKind({ mimeType: 'application/pdf', originalFilename: 'x.pdf' }, 'not a pdf'), 'INVALID_PDF');
  assert.equal(normalizeFileKind({ mimeType: 'text/plain', originalFilename: 'x.txt' }, ''), 'TEXT');
});

test('page audit flags gaps, ordering, duplicates, count mismatch and empty extraction', () => {
  const result = pageAudit({ pageCount: 4 }, { pages: [{ pageNumber: 3, empty: true }, { pageNumber: 3 }, { pageNumber: 1 }] });
  assert.ok(result.states.includes('DUPLICATE_PAGE_NUMBER'));
  assert.ok(result.states.includes('MISSING_PAGE'));
  assert.ok(result.states.includes('OUT_OF_ORDER'));
  assert.ok(result.states.includes('PAGE_COUNT_MISMATCH'));
  assert.equal(pageAudit({ pageCount: 2 }, { pages: [{ pageNumber: 1, empty: true }, { pageNumber: 2, empty: true }] }).states.includes('ALL_EMPTY_TEXT'), true);
});

test('normalized text fingerprint only canonicalizes Unicode and whitespace', () => {
  assert.deepEqual(textHash('A\r\n  civil\ttexto'), textHash('A civil texto'));
  assert.notEqual(textHash('civil fallo').hash, textHash('fallo civil').hash);
});

test('near-text shingle candidate generation is bounded and similarity is deterministic', () => {
  const left = shingles('La sentencia resuelve el recurso presentado por la parte actora con costas');
  const right = shingles('La sentencia resuelve el recurso presentado por la parte actora con costas y honorarios');
  assert.ok(jaccard(left, right) > 0.5);
  assert.equal(jaccard(left, right), jaccard(left, right));
});

test('exact SHA groups distinguish multiple documents and legal identities', () => {
  const file = (id, sha, textHashValue, text) => ({ id, sha256: sha, textHash: textHashValue, textLength: text.length, _normalizedText: text });
  const row = (id, caseNumber, file) => ({ documentId: id, legalKeys: [`civil|sala a|${caseNumber}|2018-01-01`], provenanceRecords: [{ id: `source-${id}` }], files: [file] });
  const rows = [
    row('a', 'same-sha', file('fa', 'same-sha', 'text-a', 'different legal source text')),
    row('b', '456/2017', file('fb', 'same-sha', 'text-b', 'other document source text')),
  ];
  const duplicates = buildDuplicates(buildIndexes(rows));
  assert.equal(duplicates.shaGroups.length, 1);
  assert.ok(duplicates.shaGroups[0].kinds.includes('SAME_FILE_MULTIPLE_DOCUMENTS'));
  assert.ok(duplicates.shaGroups[0].kinds.includes('SAME_FILE_MULTIPLE_LEGAL_IDENTITIES'));
  assert.equal(duplicates.shaGroups[0].sourceRecordCount, 2);
});

test('different SHA with identical normalized text remains a representation candidate', () => {
  const content = 'idéntica transcripción de una resolución con suficientes caracteres para distinguir la huella completa';
  const mk = (id, sha) => ({ documentId: id, legalKeys: ['civil|sala a|44/2017|2018-01-01'], provenanceRecords: [], files: [{ id: `f-${id}`, sha256: sha, textHash: sha256(content), textLength: content.length, _normalizedText: content }] });
  const duplicates = buildDuplicates(buildIndexes([mk('a', 'sha-1'), mk('b', 'sha-2')]));
  assert.equal(duplicates.exactText.length, 1);
  assert.equal(duplicates.exactText[0].entries.length, 2);
  assert.notEqual(duplicates.exactText[0].entries[0].sha256, duplicates.exactText[0].entries[1].sha256);
});

test('near-text checks include multiple files of one decision and never auto-deduplicate', () => {
  const text = Array.from({ length: 90 }, (_, index) => `segmento legal palabra${index}`).join(' ');
  const variant = `${text} anexo final`;
  const row = { documentId: 'one-document', legalKeys: ['civil|sala c|10/2018|2019-01-02'], provenanceRecords: [], files: [
    { id: 'one', sha256: 'sha-one', textHash: 'h-one', textLength: text.length, _normalizedText: text },
    { id: 'two', sha256: 'sha-two', textHash: 'h-two', textLength: variant.length, _normalizedText: variant },
  ] };
  const duplicates = buildDuplicates(buildIndexes([row]));
  assert.equal(duplicates.nearCandidates.length, 1);
  assert.equal(duplicates.nearCandidates[0].status, 'DIFFERENT_SHA_NEAR_TEXT_CANDIDATE');
  assert.ok(duplicates.nearCandidates[0].similarity >= 0.82);
});

test('J6 same-SHA multi-case evidence is linked as a candidate without changing corpus identity', () => {
  const row = { documentId: 'corpus-doc', legalKeys: ['civil|sala a|10/2018|2019-01-02'], provenanceRecords: [], files: [{ id: 'file', sha256: 'same-sha', textHash: null }] };
  const j6 = [{ sha: 'same-sha', groupId: 'source-key', classification: 'MULTI_CASE_SINGLE_DECISION', proposedPrimaryCase: '10/2018', evidence: [{ caseNumber: '10/2018' }, { caseNumber: '11/2018' }] }];
  const duplicates = buildDuplicates(buildIndexes([row]), j6);
  assert.equal(duplicates.shaGroups.length, 1);
  assert.ok(duplicates.shaGroups[0].kinds.includes('SAME_FILE_MULTIPLE_LEGAL_IDENTITIES'));
  assert.equal(duplicates.shaGroups[0].fileCount, 1);
});

test('one legal key can retain multiple files/documents without automatic merging', () => {
  const row = (id, fileId) => ({ documentId: id, legalKeys: ['civil|sala b|8/2014|2015-02-03'], provenanceRecords: [], files: [{ id: fileId, sha256: id, textHash: null }] });
  const result = buildDuplicates(buildIndexes([row('a', 'fa'), row('b', 'fb')]));
  assert.equal(result.legalGroups[0].state, 'ONE_DECISION_MULTIPLE_DOCUMENTS');
});

test('search missing, metadata conflicts and P0 priority are explicit flags only', () => {
  const row = { files: [], caseNumber: null, decisionDate: null, chamber: null, courtNumber: null, title: '', provenanceRecords: [], provenanceStatus: 'MISSING_INGESTION_RECORD', conflicts: ['court'], legalKeys: [], search: { state: 'MISSING_SEARCH_DOC', tokenCount: 0 } };
  const flags = makeFlags(row);
  assert.ok(flags.includes('SEARCH_MISSING'));
  assert.ok(flags.includes('METADATA_CONFLICT'));
  assert.equal(priority(flags), 'P0');
  assert.equal(priority(['MISSING_PROVENANCE']), 'P1');
  assert.equal(priority(['MISSING_CASE']), 'P2');
});

test('quality band and priority are deterministic; low score is not a truth claim', () => {
  const row = { completeness: Object.fromEntries(['caseNumber', 'caseYear', 'decisionDate', 'court', 'instance', 'chamber', 'title', 'sourceRecordId', 'portalId', 'documentUrl', 'sourceUrl', 'fileSha', 'pageCount', 'originalMetadata', 'provenanceRecord'].map(key => [key, 'PRESENT'])), flags: [] };
  assert.deepEqual(quality(row), { score: 100, band: 'EXCELLENT' });
  assert.equal(quality({ completeness: {}, flags: ['MISSING_FILE'] }).band, 'BROKEN');
});

test('source alias detection reports a candidate and never merges source names', () => {
  const aliases = sourceAliasCandidates([{ source: 'TFN ACTUAL' }, { source: 'TFN_ACTUAL' }]);
  assert.equal(aliases.length, 1);
  assert.equal(aliases[0].status, 'POTENTIAL_ALIAS');
  assert.equal(aliases[0].merged, false);
});

test('read-only guard contract and audit output paths are fixed in source', () => {
  const source = fs.readFileSync(path.join(__dirname, 'jurisprudencia-corpus-quality-audit.cjs'), 'utf8');
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(source, /ROLLBACK/u);
  assert.match(source, /jurisprudencia-j7/u);
  assert.doesNotMatch(source, /client\.query\(\s*['"`]\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE)\b/iu);
});

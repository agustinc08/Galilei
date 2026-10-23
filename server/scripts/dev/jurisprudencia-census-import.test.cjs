'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalize, parseCsv, normalizeDocket } = require('./jurisprudencia-census-import.cjs');
const { aggregateSource } = require('./jurisprudencia-coverage.cjs');

const fixture = require('./fixtures/jurisprudencia-census-fixture.json');
const dir = path.resolve(__dirname, '../../../_recovery-work/jurisprudencia-j2');

test('CSV/JSON census fixture normalizes and scores exact, high, medium and invalid rows', () => {
  const csvRows = parseCsv(fs.readFileSync(path.join(__dirname, 'fixtures/jurisprudencia-census-fixture.csv'), 'utf8'));
  const csv = canonicalize(csvRows, { source: 'fixture', corpus: fixture.corpus });
  const json = canonicalize(fixture.records, { source: 'fixture', corpus: fixture.corpus });
  assert.equal(csv.summary.inputRows, 10);
  assert.equal(csv.summary.exact, 4);
  assert.equal(csv.summary.high, 2);
  assert.equal(csv.summary.medium, 1);
  assert.equal(csv.summary.invalidRows, 4);
  assert.equal(csv.summary.issues.PORTAL_ID_DUPLICATE, 2);
  assert.equal(csv.summary.issues.DECISION_DATE_INVALID, 1);
  assert.equal(csv.summary.issues.COURT_UNKNOWN, 1);
  const publicShape = rows => rows.map(({ rowNumber, metadataOriginal, ...x }) => x);
  assert.deepEqual(publicShape(csv.records), publicShape(json.records));
  assert.equal(csv.snapshotSha256, json.snapshotSha256);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'census-import-test.json'), `${JSON.stringify({ csvSummary: csv.summary,
    jsonSummary: json.summary, csvSnapshotSha256: csv.snapshotSha256, jsonSnapshotSha256: json.snapshotSha256,
    idempotency: csv.snapshotSha256 === canonicalize(csvRows, { source: 'fixture', corpus: fixture.corpus }).snapshotSha256 ? 'PASS' : 'FAIL',
    coverage: csv.coverage }, null, 2)}\n`);
  assert.equal(csv.snapshotSha256, canonicalize(csvRows, { source: 'fixture', corpus: fixture.corpus }).snapshotSha256);
});

test('duplicate source record IDs are flagged and never selected as exact matches', () => {
  const rows = [{ sourceRecordId: 'DUP', expediente: '1/2020', expedienteYear: '2020', court: 'Juzgado Civil 1' },
    { sourceRecordId: 'DUP', expediente: '2/2020', expedienteYear: '2020', court: 'Juzgado Civil 2' }];
  const result = canonicalize(rows, { corpus: [{ id: 'c1', sourceRecordId: 'DUP' }] });
  assert.equal(result.summary.issues.SOURCE_RECORD_ID_DUPLICATE, 2);
  assert.equal(result.summary.exact, 0);
  assert.equal(result.summary.conflicts, 2);
});

test('source columns can be mapped without rewriting source names', () => {
  const result = canonicalize([{ official_id: 'oid-1', numero_expediente: '00012/2021', year_expediente: '2021',
    fecha: '01/03/2022', tribunal_emisor: 'Juzgado Nacional de Primera Instancia en lo Civil N° 7' }],
  { source: 'official', mapping: { sourceRecordId: 'official_id', expediente: 'numero_expediente',
    expedienteYear: 'year_expediente', decisionDate: 'fecha', court: 'tribunal_emisor' } });
  assert.equal(result.records[0].sourceRecordId, 'oid-1');
  assert.equal(result.records[0].expediente, '00012/2021');
  assert.equal(result.records[0].expedienteNormalized, '12/2021');
  assert.equal(result.records[0].courtType, 'FIRST_INSTANCE_CIVIL');
  assert.equal(result.records[0].courtNumber, '7');
});

test('an exact source ID with contradictory legal metadata becomes conflict', () => {
  const result = canonicalize([{ sourceRecordId: 'stable-1', expediente: '1/2020', expedienteYear: '2020',
    decisionDate: '2020-01-01', court: 'Juzgado Nacional de Primera Instancia en lo Civil N° 1' }],
  { corpus: [{ id: 'doc-1', sourceRecordId: 'stable-1', expediente: '1/2020', expedienteYear: '2020',
    decisionDate: '2020-01-02', court: 'Juzgado Nacional de Primera Instancia en lo Civil N° 1' }] });
  assert.equal(result.records[0].match.confidence, 'CONFLICT');
  assert.deepEqual(result.records[0].match.reasons, ['SOURCE_RECORD_ID_METADATA_CONFLICT','DECISION_DATE_CONFLICT']);
});

test('docket normalization follows the J1/Sprint 14.8 conservative legal key', () => {
  assert.equal(normalizeDocket('00032436 / 2014'), '32436/2014');
  assert.equal(normalizeDocket('CIV 000123/09'), '123/09');
});

test('J1 coverage engine accepts canonical census snapshots without counting review as safe match', () => {
  const snapshot = canonicalize(fixture.records, { source: 'fixture', corpus: fixture.corpus });
  const result = aggregateSource(snapshot.records);
  assert.equal(result.byYear.length > 0, true);
  assert.equal(result.byCourt.some(x => x.court === 'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL'), true);
  assert.equal(result.byInstance.find(x => x.instance === 'FIRST_INSTANCE').known, 9);
  assert.equal(result.byYear.reduce((n,x)=>n+x.matched,0), 6);
});

test('CSV parser handles quoted separators and rejects malformed quoting', () => {
  assert.deepEqual(parseCsv('id,title\n1,"A, B ""C"""\n'), [{ id: '1', title: 'A, B "C"' }]);
  assert.throws(() => parseCsv('id,title\n1,"open'), /CSV_UNCLOSED_QUOTE/u);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, normalizeRow, aggregateSource } = require('./jurisprudencia-coverage.cjs');

test('parseCsv handles quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('portalId,caratula\n1,"A, B \"\"C\"\""\n'), [{ portalId: '1', caratula: 'A, B "C"' }]);
});

test('normalizeRow derives instance from explicit court and sala evidence', () => {
  assert.equal(normalizeRow({ expediente: '1/2020', año: '2020', Sala: 'Sala B', status: 'PDF_ACCESSIBLE' }).instance, 'SECOND_INSTANCE');
  assert.equal(normalizeRow({ expediente: '2/2021', año: '2021', Juzgado: 'Juzgado Civil 1' }).instance, 'FIRST_INSTANCE');
  assert.equal(normalizeRow({ expediente: '3/2022' }).instance, 'UNKNOWN');
});

test('aggregateSource deduplicates known docket/year/room keys and scopes percentages', () => {
  const result = aggregateSource([
    { portalId: 'a', expediente: '10/2020', año: '2020', Sala: 'A', matched: true, confidence: 'EXACT' },
    { portalId: 'b', expediente: '10/2020', año: '2020', Sala: 'A', status: 'REVIEW' },
    { portalId: 'c', expediente: '11/2020', año: '2020', Sala: 'B', status: 'OPEN' },
  ]);
  const year = result.byYear.find(row => row.year === '2020');
  assert.equal(year.known, 2);
  assert.equal(year.matched, 1);
  assert.equal(year.coverageWithinKnownSetPct, 50);
  assert.equal(result.bySala.length, 2);
  assert.match(result.scope, /supplied census only/u);
});

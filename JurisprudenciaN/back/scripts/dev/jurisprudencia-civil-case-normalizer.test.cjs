'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeCivilCaseReference, STATUSES } = require('./jurisprudencia-civil-case-normalizer.cjs');

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'jurisprudencia-case-normalizer.synthetic.json'), 'utf8'));

test('sanitized golden fixture matrix', () => {
  for (const fixture of fixtures.cases) {
    const actual = normalizeCivilCaseReference(fixture.input);
    assert.equal(actual.status, fixture.expected.status, fixture.id);
    assert.equal(actual.canonicalCaseNumber, fixture.expected.case, fixture.id);
    assert.equal(actual.canonicalYear, fixture.expected.year, fixture.id);
    assert.equal(actual.detectedFormat, fixture.expected.format, fixture.id);
    if (fixture.expected.cases) assert.equal(actual.cases.length, fixture.expected.cases, fixture.id);
  }
});

test('all statuses are explicit and unknown raw values are preserved', () => {
  assert.deepEqual(STATUSES, ['VALID_CANONICAL', 'VALID_LEGACY', 'VALID_MULTI_CASE', 'PARTIAL', 'AMBIGUOUS', 'MALFORMED', 'UNSUPPORTED']);
  const rawCase = 'not a docket';
  const result = normalizeCivilCaseReference({ rawCase });
  assert.equal(result.evidence.rawPreserved, rawCase);
  assert.equal(result.canonicalCaseNumber, null);
});

test('canonicalization is idempotent and never expands a two-digit year', () => {
  const initial = normalizeCivilCaseReference('001234/08');
  const again = normalizeCivilCaseReference({ rawCase: initial.normalizedDisplay });
  assert.equal(initial.canonicalYear, '08');
  assert.equal(again.canonicalCaseNumber, initial.canonicalCaseNumber);
  assert.equal(again.canonicalYear, initial.canonicalYear);
  assert.equal(again.status, initial.status);
});

test('does not treat slash as a multi-case delimiter', () => {
  const result = normalizeCivilCaseReference('12345/2020');
  assert.equal(result.status, 'VALID_CANONICAL');
  assert.equal(result.cases.length, 1);
});

test('explicit line-delimited cases remain separate and separate year alignment is ambiguous', () => {
  assert.equal(normalizeCivilCaseReference('123/2020\n456/2021').cases.length, 2);
  assert.equal(normalizeCivilCaseReference({ rawCase: '123; 456', rawYear: '2020' }).status, 'AMBIGUOUS');
});

test('does not collapse unclear multiple cases or accept citation prose', () => {
  assert.equal(normalizeCivilCaseReference('123/2020; no identificado').status, 'AMBIGUOUS');
  assert.equal(normalizeCivilCaseReference('precedente 123/2020').status, 'UNSUPPORTED');
  assert.equal(normalizeCivilCaseReference('123/2020, 456/2021').cases.length, 2);
});

test('field alignment conflicts remain ambiguous and case-only does not invent year', () => {
  assert.equal(normalizeCivilCaseReference({ rawCase: '123/2020', rawYear: '2021' }).status, 'AMBIGUOUS');
  const legacy = normalizeCivilCaseReference({ rawCase: '68.530' });
  assert.equal(legacy.status, 'VALID_LEGACY');
  assert.equal(legacy.canonicalYear, null);
});

test('long malicious inputs terminate quickly without a valid result', () => {
  const input = `${'1'.repeat(250000)}${'a'.repeat(250000)}`;
  const started = process.hrtime.bigint();
  const result = normalizeCivilCaseReference(input);
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.notEqual(result.status, 'VALID_CANONICAL');
  assert.notEqual(result.status, 'VALID_LEGACY');
  assert.ok(durationMs < 1000, `normalizer took ${durationMs} ms`);
});

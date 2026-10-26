import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPdfPassageCitation,
  findPdfTextMatches,
  joinPdfTextItems,
  normalizePdfSearchText,
} from '../src/lib/pdf-text-search.ts';

test('folds accents and case while keeping ñ distinct', () => {
  assert.equal(normalizePdfSearchText('RESPONSABILIDAD CIVÍL'), 'responsabilidad civil');
  assert.equal(findPdfTextMatches(['El niño llamó al nino.'], 'niño').length, 1);
  assert.equal(findPdfTextMatches(['El niño llamó al nino.'], 'nino').length, 1);
});

test('joins fragments within a word and separates words by geometry', () => {
  const text = joinPdfTextItems([
    { str: 'responsa', transform: [1, 0, 0, 10, 0, 100], width: 42, height: 10 },
    { str: 'bilidad', transform: [1, 0, 0, 10, 42.4, 100], width: 35, height: 10 },
    { str: 'civil', transform: [1, 0, 0, 10, 82, 100], width: 22, height: 10 },
  ]);
  assert.equal(text, 'responsabilidad civil');
});

test('matches a phrase spanning PDF.js items and line breaks', () => {
  const text = joinPdfTextItems([
    { str: 'daño', transform: [1, 0, 0, 10, 0, 100], width: 22, height: 10, hasEOL: true },
    { str: 'moral', transform: [1, 0, 0, 10, 0, 88], width: 25, height: 10 },
  ]);
  assert.match(text, /daño moral/u);
  assert.equal(findPdfTextMatches([text], 'daño moral').length, 1);
  assert.equal(findPdfTextMatches([text], 'dano moral').length, 0);
});

test('joins a Spanish hyphenated line break without inventing OCR', () => {
  const text = joinPdfTextItems([
    { str: 'responsabili-', transform: [1, 0, 0, 10, 0, 100], width: 60, height: 10, hasEOL: true },
    { str: 'dad civil', transform: [1, 0, 0, 10, 0, 88], width: 44, height: 10 },
  ]);
  assert.equal(text, 'responsabilidad civil');
});

test('counts non-overlapping logical matches page by page', () => {
  assert.deepEqual(
    findPdfTextMatches(['civil civil', '', 'responsabilidad civil.'], 'civil').map(({ page, offset }) => ({ page, offset })),
    [
      { page: 1, offset: 0 },
      { page: 1, offset: 6 },
      { page: 3, offset: 16 },
    ],
  );
});

test('maps accent-tolerant matches back to the exact extracted source passage', () => {
  const source = 'Introducción: Córdoba   civil.';
  const match = findPdfTextMatches([source], 'cordoba civil')[0];
  assert.ok(match);
  assert.equal(source.slice(match.sourceStart, match.sourceEnd), 'Córdoba   civil');
  assert.equal(match.passage, 'Córdoba   civil');
});

test('wraps only bounded exact local passages around a canonical page citation', () => {
  const citation = 'Cámara Civil, Sala C, p. 8';
  assert.equal(
    formatPdfPassageCitation('  Córdoba   civil  ', citation),
    '“Córdoba   civil” — Cámara Civil, Sala C, p. 8',
  );
  assert.equal(formatPdfPassageCitation(' ', citation), null);
  assert.equal(formatPdfPassageCitation('civil', ' '), null);
  assert.equal(formatPdfPassageCitation('x'.repeat(501), citation), null);
});

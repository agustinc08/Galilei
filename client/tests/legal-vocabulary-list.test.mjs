import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterLegalVocabulary,
  findLegalVocabularyMatches,
  normalizeLegalVocabularyText,
} from '../src/lib/legal-vocabulary-list.ts';

const entries = [
  {
    nombre: 'Responsabilidad médica',
    descripcion: 'Voz propuesta',
    activo: false,
    sinonimos: [{ termino: 'Daño iatrogénico', activo: false }],
  },
  {
    nombre: 'Daño de niño',
    activo: true,
    sinonimos: [],
  },
];

test('search ignores accent differences but preserves ñ as a distinct letter', () => {
  assert.equal(normalizeLegalVocabularyText('MÉDICA'), 'medica');
  assert.equal(normalizeLegalVocabularyText('niño'), 'niño');
  assert.notEqual(
    normalizeLegalVocabularyText('niño'),
    normalizeLegalVocabularyText('nino'),
  );
  assert.equal(
    filterLegalVocabulary(entries, 'medica', 'ALL').length,
    1,
  );
  assert.deepEqual(filterLegalVocabulary(entries, 'nino', 'ALL'), []);
});

test('status filtering distinguishes active and inactive entries', () => {
  assert.deepEqual(filterLegalVocabulary(entries, '', 'ACTIVE'), [entries[1]]);
  assert.deepEqual(filterLegalVocabulary(entries, '', 'INACTIVE'), [entries[0]]);
});

test('duplicate suggestions match accents and punctuation without merging ñ with n', () => {
  assert.deepEqual(
    findLegalVocabularyMatches(entries, 'responsabilidad medica'),
    [{ term: 'Responsabilidad médica', relation: 'voz' }],
  );
  assert.deepEqual(
    findLegalVocabularyMatches(entries, 'Daño-iatrogénico'),
    [{ term: 'Daño iatrogénico', relation: 'equivalencia' }],
  );
  assert.deepEqual(findLegalVocabularyMatches(entries, 'dano de nino'), []);
});

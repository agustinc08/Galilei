import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSuggestionMeta } from '../src/lib/search-suggestion-presentation.ts';

test('legal suggestions show their validated category without inventing counts', () => {
  assert.equal(
    searchSuggestionMeta({ value: 'Voz QA', tipo: 'voz_juridica' }),
    'Voz jurídica validada',
  );
  assert.equal(
    searchSuggestionMeta({
      value: 'Término QA',
      tipo: 'termino_relacionado',
      relacion: 'Voz QA',
    }),
    'Término relacionado · Voz QA',
  );
});

test('exact matches only describe exact stored sumario topics and legacy totals stay readable', () => {
  assert.equal(
    searchSuggestionMeta({ value: 'Tema QA', tipo: 'coincidencia_exacta' }),
    'Coincidencia exacta en tema de sumario',
  );
  assert.equal(
    searchSuggestionMeta({ value: 'Tema QA', tipo: 'tema', total: 4 }),
    'Tema · 4 registros',
  );
});

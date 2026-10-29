import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLegacyBreaks } from '../src/lib/html-to-plain-text.ts';
import { confidenceLabel, evidenceLabel, reviewStatusLabel } from '../src/lib/review-presentation.ts';

test('legacy summary breaks become safe text line breaks', () => {
  assert.equal(normalizeLegacyBreaks('Uno<br>Dos<BR />Tres'), 'Uno\nDos\nTres');
  assert.equal(normalizeLegacyBreaks('Uno &lt;br&gt; Dos'), 'Uno \n Dos');
  assert.equal(normalizeLegacyBreaks('texto &lt;script&gt;alert(1)&lt;/script&gt;'), 'texto &lt;script&gt;alert(1)&lt;/script&gt;');
});

test('editorial evidence and confidence use human labels without exposing raw fields', () => {
  assert.equal(confidenceLabel('HIGH_CONFIDENCE'), 'Coincidencia alta');
  assert.equal(reviewStatusLabel('REVIEW_PENDING'), 'Pendiente de revisión humana');
  const text = evidenceLabel({ strategies: ['EXACT_LEGACY_ID_OR_SENTENCE_NUMBER_FILENAME'] });
  assert.match(text, /identificador o número de sentencia/u);
  assert.doesNotMatch(text, /EXACT_LEGACY|strategies/u);
  assert.doesNotMatch(evidenceLabel({ internalKey: 'PRIVATE_VALUE' }), /internalKey|PRIVATE_VALUE/u);
});

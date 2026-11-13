import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSearchHighlightMarkup } from '../src/lib/search-highlight-markup.ts';

test('parses only the supported mark wrapper and decodes escaped source text once', () => {
  assert.deepEqual(
    parseSearchHighlightMarkup('Texto &amp; <mark>daño</mark> &lt;final&gt;'),
    [
      { kind: 'text', text: 'Texto & ' },
      { kind: 'mark', text: 'daño' },
      { kind: 'text', text: ' <final>' },
    ],
  );
});

test('leaves unexpected HTML tags as text instead of treating them as markup', () => {
  const tokens = parseSearchHighlightMarkup(
    '<img src=x onerror=alert(1)> <mark>coincidencia</mark>',
  );
  assert.deepEqual(tokens, [
    { kind: 'text', text: '<img src=x onerror=alert(1)> ' },
    { kind: 'mark', text: 'coincidencia' },
  ]);
});

import assert from 'node:assert/strict';
import { buildPdfTextPageMap, mapPdfMatch } from '../src/app/(admin)/corpus/[id]/pdf-match-mapper';

function match(text: string, start: number, end: number, extras: Record<string, unknown> = {}) {
  return { page: 1, start, end, text, term: text, ordinal: 1, ...extras };
}

function run() {
  const exactText = 'Sentencia sobre responsabilidad civil con fundamento.';
  const exactStart = exactText.indexOf('responsabilidad civil');
  const exactPhrase = 'responsabilidad civil';
  const direct = mapPdfMatch(buildPdfTextPageMap([{ str: exactText }]), match(
    exactPhrase, exactStart, exactStart + exactPhrase.length,
    { contextBefore: exactText.slice(0, exactStart), contextAfter: exactText.slice(exactStart + exactPhrase.length) },
  ));
  assert.equal(direct.status, 'DIRECT_EXACT');
  assert.deepEqual(direct.segments, [{ itemIndex: 0, startInItem: exactStart, endInItem: exactStart + exactPhrase.length }]);

  const lineText = 'La reparación del daño moral fue admitida.';
  const phraseStart = lineText.indexOf('daño moral');
  const multiItemPage = buildPdfTextPageMap([
    { str: 'La reparación del daño', hasEOL: true },
    { str: 'moral fue admitida.' },
  ]);
  const multiItem = mapPdfMatch(multiItemPage, match('daño moral', phraseStart, phraseStart + 10, {
    contextBefore: 'La reparación del ', contextAfter: ' fue admitida.',
  }));
  assert.equal(multiItem.status, 'NORMALIZED_EXACT');
  assert.deepEqual(multiItem.segments, [
    { itemIndex: 0, startInItem: 18, endInItem: 22 },
    { itemIndex: 1, startInItem: 0, endInItem: 5 },
  ]);

  const repeatBlock = `${'x'.repeat(40)} daño ${'y'.repeat(40)} `;
  const repeatedSource = `daño único; ${repeatBlock}${repeatBlock}`;
  const occurrences = [...repeatedSource.matchAll(/daño/gu)].map((item) => item.index!);
  const secondStart = occurrences[1];
  const repeatedPage = buildPdfTextPageMap([{ str: repeatedSource }]);
  const second = mapPdfMatch(repeatedPage, match('daño', secondStart, secondStart + 4, {
    ordinal: 2,
    pageOccurrenceOrdinal: 2,
    contextBefore: repeatedSource.slice(Math.max(0, secondStart - 64), secondStart),
    contextAfter: repeatedSource.slice(secondStart + 4, secondStart + 100),
  }));
  assert.equal(second.status, 'DIRECT_EXACT');
  assert.deepEqual(second.segments, [{ itemIndex: 0, startInItem: secondStart, endInItem: secondStart + 4 }]);

  const diacriticPage = buildPdfTextPageMap([{ str: 'La accion y el ano discutido.' }]);
  const accented = mapPdfMatch(diacriticPage, match('acción', 3, 9, {
    contextBefore: 'La ', contextAfter: ' y el ano discutido.',
  }));
  assert.equal(accented.status, 'NORMALIZED_EXACT');
  const enyePage = buildPdfTextPageMap([{ str: 'La sentencia menciona el daño.' }]);
  assert.equal(mapPdfMatch(enyePage, match('dano', 25, 29)).status, 'UNMAPPABLE');
  assert.equal(mapPdfMatch(buildPdfTextPageMap([]), match('término', 0, 7)).status, 'NO_TEXT_LAYER');

  const ambiguousPage = buildPdfTextPageMap([{ str: 'daño y daño' }]);
  assert.equal(mapPdfMatch(ambiguousPage, match('daño', 0, 4)).status, 'AMBIGUOUS');
  const wrongContext = mapPdfMatch(ambiguousPage, match('daño', 0, 4, {
    pageOccurrenceOrdinal: 1,
    contextBefore: 'texto que no existe ',
    contextAfter: ' contexto ajeno',
  }));
  assert.equal(wrongContext.status, 'UNMAPPABLE');
  assert.deepEqual(wrongContext.segments, []);

  const geometricPage = buildPdfTextPageMap([
    { str: 'daño', transform: [12, 0, 0, 12, 10, 100], width: 24, height: 12 },
    { str: 'moral', transform: [12, 0, 0, 12, 38, 100], width: 28, height: 12 },
  ]);
  assert.equal(geometricPage.normalizedText, 'daño moral');
  assert.deepEqual(mapPdfMatch(geometricPage, match('daño moral', 0, 10)).segments, [
    { itemIndex: 0, startInItem: 0, endInItem: 4 },
    { itemIndex: 1, startInItem: 0, endInItem: 5 },
  ]);

  console.log('PDF_MATCH_MAPPER_TESTS=PASS; cases=8; falseMappings=0');
}

run();

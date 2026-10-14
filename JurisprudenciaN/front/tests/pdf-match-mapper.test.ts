import assert from 'node:assert/strict';
import {
  alignPdfTextPageMap,
  buildPdfTextPageMap,
  mapPdfMatch,
  mapPdfMatches,
  normalizePdfMatchText,
} from '../src/app/(admin)/corpus/[id]/pdf-match-mapper';

function match(text: string, start: number, end: number, extras: Record<string, unknown> = {}) {
  return { page: 1, start, end, text, term: text, ordinal: 1, ...extras };
}

function aligned(items: Array<{ str: string; hasEOL?: boolean; transform?: number[]; width?: number; dir?: string }>, sourceText: string) {
  return alignPdfTextPageMap(buildPdfTextPageMap(items), sourceText);
}

function run() {
  const exactText = 'Sentencia sobre responsabilidad civil con fundamento.';
  const exactStart = exactText.indexOf('responsabilidad civil');
  const exactPhrase = 'responsabilidad civil';
  const direct = mapPdfMatch(aligned([{ str: exactText }], exactText), match(
    exactPhrase, exactStart, exactStart + exactPhrase.length,
  ));
  assert.equal(direct.status, 'DIRECT_EXACT');
  assert.deepEqual(direct.segments, [{ itemIndex: 0, startInItem: exactStart, endInItem: exactStart + exactPhrase.length }]);

  const removedSpaceSource = 'La reparación del daño   moral fue admitida.';
  const removedSpaceStart = removedSpaceSource.indexOf('daño');
  const removedSpace = mapPdfMatch(aligned([
    { str: 'La reparación del daño moral fue admitida.' },
  ], removedSpaceSource), match(
    removedSpaceSource.slice(removedSpaceStart, removedSpaceStart + 13),
    removedSpaceStart,
    removedSpaceStart + 13,
  ));
  assert.equal(removedSpace.status, 'NORMALIZED_EXACT');

  const insertedSpaceSource = 'La reparación del daño moral fue admitida.';
  const insertedSpaceStart = insertedSpaceSource.indexOf('daño moral');
  const insertedSpace = mapPdfMatch(aligned([
    { str: 'La reparación del daño   moral fue admitida.' },
  ], insertedSpaceSource), match(
    'daño moral', insertedSpaceStart, insertedSpaceStart + 'daño moral'.length,
  ));
  assert.equal(insertedSpace.status, 'NORMALIZED_EXACT');

  const lineSource = 'La reparación del daño\r\n\r\nmoral fue admitida.';
  const lineStart = lineSource.indexOf('daño');
  const lineMap = aligned([
    { str: 'La reparación del daño', hasEOL: true },
    { str: 'moral fue admitida.' },
  ], lineSource);
  const lineText = 'daño\r\n\r\nmoral';
  const line = mapPdfMatch(lineMap, match(lineText, lineStart, lineStart + lineText.length));
  assert.equal(line.status, 'SEGMENTED_EXACT');
  assert.deepEqual(line.segments, [
    { itemIndex: 0, startInItem: 18, endInItem: 22 },
    { itemIndex: 1, startInItem: 0, endInItem: 5 },
  ]);

  const explicitItemSource = 'La reparación del daño moral fue admitida.';
  const explicitStart = explicitItemSource.indexOf('daño moral');
  const explicitItems = aligned([
    { str: 'La reparación del daño' },
    { str: ' ' },
    { str: 'moral fue admitida.' },
  ], explicitItemSource);
  const explicitItem = mapPdfMatch(explicitItems, match('daño moral', explicitStart, explicitStart + 10));
  assert.equal(explicitItem.status, 'SEGMENTED_EXACT');
  assert.deepEqual(explicitItem.segments, [
    { itemIndex: 0, startInItem: 18, endInItem: 22 },
    { itemIndex: 1, startInItem: 0, endInItem: 1 },
    { itemIndex: 2, startInItem: 0, endInItem: 5 },
  ]);

  const geometrySource = 'daño moral';
  const geometryMap = aligned([
    { str: 'daño', transform: [12, 0, 0, 12, 10, 100], width: 24, dir: 'ltr' },
    { str: 'moral', transform: [12, 0, 0, 12, 38, 100], width: 28, dir: 'ltr' },
  ], geometrySource);
  const geometry = mapPdfMatch(geometryMap, match(geometrySource, 0, geometrySource.length));
  assert.equal(geometryMap.alignment?.status, 'WHITESPACE_EQUIVALENT');
  assert.equal(geometry.status, 'SEGMENTED_EXACT');
  assert.deepEqual(geometry.segments, [
    { itemIndex: 0, startInItem: 0, endInItem: 4 },
    { itemIndex: 1, startInItem: 0, endInItem: 5 },
  ]);

  const noGeometry = aligned([{ str: 'daño' }, { str: 'moral' }], geometrySource);
  assert.equal(mapPdfMatch(noGeometry, match(geometrySource, 0, geometrySource.length)).status, 'UNMAPPABLE');

  const punctuationSource = 'daño, moral';
  const punctuationPage = aligned([{ str: punctuationSource }], punctuationSource);
  assert.equal(mapPdfMatch(punctuationPage, match('daño moral', 0, punctuationSource.length)).status, 'UNMAPPABLE');
  assert.notEqual(normalizePdfMatchText('daño, moral'), normalizePdfMatchText('daño moral'));
  const extraWordSource = 'daño patrimonial moral';
  const extraWordPage = aligned([{ str: extraWordSource }], extraWordSource);
  assert.equal(mapPdfMatch(extraWordPage, match('daño moral', 0, 'daño moral'.length)).status, 'UNMAPPABLE');

  const duplicateSource = 'daño reconocido; daño confirmado.';
  const secondStart = duplicateSource.lastIndexOf('daño');
  const duplicatePage = aligned([{ str: duplicateSource }], duplicateSource);
  const second = mapPdfMatch(duplicatePage, match('daño', secondStart, secondStart + 4, {
    ordinal: 2,
    pageOccurrenceOrdinal: 2,
    contextBefore: 'daño reconocido; ',
    contextAfter: ' confirmado.',
  }));
  assert.equal(second.status, 'DIRECT_EXACT');
  assert.deepEqual(second.segments, [{ itemIndex: 0, startInItem: secondStart, endInItem: secondStart + 4 }]);

  const nonWhitespacePage = buildPdfTextPageMap([{ str: '\nDaño reconocido; daño confirmado.' }]);
  const repeatedContext = mapPdfMatch(nonWhitespacePage, match('daño', secondStart, secondStart + 4, {
    pageOccurrenceOrdinal: 2,
    contextBefore: 'daño reconocido; ',
    contextAfter: ' confirmado.',
  }));
  assert.equal(repeatedContext.status, 'CONTEXT_NORMALIZED_EXACT');

  const accentSource = 'La acción y el daño discutido.';
  const accentStart = accentSource.indexOf('acción');
  const accentPage = alignPdfTextPageMap(buildPdfTextPageMap([{ str: 'La accion y el daño discutido.' }]), accentSource);
  const accented = mapPdfMatch(accentPage, match('acción', accentStart, accentStart + 'acción'.length, {
    contextBefore: 'La ', contextAfter: ' y el daño discutido.',
  }));
  assert.equal(accented.status, 'CONTEXT_NORMALIZED_EXACT');

  const enyeSource = 'La sentencia menciona el daño.';
  const enyePage = aligned([{ str: enyeSource }], enyeSource);
  assert.equal(mapPdfMatch(enyePage, match('dano', 25, 29)).status, 'UNMAPPABLE');
  assert.equal(mapPdfMatch(buildPdfTextPageMap([]), match('término', 0, 7)).status, 'NO_TEXT_LAYER');

  const emojiSource = 'A 😀 daño';
  const emojiPage = aligned([{ str: emojiSource }], emojiSource);
  const emojiStart = emojiSource.indexOf('😀');
  const emoji = mapPdfMatch(emojiPage, match('😀', emojiStart, emojiStart + 2));
  assert.equal(emoji.status, 'DIRECT_EXACT');
  assert.deepEqual(emoji.segments, [{ itemIndex: 0, startInItem: emojiStart, endInItem: emojiStart + 2 }]);
  const afterEmojiStart = emojiSource.indexOf('daño');
  assert.deepEqual(mapPdfMatch(emojiPage, match('daño', afterEmojiStart, afterEmojiStart + 4)).segments, [
    { itemIndex: 0, startInItem: afterEmojiStart, endInItem: afterEmojiStart + 4 },
  ]);

  const ambiguousSource = 'daño y daño';
  const ambiguousPage = buildPdfTextPageMap([{ str: ambiguousSource }]);
  assert.equal(mapPdfMatch(ambiguousPage, match('daño', 0, 4)).status, 'AMBIGUOUS');
  const wrongContext = mapPdfMatch(ambiguousPage, match('daño', 0, 4, {
    pageOccurrenceOrdinal: 1,
    contextBefore: 'texto que no existe ',
    contextAfter: ' contexto ajeno',
  }));
  assert.equal(wrongContext.status, 'UNMAPPABLE');
  assert.deepEqual(wrongContext.segments, []);

  const noSeparatorSource = 'dañomoral';
  const pdfAddedWhitespace = aligned([{ str: 'daño moral' }], noSeparatorSource);
  assert.equal(mapPdfMatch(pdfAddedWhitespace, match(noSeparatorSource, 0, noSeparatorSource.length)).status, 'UNMAPPABLE');

  const raceSource = 'daño moral y responsabilidad civil.';
  const raceItems = [{ str: raceSource }];
  const firstMatch = match('daño moral', 0, 'daño moral'.length);
  const secondMatch = match('responsabilidad civil', raceSource.indexOf('responsabilidad'), raceSource.length - 1, { ordinal: 2 });
  const pdfFirst = aligned(raceItems, raceSource);
  const searchFirst = buildPdfTextPageMap(raceItems);
  const pdfThenSearch = mapPdfMatches(alignPdfTextPageMap(pdfFirst, raceSource), [firstMatch, secondMatch]);
  const searchThenPdf = mapPdfMatches(alignPdfTextPageMap(searchFirst, raceSource), [firstMatch, secondMatch]);
  assert.deepEqual(searchThenPdf, pdfThenSearch);
  assert.deepEqual(mapPdfMatches(pdfFirst, [secondMatch]), [mapPdfMatch(pdfFirst, secondMatch)]);
  const otherPage = alignPdfTextPageMap(buildPdfTextPageMap([{ str: 'contratos y daños.' }]), 'contratos y daños.');
  assert.equal(mapPdfMatch(otherPage, firstMatch).status, 'UNMAPPABLE');

  console.log('PDF_MATCH_MAPPER_TESTS=PASS; cases=17; falseMappings=0');
}

run();

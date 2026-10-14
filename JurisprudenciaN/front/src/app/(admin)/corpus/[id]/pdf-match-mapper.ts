export type PdfTextItemInput = {
  itemIndex?: number;
  str: string;
  hasEOL?: boolean;
  dir?: string;
  transform?: number[];
  width?: number;
  height?: number;
};

export type PdfMatchInput = {
  page: number;
  start: number;
  end: number;
  text?: string;
  term: string;
  ordinal: number;
  contextBefore?: string;
  contextAfter?: string;
  pageOccurrenceOrdinal?: number;
};

export type PdfTextSegment = {
  itemIndex: number;
  startInItem: number;
  endInItem: number;
};

export type PdfMatchMappingStatus =
  | 'DIRECT_EXACT'
  | 'SEGMENTED_EXACT'
  | 'NORMALIZED_EXACT'
  | 'CONTEXT_EXACT'
  | 'CONTEXT_NORMALIZED_EXACT'
  | 'AMBIGUOUS'
  | 'UNMAPPABLE'
  | 'NO_TEXT_LAYER';

export type PdfMatchMapping = {
  ordinal: number;
  status: PdfMatchMappingStatus;
  segments: PdfTextSegment[];
  normalizedStart?: number;
  normalizedEnd?: number;
  reason?: string;
};

type Origin = { itemIndex: number; start: number; end: number };
type NormalizedUnit = { rawStart: number; rawEnd: number; origins: Origin[] };
type NonWhitespaceUnit = {
  text: string;
  rawStart: number;
  rawEnd: number;
  origins: Origin[];
};

export type PdfTextPageAlignmentStatus =
  | 'EXACT'
  | 'WHITESPACE_EQUIVALENT'
  | 'NON_WHITESPACE_DIFFERENCE';

type PdfTextPageAlignment = {
  status: PdfTextPageAlignmentStatus;
  sourceText: string;
  normalizedSourceText: string;
  sourceUnits: NonWhitespaceUnit[];
  pdfUnits: NonWhitespaceUnit[];
};

export type PdfTextPageMap = {
  rawText: string;
  rawOrigins: Array<Origin | null>;
  nonWhitespaceUnits: NonWhitespaceUnit[];
  normalizedText: string;
  normalizedUnits: NormalizedUnit[];
  itemCount: number;
  nonEmptyItemCount: number;
  items: Array<{
    itemIndex: number;
    start: number;
    end: number;
    str: string;
    hasEOL: boolean;
    dir?: string;
    transform?: number[];
    width?: number;
    height?: number;
  }>;
  alignment?: PdfTextPageAlignment;
};

function normalizeSpanText(value: string) {
  return value.toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/n\u0303/gu, '\uE000')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\uE000/gu, 'ñ')
    .normalize('NFC')
    .replace(/\s+/gu, ' ');
}

export function normalizePdfMatchText(value: string) {
  return normalizeSpanText(value);
}

function allOccurrences(source: string, needle: string) {
  const found: number[] = [];
  if (!needle) return found;
  let cursor = 0;
  while (cursor <= source.length - needle.length) {
    const index = source.indexOf(needle, cursor);
    if (index < 0) break;
    if (isUtf16Boundary(source, index) && isUtf16Boundary(source, index + needle.length)) {
      found.push(index);
    }
    cursor = index + 1;
  }
  return found;
}

function isUtf16Boundary(value: string, index: number) {
  if (index <= 0 || index >= value.length) return true;
  const previous = value.charCodeAt(index - 1);
  const current = value.charCodeAt(index);
  return !(previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff);
}

function appendRaw(
  state: { text: string; origins: Array<Origin | null> },
  value: string,
  itemIndex: number | null,
  itemOffset = 0,
) {
  state.text += value;
  for (let index = 0; index < value.length; index += 1) {
    state.origins.push(itemIndex === null ? null : {
      itemIndex,
      start: itemOffset + index,
      end: itemOffset + index + 1,
    });
  }
}

function uniqueOrigins(origins: Array<Origin | null>) {
  const result: Origin[] = [];
  for (const origin of origins) {
    if (!origin) continue;
    const previous = result.at(-1);
    if (previous && previous.itemIndex === origin.itemIndex && origin.start <= previous.end) {
      previous.end = Math.max(previous.end, origin.end);
    } else if (!result.some((item) => item.itemIndex === origin.itemIndex && item.start === origin.start && item.end === origin.end)) {
      result.push({ ...origin });
    }
  }
  return result;
}

function buildNormalizedUnits(rawText: string, rawOrigins: Array<Origin | null>) {
  const normalizedUnits: NormalizedUnit[] = [];
  const pageNonWhitespaceUnits: NonWhitespaceUnit[] = [];
  let normalizedText = '';
  let index = 0;
  while (index < rawText.length) {
    const start = index;
    const first = String.fromCodePoint(rawText.codePointAt(index)!);
    if (/^\s$/u.test(first)) {
      index += first.length;
      while (index < rawText.length) {
        const next = String.fromCodePoint(rawText.codePointAt(index)!);
        if (!/^\s$/u.test(next)) break;
        index += next.length;
      }
      normalizedText += ' ';
      normalizedUnits.push({
        rawStart: start,
        rawEnd: index,
        origins: uniqueOrigins(rawOrigins.slice(start, index)),
      });
      continue;
    }

    let cluster = first;
    index += first.length;
    while (index < rawText.length) {
      const next = String.fromCodePoint(rawText.codePointAt(index)!);
      if (!/^\p{M}$/u.test(next)) break;
      cluster += next;
      index += next.length;
    }
    pageNonWhitespaceUnits.push({
      text: cluster.normalize('NFC'),
      rawStart: start,
      rawEnd: index,
      origins: uniqueOrigins(rawOrigins.slice(start, index)),
    });
    const normalized = normalizeSpanText(cluster);
    const origins = uniqueOrigins(rawOrigins.slice(start, index));
    normalizedText += normalized;
    for (let unit = 0; unit < normalized.length; unit += 1) {
      normalizedUnits.push({ rawStart: start, rawEnd: index, origins });
    }
  }
  return { normalizedText, normalizedUnits, nonWhitespaceUnits: pageNonWhitespaceUnits };
}

export function buildPdfTextPageMap(inputItems: PdfTextItemInput[]): PdfTextPageMap {
  const state = { text: '', origins: [] as Array<Origin | null> };
  const items: PdfTextPageMap['items'] = [];
  inputItems.forEach((item, arrayIndex) => {
    const itemIndex = item.itemIndex ?? arrayIndex;
    const start = state.text.length;
    appendRaw(state, item.str, itemIndex);
    const end = state.text.length;
    items.push({
      itemIndex,
      start,
      end,
      str: item.str,
      hasEOL: Boolean(item.hasEOL),
      dir: item.dir,
      transform: item.transform,
      width: item.width,
      height: item.height,
    });
    if (item.hasEOL) appendRaw(state, '\n', null);
  });
  const normalized = buildNormalizedUnits(state.text, state.origins);
  return {
    rawText: state.text,
    rawOrigins: state.origins,
    nonWhitespaceUnits: normalized.nonWhitespaceUnits,
    normalizedText: normalized.normalizedText,
    normalizedUnits: normalized.normalizedUnits,
    itemCount: inputItems.length,
    nonEmptyItemCount: inputItems.filter((item) => item.str.length > 0).length,
    items,
  };
}

function nonWhitespaceUnits(value: string, origins?: Array<Origin | null>): NonWhitespaceUnit[] {
  const units: NonWhitespaceUnit[] = [];
  let index = 0;
  while (index < value.length) {
    const rawStart = index;
    let text = String.fromCodePoint(value.codePointAt(index)!);
    index += text.length;
    if (/^\s$/u.test(text)) continue;
    while (index < value.length) {
      const next = String.fromCodePoint(value.codePointAt(index)!);
      if (!/^\p{M}$/u.test(next)) break;
      text += next;
      index += next.length;
    }
    units.push({
      text: text.normalize('NFC'),
      rawStart,
      rawEnd: index,
      origins: origins ? uniqueOrigins(origins.slice(rawStart, index)) : [],
    });
  }
  return units;
}

/** Aligns source offsets to PDF.js glyphs only when every non-whitespace code point is preserved in order. */
export function alignPdfTextPageMap(page: PdfTextPageMap, sourceText: string): PdfTextPageMap {
  const sourceUnits = nonWhitespaceUnits(sourceText);
  const pdfUnits = page.nonWhitespaceUnits;
  const sameNonWhitespace = sourceUnits.length === pdfUnits.length &&
    sourceUnits.every((unit, index) => unit.text === pdfUnits[index]?.text);
  return {
    ...page,
    alignment: {
      status: !sameNonWhitespace
        ? 'NON_WHITESPACE_DIFFERENCE'
        : sourceText === page.rawText
          ? 'EXACT'
          : 'WHITESPACE_EQUIVALENT',
      sourceText,
      normalizedSourceText: normalizeSpanText(sourceText),
      sourceUnits,
      pdfUnits,
    },
  };
}

function geometryConfirmsWhitespace(page: PdfTextPageMap, left: NonWhitespaceUnit, right: NonWhitespaceUnit) {
  const previousOrigin = left.origins.at(-1);
  const currentOrigin = right.origins[0];
  if (!previousOrigin || !currentOrigin || previousOrigin.itemIndex === currentOrigin.itemIndex) return false;
  const previous = page.items.find((item) => item.itemIndex === previousOrigin.itemIndex);
  const current = page.items.find((item) => item.itemIndex === currentOrigin.itemIndex);
  if (!previous || !current || previous.hasEOL || previous.dir === 'ttb' || current.dir === 'ttb') return false;
  if (previous.dir && current.dir && previous.dir !== current.dir) return false;
  const prev = previous.transform;
  const next = current.transform;
  if (!prev || !next || prev.length < 6 || next.length < 6) return false;
  const coordinateScale = Math.max(1, Math.abs(prev[5]), Math.abs(next[5]));
  const baselineTolerance = Number.EPSILON * coordinateScale * 16;
  if (Math.abs(prev[5] - next[5]) > baselineTolerance) return false;
  if (!Number.isFinite(previous.width) || previous.width! <= 0) return false;
  const gap = next[4] - (prev[4] + previous.width!);
  // The source extraction confirms a separator here; positive same-baseline space is the secondary PDF evidence.
  return Number.isFinite(gap) && gap > 0;
}

function segmentsForRawRange(page: PdfTextPageMap, start: number, end: number): PdfTextSegment[] {
  const segments: PdfTextSegment[] = [];
  for (let index = start; index < end; index += 1) {
    const origin = page.rawOrigins[index];
    if (!origin) continue;
    const previous = segments.at(-1);
    if (previous && previous.itemIndex === origin.itemIndex && origin.start <= previous.endInItem) {
      previous.endInItem = Math.max(previous.endInItem, origin.end);
    } else {
      segments.push({ itemIndex: origin.itemIndex, startInItem: origin.start, endInItem: origin.end });
    }
  }
  return segments;
}

function mappedByAlignedOffsets(page: PdfTextPageMap, match: PdfMatchInput, needle: string): PdfMatchMapping | null {
  const alignment = page.alignment;
  if (!alignment || alignment.status === 'NON_WHITESPACE_DIFFERENCE') return null;
  const fail = (reason: string): PdfMatchMapping => ({
    ordinal: match.ordinal,
    status: 'UNMAPPABLE',
    segments: [],
    reason,
  });
  if (!Number.isInteger(match.start) || !Number.isInteger(match.end) ||
      match.start < 0 || match.end <= match.start || match.end > alignment.sourceText.length ||
      !isUtf16Boundary(alignment.sourceText, match.start) || !isUtf16Boundary(alignment.sourceText, match.end)) {
    return fail('INVALID_SOURCE_OFFSETS');
  }
  const sourceSpan = alignment.sourceText.slice(match.start, match.end);
  if (normalizeSpanText(sourceSpan) !== needle ||
      (match.text && normalizeSpanText(sourceSpan) !== normalizeSpanText(match.text))) {
    return fail('SOURCE_SPAN_TEXT_MISMATCH');
  }

  const overlapping = alignment.sourceUnits
    .map((unit, index) => ({ unit, index }))
    .filter(({ unit }) => unit.rawEnd > match.start && unit.rawStart < match.end);
  if (!overlapping.length || overlapping.some(({ unit }) => unit.rawStart < match.start || unit.rawEnd > match.end)) {
    return fail('SOURCE_OFFSETS_SPLIT_GLYPH');
  }
  const firstIndex = overlapping[0].index;
  const lastIndex = overlapping.at(-1)!.index;
  const firstPdf = alignment.pdfUnits[firstIndex];
  const lastPdf = alignment.pdfUnits[lastIndex];
  if (!firstPdf?.origins.length || !lastPdf?.origins.length) return fail('NO_PDF_GLYPH_ORIGIN');

  for (let index = firstIndex + 1; index <= lastIndex; index += 1) {
    const leftSource = alignment.sourceUnits[index - 1];
    const rightSource = alignment.sourceUnits[index];
    const leftPdf = alignment.pdfUnits[index - 1];
    const rightPdf = alignment.pdfUnits[index];
    const sourceSeparator = /\s/u.test(alignment.sourceText.slice(leftSource.rawEnd, rightSource.rawStart));
    const pdfSeparator = /\s/u.test(page.rawText.slice(leftPdf.rawEnd, rightPdf.rawStart));
    if (sourceSeparator && !pdfSeparator && !geometryConfirmsWhitespace(page, leftPdf, rightPdf)) {
      return fail('SOURCE_WHITESPACE_WITHOUT_PDF_EVIDENCE');
    }
    if (!sourceSeparator && pdfSeparator) return fail('PDF_SEPARATOR_NOT_IN_SOURCE_SPAN');
  }

  const segments = segmentsForRawRange(page, firstPdf.rawStart, lastPdf.rawEnd);
  if (!segments.length) return fail('NO_VISIBLE_GLYPH_SEGMENTS');
  const rawCandidate = page.rawText.slice(firstPdf.rawStart, lastPdf.rawEnd);
  const itemCount = new Set(segments.map((segment) => segment.itemIndex)).size;
  const isDirect = alignment.status === 'EXACT' && itemCount === 1 &&
    firstPdf.rawStart === overlapping[0].unit.rawStart &&
    lastPdf.rawEnd === overlapping.at(-1)!.unit.rawEnd &&
    rawCandidate === sourceSpan;
  const status: PdfMatchMappingStatus = isDirect
    ? 'DIRECT_EXACT'
    : itemCount > 1
      ? 'SEGMENTED_EXACT'
      : 'NORMALIZED_EXACT';
  return {
    ordinal: match.ordinal,
    status,
    segments,
    normalizedStart: firstIndex,
    normalizedEnd: lastIndex + 1,
  };
}

function takeTailCodePoints(value: string, count: number) {
  return Array.from(value).slice(-count).join('');
}

function takeHeadCodePoints(value: string, count: number) {
  return Array.from(value).slice(0, count).join('');
}

function contextWindows(match: PdfMatchInput) {
  const before = normalizeSpanText(match.contextBefore ?? '');
  const after = normalizeSpanText(match.contextAfter ?? '');
  const windows = [16, 32, 64].map((size) => ({
    before: takeTailCodePoints(before, size),
    after: takeHeadCodePoints(after, size),
  }));
  return windows.filter((window, index) =>
    (window.before || window.after) &&
    windows.findIndex((candidate) => candidate.before === window.before && candidate.after === window.after) === index,
  );
}

function matchesContext(pageText: string, start: number, end: number, window: { before: string; after: string }) {
  const actualBefore = pageText.slice(Math.max(0, start - window.before.length), start);
  const actualAfter = pageText.slice(end, end + window.after.length);
  return (!window.before || actualBefore === window.before) &&
    (!window.after || actualAfter === window.after);
}

function hasExactRawContext(page: PdfTextPageMap, start: number, end: number, match: PdfMatchInput) {
  const before = match.contextBefore ?? '';
  const after = match.contextAfter ?? '';
  if (!before && !after) return false;
  return page.rawText.slice(Math.max(0, start - before.length), start) === before &&
    page.rawText.slice(end, end + after.length) === after;
}

function segmentsForNormalizedRange(page: PdfTextPageMap, start: number, end: number): PdfTextSegment[] {
  const units = page.normalizedUnits.slice(start, end);
  if (!units.length) return [];
  return segmentsForRawRange(page, units[0].rawStart, units.at(-1)!.rawEnd);
}

export function mapPdfMatch(page: PdfTextPageMap, match: PdfMatchInput): PdfMatchMapping {
  const fail = (status: 'AMBIGUOUS' | 'UNMAPPABLE' | 'NO_TEXT_LAYER', reason: string): PdfMatchMapping => ({
    ordinal: match.ordinal,
    status,
    segments: [],
    reason,
  });
  if (!page.nonEmptyItemCount || !page.normalizedText) return fail('NO_TEXT_LAYER', 'EMPTY_TEXT_LAYER');
  const rawNeedle = match.text || match.term;
  const needle = normalizeSpanText(rawNeedle);
  if (!needle) return fail('UNMAPPABLE', 'EMPTY_MATCH_TEXT');

  const aligned = mappedByAlignedOffsets(page, match, needle);
  if (aligned) return aligned;

  const candidates = allOccurrences(page.normalizedText, needle);
  if (!candidates.length) return fail('UNMAPPABLE', 'MATCH_TEXT_NOT_IN_TEXT_LAYER');
  const windows = contextWindows(match);
  let contextual = candidates;
  let usedContext = false;
  for (const window of windows) {
    const filtered = contextual.filter((start) => matchesContext(
      page.normalizedText,
      start,
      start + needle.length,
      window,
    ));
    if (!filtered.length) {
      if (!usedContext) return fail('UNMAPPABLE', 'CONTEXT_ANCHOR_MISMATCH');
      break;
    }
    contextual = filtered;
    usedContext = true;
    if (contextual.length === 1) break;
  }

  let selected: number | undefined;
  if (contextual.length === 1) selected = contextual[0];
  else if (contextual.length > 1 && match.pageOccurrenceOrdinal && match.pageOccurrenceOrdinal > 0) {
    const sourceOccurrences = page.alignment
      ? allOccurrences(page.alignment.normalizedSourceText, needle)
      : [];
    const sameOccurrenceSemantics = sourceOccurrences.length === candidates.length;
    const ordinalCandidate = sameOccurrenceSemantics
      ? candidates[match.pageOccurrenceOrdinal - 1]
      : undefined;
    if (ordinalCandidate !== undefined && contextual.includes(ordinalCandidate)) selected = ordinalCandidate;
    else return fail('AMBIGUOUS', 'ORDINAL_DOES_NOT_DISAMBIGUATE_CONTEXT');
  } else if (contextual.length > 1) return fail('AMBIGUOUS', 'MULTIPLE_CONTEXT_MATCHES');
  else if (!usedContext && windows.length) return fail('UNMAPPABLE', 'CONTEXT_ANCHOR_MISMATCH');
  else if (!windows.length && candidates.length === 1) selected = candidates[0];
  else if (!windows.length && candidates.length > 1 && match.pageOccurrenceOrdinal && match.pageOccurrenceOrdinal > 0) {
    const sourceOccurrences = page.alignment
      ? allOccurrences(page.alignment.normalizedSourceText, needle)
      : [];
    if (sourceOccurrences.length === candidates.length) selected = candidates[match.pageOccurrenceOrdinal - 1];
    if (selected === undefined) return fail('AMBIGUOUS', 'ORDINAL_OCCURRENCES_DIFFER');
  } else if (!windows.length) return fail('AMBIGUOUS', 'REPEATED_TEXT_WITHOUT_ANCHOR');

  if (selected === undefined) return fail('UNMAPPABLE', 'NO_UNIQUE_CONTEXT_ANCHOR');
  const units = page.normalizedUnits.slice(selected, selected + needle.length);
  if (!units.length || units.every((unit) => !unit.origins.length)) {
    return fail('UNMAPPABLE', 'NO_VISIBLE_GLYPH_SEGMENTS');
  }
  const segments = segmentsForNormalizedRange(page, selected, selected + needle.length);
  if (!segments.length) return fail('UNMAPPABLE', 'NO_VISIBLE_GLYPH_SEGMENTS');

  const rawStart = units[0].rawStart;
  const rawEnd = units.at(-1)!.rawEnd;
  const rawCandidate = page.rawText.slice(rawStart, rawEnd);
  if (normalizeSpanText(rawCandidate) !== needle) return fail('UNMAPPABLE', 'MAPPED_TEXT_NORMALIZATION_MISMATCH');
  const direct = rawStart === match.start && rawEnd === match.end && rawCandidate === rawNeedle;
  const status: PdfMatchMappingStatus = direct
    ? 'DIRECT_EXACT'
    : !usedContext && new Set(segments.map((segment) => segment.itemIndex)).size > 1
      ? 'SEGMENTED_EXACT'
      : !usedContext
        ? 'NORMALIZED_EXACT'
        : hasExactRawContext(page, rawStart, rawEnd, match) && rawCandidate === rawNeedle
          ? 'CONTEXT_EXACT'
          : 'CONTEXT_NORMALIZED_EXACT';
  return {
    ordinal: match.ordinal,
    status,
    segments,
    normalizedStart: selected,
    normalizedEnd: selected + needle.length,
  };
}

export function mapPdfMatches(page: PdfTextPageMap, matches: PdfMatchInput[]) {
  return matches.map((match) => mapPdfMatch(page, match));
}

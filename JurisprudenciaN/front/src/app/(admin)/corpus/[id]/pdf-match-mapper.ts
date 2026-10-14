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
  | 'CONTEXT_EXACT'
  | 'NORMALIZED_EXACT'
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

export type PdfTextPageMap = {
  rawText: string;
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
    found.push(index);
    cursor = index + 1;
  }
  return found;
}

function geometryNeedsSeparator(previous: PdfTextItemInput, current: PdfTextItemInput) {
  if (previous.hasEOL || previous.dir === 'ttb' || current.dir === 'ttb') return false;
  const prev = previous.transform;
  const next = current.transform;
  if (!prev || !next || prev.length < 6 || next.length < 6) return false;
  if (previous.dir && current.dir && previous.dir !== current.dir) return false;
  const fontSize = Math.max(1, Math.min(Math.abs(prev[0]) || 1, Math.abs(next[0]) || 1));
  const sameBaseline = Math.abs(prev[5] - next[5]) <= Math.max(1, fontSize * 0.25);
  if (!sameBaseline) return false;
  const gap = next[4] - (prev[4] + (previous.width ?? 0));
  return gap > Math.max(1.5, fontSize * 0.2);
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

export function buildPdfTextPageMap(inputItems: PdfTextItemInput[]): PdfTextPageMap {
  const state = { text: '', origins: [] as Array<Origin | null> };
  const items: PdfTextPageMap['items'] = [];
  let previousNonEmpty: PdfTextItemInput | undefined;
  inputItems.forEach((item, arrayIndex) => {
    const itemIndex = item.itemIndex ?? arrayIndex;
    if (item.str && previousNonEmpty &&
        !/\s$/u.test(state.text) && !/^\s/u.test(item.str) &&
        geometryNeedsSeparator(previousNonEmpty, item)) {
      appendRaw(state, ' ', null);
    }
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
    if (item.str) previousNonEmpty = item;
    if (item.hasEOL) appendRaw(state, '\n', null);
  });

  const normalizedUnits: NormalizedUnit[] = [];
  let normalizedText = '';
  let index = 0;
  while (index < state.text.length) {
    const start = index;
    const first = String.fromCodePoint(state.text.codePointAt(index)!);
    if (/^\s$/u.test(first)) {
      const whitespaceOrigins: Array<Origin | null> = [];
      index += first.length;
      whitespaceOrigins.push(state.origins.slice(start, index).at(0) ?? null);
      while (index < state.text.length) {
        const next = String.fromCodePoint(state.text.codePointAt(index)!);
        if (!/^\s$/u.test(next)) break;
        whitespaceOrigins.push(state.origins[index] ?? null);
        index += next.length;
      }
      normalizedText += ' ';
      normalizedUnits.push({
        rawStart: start,
        rawEnd: index,
        origins: uniqueOrigins(whitespaceOrigins),
      });
      continue;
    }

    let cluster = first;
    index += first.length;
    while (index < state.text.length) {
      const next = String.fromCodePoint(state.text.codePointAt(index)!);
      if (!/^\p{M}$/u.test(next)) break;
      cluster += next;
      index += next.length;
    }
    const normalized = normalizeSpanText(cluster);
    const origins = uniqueOrigins(state.origins.slice(start, index));
    normalizedText += normalized;
    for (let unit = 0; unit < normalized.length; unit += 1) {
      normalizedUnits.push({ rawStart: start, rawEnd: index, origins });
    }
  }

  return {
    rawText: state.text,
    normalizedText,
    normalizedUnits,
    itemCount: inputItems.length,
    nonEmptyItemCount: inputItems.filter((item) => item.str.length > 0).length,
    items,
  };
}

function anchorsMatch(
  pageText: string,
  matchStart: number,
  matchEnd: number,
  contextBefore: string,
  contextAfter: string,
) {
  const before = normalizeSpanText(contextBefore);
  const after = normalizeSpanText(contextAfter);
  const beforeAnchor = before.slice(-Math.min(32, before.length));
  const afterAnchor = after.slice(0, Math.min(32, after.length));
  const actualBefore = pageText.slice(Math.max(0, matchStart - beforeAnchor.length), matchStart);
  const actualAfter = pageText.slice(matchEnd, matchEnd + afterAnchor.length);
  return {
    hasContext: Boolean(beforeAnchor || afterAnchor),
    matches: (!beforeAnchor || actualBefore === beforeAnchor) &&
      (!afterAnchor || actualAfter === afterAnchor),
  };
}

function segmentsForRange(page: PdfTextPageMap, start: number, end: number): PdfTextSegment[] {
  const origins = page.normalizedUnits.slice(start, end).flatMap((unit) => unit.origins);
  const ordered = origins.sort((left, right) => left.itemIndex - right.itemIndex || left.start - right.start);
  const segments: PdfTextSegment[] = [];
  for (const origin of ordered) {
    const previous = segments.at(-1);
    if (previous && previous.itemIndex === origin.itemIndex && origin.start <= previous.endInItem) {
      previous.endInItem = Math.max(previous.endInItem, origin.end);
    } else if (!segments.some((item) => item.itemIndex === origin.itemIndex && item.startInItem === origin.start && item.endInItem === origin.end)) {
      segments.push({ itemIndex: origin.itemIndex, startInItem: origin.start, endInItem: origin.end });
    }
  }
  return segments;
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

  const candidates = allOccurrences(page.normalizedText, needle);
  if (!candidates.length) return fail('UNMAPPABLE', 'MATCH_TEXT_NOT_IN_TEXT_LAYER');
  const contextual = candidates.filter((start) => anchorsMatch(
    page.normalizedText,
    start,
    start + needle.length,
    match.contextBefore ?? '',
    match.contextAfter ?? '',
  ).matches);
  const anchor = (start: number) => anchorsMatch(
    page.normalizedText,
    start,
    start + needle.length,
    match.contextBefore ?? '',
    match.contextAfter ?? '',
  );
  const hasContext = Boolean(normalizeSpanText(match.contextBefore ?? '') || normalizeSpanText(match.contextAfter ?? ''));

  let selected: number | undefined;
  if (contextual.length === 1) selected = contextual[0];
  else if (contextual.length > 1 && match.pageOccurrenceOrdinal && match.pageOccurrenceOrdinal > 0) {
    const ordinalCandidate = candidates[match.pageOccurrenceOrdinal - 1];
    if (ordinalCandidate !== undefined && contextual.includes(ordinalCandidate)) selected = ordinalCandidate;
    else return fail('AMBIGUOUS', 'ORDINAL_DOES_NOT_DISAMBIGUATE_CONTEXT');
  } else if (contextual.length > 1) return fail('AMBIGUOUS', 'MULTIPLE_CONTEXT_MATCHES');
  else if (hasContext) return fail('UNMAPPABLE', 'CONTEXT_ANCHOR_MISMATCH');
  else if (candidates.length === 1 && (!match.pageOccurrenceOrdinal || match.pageOccurrenceOrdinal === 1)) selected = candidates[0];
  else if (candidates.length > 1 && match.pageOccurrenceOrdinal && match.pageOccurrenceOrdinal > 0) {
    selected = candidates[match.pageOccurrenceOrdinal - 1];
    if (selected === undefined) return fail('UNMAPPABLE', 'ORDINAL_OUT_OF_RANGE');
  } else return fail('AMBIGUOUS', 'REPEATED_TEXT_WITHOUT_ANCHOR');

  const units = page.normalizedUnits.slice(selected, selected + needle.length);
  if (!units.length || units.some((unit) => !unit.origins.length)) {
    // Virtual whitespace is allowed inside a phrase, but the visible match must contain glyphs.
    if (!units.some((unit) => unit.origins.length)) return fail('UNMAPPABLE', 'NO_VISIBLE_GLYPH_SEGMENTS');
  }
  const segments = segmentsForRange(page, selected, selected + needle.length);
  if (!segments.length) return fail('UNMAPPABLE', 'NO_VISIBLE_GLYPH_SEGMENTS');

  const rawStart = units[0].rawStart;
  const rawEnd = units.at(-1)!.rawEnd;
  const rawCandidate = page.rawText.slice(rawStart, rawEnd);
  const direct = rawStart === match.start && rawEnd === match.end && rawCandidate === rawNeedle;
  const anchorResult = anchor(selected);
  const normalizedOnly = normalizeSpanText(rawCandidate) !== normalizeSpanText(rawNeedle) || rawCandidate !== rawNeedle;
  const status: PdfMatchMappingStatus = direct
    ? 'DIRECT_EXACT'
    : anchorResult.hasContext && anchorResult.matches && !normalizedOnly
      ? 'CONTEXT_EXACT'
      : 'NORMALIZED_EXACT';
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

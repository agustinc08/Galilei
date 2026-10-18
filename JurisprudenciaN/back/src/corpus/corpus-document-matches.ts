import { BadRequestException } from '@nestjs/common';
import {
  type SearchFieldName,
  type SearchLiteralNode,
  type SearchNode,
} from '../busqueda/utils/search-ast';
import {
  parseSearchQuery,
  SearchQueryParseError,
} from '../busqueda/utils/search-parser';
import {
  normalizeSearchText,
  normalizeSpanishText,
} from '../busqueda/utils/search-normalizer';

export type DocumentPageText = {
  pageNumber: number;
  text: string;
  textKind?: 'NATIVE' | 'OCR';
};

type SearchMatchFieldValues = Partial<Record<SearchFieldName, string | null>>;
type MatchCandidate = {
  page: number;
  textKind: 'NATIVE' | 'OCR';
  start: number;
  end: number;
  text: string;
  term: string;
  kind: 'TERM' | 'PHRASE';
  context: string;
  contextBefore: string;
  contextAfter: string;
};

type DocumentMatch = MatchCandidate & {
  offset: number;
  ordinal: number;
  pageOccurrenceOrdinal: number;
  total: number;
};

type DocumentMatchResult = {
  total: number;
  returned: number;
  exactTotalKnown: boolean;
  truncated: boolean;
  matches: DocumentMatch[];
};

type NormalizedWithOffsets = {
  text: string;
  offsets: Array<{ start: number; end: number }>;
};

/** Case/accent folding used by Corpus Search, with every UTF-16 unit mapped to its original range. */
function normalizeWithOffsets(source: string): NormalizedWithOffsets {
  let text = '';
  const offsets: Array<{ start: number; end: number }> = [];
  let index = 0;
  const append = (value: string, start: number, end: number) => {
    for (const point of value) {
      const output = /[\p{L}\p{N}\s/.-]/u.test(point) ? point : ' ';
      if (output === ' ') {
        if (!text || text.endsWith(' ')) {
          if (text.endsWith(' ')) offsets[offsets.length - 1].end = end;
          continue;
        }
      }
      text += output;
      for (let unit = 0; unit < output.length; unit += 1)
        offsets.push({ start, end });
    }
  };
  while (index < source.length) {
    const start = index;
    let cluster = String.fromCodePoint(source.codePointAt(index)!);
    if (/^\s$/u.test(cluster)) {
      index += cluster.length;
      while (index < source.length) {
        const next = String.fromCodePoint(source.codePointAt(index)!);
        if (!/^\s$/u.test(next)) break;
        index += next.length;
      }
      append(' ', start, index);
      continue;
    }
    index += cluster.length;
    while (index < source.length) {
      const next = String.fromCodePoint(source.codePointAt(index)!);
      if (!/^\p{M}$/u.test(next)) break;
      cluster += next;
      index += next.length;
    }
    append(normalizeSpanishText(cluster), start, index);
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    offsets.pop();
  }
  return { text, offsets };
}

function isWordCharacterAt(source: string, index: number) {
  if (index < 0 || index >= source.length) return false;
  const current = source.charCodeAt(index);
  const previous = source.charCodeAt(index - 1);
  const codePointIndex =
    current >= 0xdc00 &&
    current <= 0xdfff &&
    previous >= 0xd800 &&
    previous <= 0xdbff
      ? index - 1
      : index;
  const codePoint = source.codePointAt(codePointIndex);
  return (
    codePoint !== undefined &&
    /[\p{L}\p{N}]/u.test(String.fromCodePoint(codePoint))
  );
}

function literalMatchesField(
  literal: SearchLiteralNode,
  fields: SearchMatchFieldValues,
) {
  if (!literal.field) return false;
  const value = normalizeSearchText(fields[literal.field]);
  const needle = normalizeSearchText(literal.value);
  if (!value || !needle) return false;
  if (literal.type === 'phrase') {
    return containsExactLexicalSequence(value, needle);
  }
  const mode = effectiveTermMode(literal);
  if (mode === 'contains') return value.includes(needle);
  const tokens = value.match(/[\p{L}\p{N}]+/gu) ?? [];
  return mode === 'prefix'
    ? tokens.some((token) => token.startsWith(needle))
    : tokens.some((token) => token.endsWith(needle));
}

function containsExactLexicalSequence(value: string, needle: string) {
  let cursor = 0;
  while (cursor <= value.length - needle.length) {
    const foundAt = value.indexOf(needle, cursor);
    if (foundAt < 0) return false;
    const end = foundAt + needle.length;
    if (
      !isWordCharacterAt(value, foundAt - 1) &&
      !isWordCharacterAt(value, end)
    )
      return true;
    cursor = foundAt + 1;
  }
  return false;
}

function effectiveTermMode(
  literal: Extract<SearchLiteralNode, { type: 'term' }>,
) {
  return literal.matchMode === 'contains' && !literal.sourceText.includes('%')
    ? 'prefix'
    : literal.matchMode;
}

function occurrencesInPage(
  page: DocumentPageText,
  literal: SearchLiteralNode,
): MatchCandidate[] {
  const needle = normalizeSearchText(literal.value);
  if (!needle) return [];
  const normalized = normalizeWithOffsets(page.text);
  const matches: MatchCandidate[] = [];
  let cursor = 0;
  while (cursor <= normalized.text.length - needle.length) {
    const foundAt = normalized.text.indexOf(needle, cursor);
    if (foundAt < 0) break;
    const start = normalized.offsets[foundAt]?.start;
    const end = normalized.offsets[foundAt + needle.length - 1]?.end;
    if (start === undefined || end === undefined) break;
    const startBoundary = !isWordCharacterAt(page.text, start - 1);
    const endBoundary = !isWordCharacterAt(page.text, end);
    const mode = literal.type === 'term' ? effectiveTermMode(literal) : 'exact';
    const boundaryMatches =
      mode === 'exact'
        ? startBoundary && endBoundary
        : mode === 'contains'
          ? true
          : mode === 'prefix'
            ? startBoundary
            : endBoundary;
    if (boundaryMatches) {
      const contextStart = Math.max(0, start - 64);
      const contextEnd = Math.min(page.text.length, end + 96);
      const contextBefore = page.text.slice(contextStart, start);
      const contextAfter = page.text.slice(end, contextEnd);
      matches.push({
        page: page.pageNumber,
        textKind: page.textKind === 'OCR' ? 'OCR' : 'NATIVE',
        start,
        end,
        text: page.text.slice(start, end),
        term: literal.value,
        kind: literal.type === 'phrase' ? 'PHRASE' : 'TERM',
        context: `${contextStart ? '…' : ''}${page.text.slice(contextStart, contextEnd)}${contextEnd < page.text.length ? '…' : ''}`,
        contextBefore,
        contextAfter,
      });
    }
    cursor = foundAt + 1;
  }
  return matches;
}

function evaluateWithSpans(
  node: SearchNode | null,
  pages: DocumentPageText[],
  fields: SearchMatchFieldValues,
): { matched: boolean; matches: MatchCandidate[] } {
  if (!node) return { matched: true, matches: [] };
  if (node.type === 'not') {
    const child = evaluateWithSpans(node.operand, pages, fields);
    return { matched: !child.matched, matches: [] };
  }
  if (node.type === 'and' || node.type === 'or') {
    const children = node.operands.map((operand) =>
      evaluateWithSpans(operand, pages, fields),
    );
    const matched =
      node.type === 'and'
        ? children.every((child) => child.matched)
        : children.some((child) => child.matched);
    return {
      matched,
      matches: !matched
        ? []
        : children.flatMap((child) => (child.matched ? child.matches : [])),
    };
  }
  if (node.field) {
    return { matched: literalMatchesField(node, fields), matches: [] };
  }
  const matches = pages.flatMap((page) => occurrencesInPage(page, node));
  return { matched: matches.length > 0, matches };
}

export function findDocumentMatches(
  pages: DocumentPageText[],
  query: string,
  limit = 500,
  fields: SearchMatchFieldValues = {},
): DocumentMatchResult {
  const cleanQuery = query.trim();
  if (!cleanQuery || cleanQuery.length > 300) {
    throw new BadRequestException(
      'La búsqueda debe tener entre 1 y 300 caracteres.',
    );
  }
  let ast: ReturnType<typeof parseSearchQuery>;
  try {
    ast = parseSearchQuery(cleanQuery);
  } catch (error) {
    if (error instanceof SearchQueryParseError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }

  const evaluation = evaluateWithSpans(ast.root, pages, fields);
  if (!evaluation.matched) {
    return {
      total: 0,
      returned: 0,
      exactTotalKnown: true,
      truncated: false,
      matches: [],
    };
  }

  const unique = new Map<string, MatchCandidate>();
  for (const match of evaluation.matches) {
    const key = `${match.page}:${match.start}:${match.end}`;
    const previous = unique.get(key);
    if (!previous || (match.kind === 'PHRASE' && previous.kind === 'TERM')) {
      unique.set(key, match);
    }
  }
  const ordered = [...unique.values()].sort(
    (left, right) =>
      left.page - right.page ||
      left.start - right.start ||
      left.end - right.end,
  );
  const truncated = ordered.length > limit;
  const visibleMatches = ordered.slice(0, limit);
  const occurrenceOrdinals = new Map<string, number>();
  const matches = visibleMatches.map((match, index) => {
    const normalizedText = normalizeSpanishText(match.text);
    const occurrenceKey = `${match.page}:${normalizedText}`;
    const pageOccurrenceOrdinal =
      (occurrenceOrdinals.get(occurrenceKey) ?? 0) + 1;
    occurrenceOrdinals.set(occurrenceKey, pageOccurrenceOrdinal);
    return {
      page: match.page,
      textKind: match.textKind,
      start: match.start,
      end: match.end,
      /** Legacy alias retained while existing viewer consumers migrate to start/end. */
      offset: match.start,
      text: match.text,
      term: match.term,
      kind: match.kind,
      context: match.context,
      contextBefore: match.contextBefore,
      contextAfter: match.contextAfter,
      ordinal: index + 1,
      pageOccurrenceOrdinal,
      /** Legacy per-row total; top-level exactTotalKnown disambiguates truncation. */
      total: visibleMatches.length,
    };
  });
  return {
    total: visibleMatches.length,
    returned: visibleMatches.length,
    exactTotalKnown: !truncated,
    truncated,
    matches,
  };
}

import type { ReactNode } from 'react';

type HighlightTerm = {
  value: string;
  matchMode: 'contains' | 'prefix' | 'suffix' | 'exact-word' | 'phrase';
};

type HighlightOptions = {
  query?: string | null;
  exactPhrase?: string | null;
  excluded?: string | null;
  className?: string;
};

function normalizeSpanish(value: string) {
  const enye = '\uE000';
  return value
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/n\u0303/gu, enye)
    .replace(/\p{Diacritic}/gu, '')
    .replace(new RegExp(enye, 'gu'), 'ñ')
    .normalize('NFC');
}

function parseHighlightTerms(query: string, excluded = false): HighlightTerm[] {
  const terms: HighlightTerm[] = [];
  const tokens = query.match(/[\p{L}][\p{L}\p{N}_]*:"(?:\\.|[^"\\])*"|"(?:\\.|[^"\\])*"|[()]|[^\s()]+/gu) ?? [];
  const groupNegation: boolean[] = [];
  let negated = false;
  let pendingNot = false;

  for (const token of tokens) {
    if (token === '(') {
      if (pendingNot) negated = !negated;
      groupNegation.push(negated);
      pendingNot = false;
      continue;
    }
    if (token === ')') {
      pendingNot = false;
      negated = groupNegation.pop() ?? false;
      continue;
    }

    const operator = token.toLocaleUpperCase('es');
    if (operator === 'NOT') {
      pendingNot = !pendingNot;
      continue;
    }
    if (operator === 'AND' || operator === 'OR' || token === '*' || token === '+') continue;

    const negativePrefix = token.startsWith('-');
    let literal = negativePrefix ? token.slice(1) : token;
    const fieldPrefix = literal.match(/^[\p{L}][\p{L}\p{N}_]*:/u)?.[0];
    if (fieldPrefix) literal = literal.slice(fieldPrefix.length);
    if (!literal) continue;

    const quoted = literal.startsWith('"') && literal.endsWith('"') && literal.length > 1;
    let value = quoted ? literal.slice(1, -1).replace(/\\"/gu, '"').trim() : literal;
    if (!quoted) value = value.replace(/^[^\p{L}\p{N}%]+|[^\p{L}\p{N}%]+$/gu, '');
    if (!value) {
      pendingNot = false;
      continue;
    }

    const leadingWildcard = !quoted && value.startsWith('%');
    const trailingWildcard = !quoted && value.endsWith('%');
    if (leadingWildcard) value = value.slice(1);
    if (trailingWildcard) value = value.slice(0, -1);
    const isNegative = excluded || ((negated !== negativePrefix) !== pendingNot);
    pendingNot = false;
    if (isNegative || !value.trim()) continue;

    const isQuotedPhrase = quoted && /\s/u.test(value);
    terms.push({
      value: value.trim(),
      matchMode: quoted
        ? isQuotedPhrase ? 'phrase' : 'exact-word'
        : leadingWildcard && trailingWildcard ? 'contains'
          : leadingWildcard ? 'suffix'
            : trailingWildcard ? 'prefix' : 'prefix',
    });
  }

  return terms;
}

function normalizeWithSourceOffsets(value: string) {
  const source = Array.from(value);
  let normalized = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let sourceOffset = 0;

  for (let index = 0; index < source.length; index += 1) {
    const start = sourceOffset;
    let segment = source[index];
    sourceOffset += segment.length;
    if (segment.toLocaleLowerCase('es') === 'n' && source[index + 1] === '\u0303') {
      segment += source[index + 1];
      sourceOffset += source[index + 1].length;
      index += 1;
    }

    const folded = normalizeSpanish(segment);
    if (!folded && /\p{Diacritic}/u.test(segment) && ends.length) {
      const lastCharacterStart = starts[starts.length - 1];
      for (let position = ends.length - 1; position >= 0 && starts[position] === lastCharacterStart; position -= 1) {
        ends[position] = sourceOffset;
      }
      continue;
    }

    for (const character of folded) {
      if (/\s/u.test(character)) {
        if (normalized.endsWith(' ')) {
          ends[ends.length - 1] = sourceOffset;
          continue;
        }
        normalized += ' ';
      } else {
        normalized += character;
      }
      for (let unit = 0; unit < character.length; unit += 1) {
        starts.push(start);
        ends.push(sourceOffset);
      }
    }
  }

  const leadingWhitespace = normalized.match(/^\s*/u)?.[0].length ?? 0;
  const trailingWhitespace = normalized.match(/\s*$/u)?.[0].length ?? 0;
  return {
    normalized: normalized.trim(),
    starts: starts.slice(leadingWhitespace, starts.length - trailingWhitespace),
    ends: ends.slice(leadingWhitespace, ends.length - trailingWhitespace),
  };
}

function findMatches(text: string, terms: HighlightTerm[]) {
  const { normalized, starts, ends } = normalizeWithSourceOffsets(text);
  const ranges: Array<{ start: number; end: number }> = [];

  for (const term of terms) {
    const needle = normalizeSpanish(term.value).replace(/\s+/gu, ' ').trim();
    if (!needle) continue;
    let cursor = 0;
    while (cursor <= normalized.length - needle.length) {
      const found = normalized.indexOf(needle, cursor);
      if (found < 0) break;
      const endIndex = found + needle.length;
      const before = found > 0 ? normalized[found - 1] : '';
      const after = endIndex < normalized.length ? normalized[endIndex] : '';
      const startsWord = !before || !/[\p{L}\p{N}]/u.test(before);
      const endsWord = !after || !/[\p{L}\p{N}]/u.test(after);
      const modeMatches = term.matchMode === 'contains'
        || (term.matchMode === 'prefix' && startsWord)
        || (term.matchMode === 'suffix' && endsWord)
        || ((term.matchMode === 'exact-word' || term.matchMode === 'phrase') && startsWord && endsWord);

      if (modeMatches && starts[found] !== undefined && ends[endIndex - 1] !== undefined) {
        ranges.push({ start: starts[found], end: ends[endIndex - 1] });
      }
      cursor = found + Math.max(needle.length, 1);
    }
  }

  return ranges.sort((left, right) => left.start - right.start || right.end - left.end)
    .reduce<Array<{ start: number; end: number }>>((merged, range) => {
      const previous = merged[merged.length - 1];
      if (previous && range.start < previous.end) previous.end = Math.max(previous.end, range.end);
      else merged.push({ ...range });
      return merged;
    }, []);
}

/** Highlights positive query literals as text nodes; untrusted snippet content is never parsed as HTML. */
export function highlightSearchSnippet(snippet: string, options: HighlightOptions): ReactNode {
  const exactPhrase = options.exactPhrase?.trim();
  const terms = [
    ...parseHighlightTerms(options.query ?? ''),
    ...(exactPhrase ? [{ value: exactPhrase, matchMode: 'phrase' as const }] : []),
    ...parseHighlightTerms(options.excluded ?? '', true),
  ];
  const uniqueTerms = [...new Map(terms.map((term) => [
    `${term.matchMode}:${normalizeSpanish(term.value)}`,
    term,
  ])).values()];
  const ranges = findMatches(snippet, uniqueTerms);
  if (!ranges.length) return snippet;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) nodes.push(snippet.slice(cursor, range.start));
    nodes.push(<mark key={`${range.start}-${range.end}`} className={options.className}>{snippet.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  }
  if (cursor < snippet.length) nodes.push(snippet.slice(cursor));
  return nodes;
}

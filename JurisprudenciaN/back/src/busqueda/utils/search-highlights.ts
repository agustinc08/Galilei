import { normalizeSearchText, normalizeSpanishText } from './search-normalizer';

export type HighlightItem = {
  campo: string;
  texto: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeChar(value: string) {
  return normalizeSpanishText(value);
}

function buildNormalizedIndex(source: string) {
  let normalized = '';
  const map: number[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const current = normalizeChar(source[index]);
    for (let offset = 0; offset < current.length; offset += 1) {
      normalized += current[offset];
      map.push(index);
    }
  }

  return { normalized, map };
}

function findOriginalRange(source: string, term: string) {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) {
    return null;
  }

  const { normalized, map } = buildNormalizedIndex(source);
  const normalizedIndex = normalized.indexOf(normalizedTerm);
  if (normalizedIndex === -1) {
    return null;
  }

  const start = map[normalizedIndex] ?? 0;
  const lastNormalizedIndex = normalizedIndex + normalizedTerm.length - 1;
  const end = (map[lastNormalizedIndex] ?? start) + 1;
  return { start, end };
}

function getSnippet(
  source: string,
  start: number,
  end: number,
  extraTerms: string[] = [],
  context = 60,
) {
  const from = Math.max(0, start - context);
  const to = Math.min(source.length, end + context);
  const prefix = from > 0 ? '... ' : '';
  const suffix = to < source.length ? ' ...' : '';
  const snippet = source.slice(from, to);
  return `${prefix}${highlightSnippet(
    snippet,
    source.slice(start, end),
    extraTerms,
  )}${suffix}`;
}

function highlightSnippet(snippet: string, primaryMatch: string, extraTerms: string[] = []) {
  const terms = [primaryMatch, ...extraTerms]
    .map((term) => term.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  if (!terms.length) {
    return escapeHtml(snippet);
  }

  const pattern = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi');
  return escapeHtml(snippet).replace(pattern, '<mark>$1</mark>');
}

export function buildHighlight(
  campo: string,
  source: string | null | undefined,
  searchTerms: string[],
) {
  if (!source?.trim()) {
    return null;
  }

  const normalizedSource = normalizeSearchText(source);
  let bestMatch:
    | {
        term: string;
        index: number;
      }
    | null = null;

  for (const term of searchTerms) {
    const normalizedTerm = normalizeSearchText(term);
    if (!normalizedTerm) {
      continue;
    }

    const index = normalizedSource.indexOf(normalizedTerm);
    if (index !== -1 && (!bestMatch || index < bestMatch.index)) {
      bestMatch = {
        term,
        index,
      };
    }
  }

  if (!bestMatch) {
    return null;
  }

  const range = findOriginalRange(source, bestMatch.term);
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.min(source.length, bestMatch.term.length);
  const extraTerms = searchTerms.filter(
    (term) =>
      term.trim() &&
      normalizeSearchText(term) !== normalizeSearchText(bestMatch?.term) &&
      normalizeSearchText(source).includes(normalizeSearchText(term)),
  );

  return {
    campo,
    texto: getSnippet(source, start, end, extraTerms),
  } satisfies HighlightItem;
}

import { BadRequestException } from '@nestjs/common';
import {
  evaluateSearchNode,
  visitSearchLiterals,
  type SearchLiteralNode,
} from '../busqueda/utils/search-ast';
import {
  parseSearchQuery,
  SearchQueryParseError,
} from '../busqueda/utils/search-parser';
import { normalizeSearchText } from '../busqueda/utils/search-normalizer';

export type DocumentPageText = { pageNumber: number; text: string };

export function findDocumentMatches(
  pages: DocumentPageText[],
  query: string,
  limit = 500,
) {
  const cleanQuery = query.trim();
  if (!cleanQuery || cleanQuery.length > 300)
    throw new BadRequestException(
      'La búsqueda debe tener entre 1 y 300 caracteres.',
    );
  let ast;
  try {
    ast = parseSearchQuery(cleanQuery);
  } catch (error) {
    if (error instanceof SearchQueryParseError)
      throw new BadRequestException(error.message);
    throw error;
  }
  const allText = normalizeSearchText(
    pages.map((page) => page.text).join('\n'),
  );
  const matchesQuery = (literal: SearchLiteralNode) => {
    const needle = normalizeSearchText(literal.value);
    if (!needle) return false;
    const position = allText.indexOf(needle);
    if (position < 0) return false;
    if (literal.type === 'phrase' || literal.matchMode === 'contains')
      return true;
    if (literal.matchMode === 'prefix')
      return position === 0 || /\s/u.test(allText[position - 1] ?? '');
    return (
      position + needle.length === allText.length ||
      /\s/u.test(allText[position + needle.length] ?? '')
    );
  };
  if (!evaluateSearchNode(ast.root, matchesQuery))
    return {
      total: 0,
      truncated: false,
      matches: [] as Array<{ page: number; context: string }>,
    };
  const literals: SearchLiteralNode[] = [];
  visitSearchLiterals(ast.root, (literal, negated) => {
    if (!negated) literals.push(literal);
  });
  const found: Array<{ page: number; offset: number; context: string; term: string }> = [];
  for (const page of pages) {
    const normalized = normalizeSearchText(page.text);
    for (const literal of literals) {
      const needle = normalizeSearchText(literal.value);
      if (!needle) continue;
      let offset = 0;
      while (found.length <= limit) {
        const index = normalized.indexOf(needle, offset);
        if (index < 0) break;
        const start = Math.max(0, index - 100);
        const end = Math.min(normalized.length, index + needle.length + 150);
        found.push({
          page: page.pageNumber,
          offset: index,
          term: literal.value,
          context: `${start ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`,
        });
        offset = index + Math.max(needle.length, 1);
      }
      if (found.length > limit) break;
    }
    if (found.length > limit) break;
  }
  found.sort((a, b) => a.page - b.page || a.offset - b.offset);
  const truncated = found.length > limit;
  const visibleMatches = found.slice(0, limit);
  return {
    total: visibleMatches.length,
    truncated,
    matches: visibleMatches.map(({ page, offset, context, term }, index) => ({
      page,
      offset,
      term,
      context,
      ordinal: index + 1,
      total: visibleMatches.length,
    })),
  };
}

'use client';

import styles from './documento.module.css';

type Props = {
  text?: string | null;
  query?: string;
  className?: string;
};

function normalizeChar(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es');
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es');
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

function getRanges(source: string, query: string) {
  const normalizedQuery = normalizeText(query.trim());
  if (!normalizedQuery) {
    return [];
  }

  const { normalized, map } = buildNormalizedIndex(source);
  const ranges: Array<{ start: number; end: number }> = [];
  let from = 0;

  while (from < normalized.length) {
    const index = normalized.indexOf(normalizedQuery, from);
    if (index === -1) {
      break;
    }

    const start = map[index] ?? 0;
    const end = (map[index + normalizedQuery.length - 1] ?? start) + 1;
    ranges.push({ start, end });
    from = index + normalizedQuery.length;
  }

  return ranges;
}

export function DocumentoHighlight({ text, query = '', className }: Props) {
  const value = text ?? '';
  const term = query.trim();

  if (!term) {
    return <span className={className}>{value}</span>;
  }

  const ranges = getRanges(value, term);

  if (!ranges.length) {
    return <span className={className}>{value}</span>;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      parts.push(
        <span key={`text-${index}`}>{value.slice(cursor, range.start)}</span>,
      );
    }
    parts.push(
      <mark key={`mark-${index}`} className={styles.mark}>
        {value.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });

  if (cursor < value.length) {
    parts.push(<span key="text-end">{value.slice(cursor)}</span>);
  }

  return <span className={className}>{parts}</span>;
}

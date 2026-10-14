'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';
import styles from './viewer.module.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export type PdfMatch = {
  page: number;
  offset: number;
  term: string;
  ordinal: number;
  start: number;
  end: number;
  text?: string;
  context?: string;
  contextBefore?: string;
  contextAfter?: string;
  kind?: 'TERM' | 'PHRASE';
  pageOccurrenceOrdinal?: number;
};

type Props = {
  file: string;
  page: number;
  matches: PdfMatch[];
  activeMatch: number;
  onLoadSuccess: (pages: number) => void;
};

type TextRange = { start: number; end: number };
type MappedMatch = TextRange & { ordinal: number };

function normalizeSpanText(value: string) {
  return value.toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/n\u0303/gu, '\uE000')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\uE000/gu, 'ñ')
    .normalize('NFC')
    .replace(/\s+/gu, ' ');
}

function normalizeWithOffsets(source: string) {
  let text = '';
  const offsets: Array<{ start: number; end: number }> = [];
  let index = 0;
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
      text += ' ';
      offsets.push({ start, end: index });
      continue;
    }
    index += cluster.length;
    while (index < source.length) {
      const next = String.fromCodePoint(source.codePointAt(index)!);
      if (!/^\p{M}$/u.test(next)) break;
      cluster += next;
      index += next.length;
    }
    const normalized = normalizeSpanText(cluster);
    text += normalized;
    for (let unit = 0; unit < normalized.length; unit += 1) {
      offsets.push({ start, end: index });
    }
  }
  return { text, offsets };
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

function contextMatches(
  normalizedPage: string,
  matchStart: number,
  matchEnd: number,
  contextBefore: string,
  contextAfter: string,
) {
  const before = normalizeSpanText(contextBefore);
  const after = normalizeSpanText(contextAfter);
  const actualBefore = normalizedPage.slice(Math.max(0, matchStart - before.length), matchStart);
  const actualAfter = normalizedPage.slice(matchEnd, matchEnd + after.length);
  return (!before || actualBefore === before) && (!after || actualAfter === after);
}

function mapMatchesToPdfText(
  pageText: string,
  matches: PdfMatch[],
  itemOffsets: Map<number, TextRange>,
) {
  const normalized = normalizeWithOffsets(pageText);
  const mapped: MappedMatch[] = [];
  for (const match of matches) {
    const needle = normalizeSpanText(match.text || match.term);
    const candidates = allOccurrences(normalized.text, needle);
    if (!candidates.length) continue;
    const contextual = candidates.filter((index) =>
      contextMatches(
        normalized.text,
        index,
        index + needle.length,
        match.contextBefore ?? '',
        match.contextAfter ?? '',
      ),
    );
    let selected: number | undefined;
    if (contextual.length === 1) selected = contextual[0];
    else if (contextual.length > 1 && match.pageOccurrenceOrdinal) {
      selected = contextual[match.pageOccurrenceOrdinal - 1];
    } else if (candidates.length === 1) {
      selected = candidates[0];
    }
    if (selected === undefined) continue;
    const start = normalized.offsets[selected]?.start;
    const end = normalized.offsets[selected + needle.length - 1]?.end;
    if (start === undefined || end === undefined) continue;
    if (![...itemOffsets.values()].some((item) => item.start <= start && item.end >= end)) {
      // A match can cross PDF.js text items. Split it at those item boundaries below.
      const intersections = [...itemOffsets.values()].filter((item) => item.end > start && item.start < end);
      if (!intersections.length) continue;
      for (const item of intersections) {
        mapped.push({ start: Math.max(start, item.start), end: Math.min(end, item.end), ordinal: match.ordinal });
      }
    } else {
      mapped.push({ start, end, ordinal: match.ordinal });
    }
  }
  return mapped.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function CorpusPdfViewer({ file, page, matches, activeMatch, onLoadSuccess }: Props) {
  const [width, setWidth] = useState(960);
  const [mappedState, setMappedState] = useState<{
    key: string;
    matches: MappedMatch[];
  }>({ key: '', matches: [] });
  const itemOffsets = useRef(new Map<number, TextRange>());
  const active = matches[activeMatch];
  const mappingKey = `${page}:${active?.ordinal ?? 0}:${matches
    .map((match) => `${match.ordinal}-${match.start}-${match.end}`)
    .join(',')}`;
  const mappedMatches = useMemo(
    () => (mappedState.key === mappingKey ? mappedState.matches : []),
    [mappedState, mappingKey],
  );
  useEffect(() => {
    itemOffsets.current.clear();
  }, [activeMatch, matches, page]);

  const handleTextSuccess = useCallback(({ items }: TextContent) => {
    const offsets = new Map<number, TextRange>();
    let pageText = '';
    items.forEach((item, itemIndex) => {
      if (!('str' in item)) return;
      const textItem = item as TextItem;
      const start = pageText.length;
      pageText += textItem.str;
      offsets.set(itemIndex, { start, end: pageText.length });
      if (textItem.hasEOL) pageText += '\n';
    });
    itemOffsets.current = offsets;
    setMappedState({
      key: mappingKey,
      matches: mapMatchesToPdfText(
        pageText,
        matches.filter((match) => match.page === page),
        offsets,
      ),
    });
  }, [mappingKey, matches, page]);

  const renderText = useCallback(({ str, itemIndex }: { str: string; itemIndex: number }) => {
    const itemRange = itemOffsets.current.get(itemIndex);
    if (!itemRange) return escapeHtml(str);
    const ranges = mappedMatches
      .filter((match) => match.end > itemRange.start && match.start < itemRange.end)
      .map((match) => ({
        start: Math.max(0, match.start - itemRange.start),
        end: Math.min(str.length, match.end - itemRange.start),
        active: match.ordinal === active?.ordinal,
      }))
      .sort((left, right) => left.start - right.start || left.end - right.end);
    if (!ranges.length) return escapeHtml(str);
    let cursor = 0;
    let html = '';
    for (const range of ranges) {
      const start = Math.max(cursor, range.start);
      if (range.end <= start) continue;
      html += escapeHtml(str.slice(cursor, start));
      const className = range.active ? 'bjc-pdf-match-current' : 'bjc-pdf-match';
      html += `<mark class="${className}">${escapeHtml(str.slice(start, range.end))}</mark>`;
      cursor = range.end;
    }
    return html + escapeHtml(str.slice(cursor));
  }, [active?.ordinal, mappedMatches]);

  const setContainer = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const update = () => setWidth(Math.max(320, Math.floor(node.clientWidth - 24)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return <div className={styles.pdfDocument} ref={setContainer}>
    <Document file={file} loading={<p>Cargando PDF…</p>} error={<p>No se pudo renderizar el PDF. Podés usar la descarga y el contexto lateral.</p>} onLoadSuccess={({ numPages }) => onLoadSuccess(numPages)}>
      <Page
        key={`${page}-${activeMatch}`}
        pageNumber={page}
        width={width}
        renderTextLayer
        renderAnnotationLayer
        customTextRenderer={renderText}
        onGetTextSuccess={handleTextSuccess}
      />
    </Document>
  </div>;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

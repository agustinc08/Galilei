'use client';

import { useCallback, useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';
import { alignPdfTextPageMap, buildPdfTextPageMap, mapPdfMatches } from './pdf-match-mapper';
import type { PdfTextItemInput, PdfTextPageMap } from './pdf-match-mapper';
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
  sourceText?: string | null;
  matches: PdfMatch[];
  activeMatch: number;
  onLoadSuccess: (pages: number) => void;
};

export function CorpusPdfViewer({ file, page, sourceText, matches, activeMatch, onLoadSuccess }: Props) {
  const [width, setWidth] = useState(960);
  const [textPageState, setTextPageState] = useState<{
    key: string;
    pageMap: PdfTextPageMap;
  } | null>(null);
  const active = matches[activeMatch];
  const pageKey = `${file}:${page}`;
  const textPage = textPageState?.key === pageKey ? textPageState.pageMap : null;
  const alignedTextPage = useMemo(
    () => textPage && sourceText !== undefined && sourceText !== null
      ? alignPdfTextPageMap(textPage, sourceText)
      : textPage,
    [sourceText, textPage],
  );
  const mappings = useMemo(
    () => alignedTextPage ? mapPdfMatches(alignedTextPage, matches.filter((match) => match.page === page)) : [],
    [alignedTextPage, matches, page],
  );
  const unresolvedActive = mappings.find((mapping) => mapping.ordinal === active?.ordinal &&
    !['DIRECT_EXACT', 'SEGMENTED_EXACT', 'CONTEXT_EXACT', 'CONTEXT_NORMALIZED_EXACT', 'NORMALIZED_EXACT'].includes(mapping.status));

  const handleTextSuccess = useCallback(({ items }: TextContent) => {
    const textItems = items.flatMap((item, itemIndex) => 'str' in item
      ? [{ ...(item as TextItem), itemIndex } as unknown as PdfTextItemInput]
      : []);
    setTextPageState({ key: pageKey, pageMap: buildPdfTextPageMap(textItems) });
  }, [pageKey]);

  const renderText = useCallback(({ str, itemIndex }: { str: string; itemIndex: number }) => {
    const ranges = mappings.flatMap((mapping) => mapping.segments
      .filter((segment) => segment.itemIndex === itemIndex)
      .map((segment) => ({
        start: segment.startInItem,
        end: segment.endInItem,
        active: mapping.ordinal === active?.ordinal,
      })))
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
  }, [active?.ordinal, mappings]);

  const setContainer = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const update = () => setWidth(Math.max(320, Math.floor(node.clientWidth - 24)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return <div className={styles.pdfDocument} ref={setContainer}>
    {unresolvedActive && active && <p className={styles.mappingFallback} role="status" aria-live="polite">
      Coincidencia encontrada en el texto indexado, pero no pudo ubicarse visualmente con precisión en esta página. La navegación sigue disponible.
      {(active.context || active.text) && <span> Contexto: {active.context || active.text}</span>}
    </p>}
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

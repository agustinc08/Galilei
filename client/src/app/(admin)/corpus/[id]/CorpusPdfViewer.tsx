'use client';

import { useCallback, useMemo, useState } from 'react';
import { useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { api } from '@/lib/api';
import { clampPdfPage } from '@/lib/pdf-page';
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
  textKind?: 'NATIVE' | 'OCR';
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
  structurePath?: string | null;
  onGoToPage?: (page: number) => void;
};

export function CorpusPdfViewer({ file, page, sourceText, matches, activeMatch, onLoadSuccess, structurePath, onGoToPage }: Props) {
  const [width, setWidth] = useState(960);
  const [textPageState, setTextPageState] = useState<{
    key: string;
    pageMap: PdfTextPageMap;
  } | null>(null);
  const [pageCountState, setPageCountState] = useState<{
    file: string;
    count: number;
  } | null>(null);
  const [renderState, setRenderState] = useState<{
    key: string;
    status: 'ready' | 'error';
  } | null>(null);
  const pageCount = pageCountState?.file === file ? pageCountState.count : null;
  const renderedPage = pageCount ? clampPdfPage(page, pageCount) : 1;
  const renderKey = `${file}:${renderedPage}`;
  const pageReady = renderState?.key === renderKey && renderState.status === 'ready';
  const pageError = renderState?.key === renderKey && renderState.status === 'error';
  const [structureState, setStructureState] = useState<{
    path: string;
    sections: Array<{ label: string; pageStart: number }>;
    status: string;
  } | null>(null);
  const structureMatchesPath = Boolean(
    structurePath && structureState?.path === structurePath,
  );
  const sections = structureMatchesPath ? structureState?.sections ?? [] : [];
  const structureStatus = structureMatchesPath ? structureState?.status ?? '' : '';
  const structureLoading = Boolean(structurePath && !structureMatchesPath);
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
    () => alignedTextPage ? mapPdfMatches(alignedTextPage, matches.filter((match) => match.page === page && match.textKind !== 'OCR')) : [],
    [alignedTextPage, matches, page],
  );
  const unresolvedActive = mappings.find((mapping) => mapping.ordinal === active?.ordinal &&
    !['DIRECT_EXACT', 'SEGMENTED_EXACT', 'CONTEXT_EXACT', 'CONTEXT_NORMALIZED_EXACT', 'NORMALIZED_EXACT'].includes(mapping.status));

  useEffect(() => {
    if (!pageCount) return;
    const normalizedPage = clampPdfPage(page, pageCount);
    if (normalizedPage !== page) onGoToPage?.(normalizedPage);
  }, [onGoToPage, page, pageCount]);

  useEffect(() => {
    if (!structurePath) return;
    let active = true;
    void api.get<{ data: { status: string; sections: Array<{ label: string; pageStart: number }> } }>(structurePath)
      .then((response) => {
        if (active) {
          setStructureState({
            path: structurePath,
            sections: response.data.sections ?? [],
            status: response.data.status ?? 'NO_STRUCTURE',
          });
        }
      })
      .catch(() => {
        if (active) {
          setStructureState({
            path: structurePath,
            sections: [],
            status: 'NO_STRUCTURE',
          });
        }
      });
    return () => { active = false; };
  }, [structurePath]);

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
    {structurePath ? <details className={styles.structurePanel}>
      <summary>Contenido del documento</summary>
      {structureLoading ? <p role="status">Detectando secciones…</p> : sections.length ? <nav aria-label="Secciones del documento">
        {structureStatus === 'PARTIAL' ? <p role="status">Estructura parcial; el texto fuente no está completo.</p> : null}
        {sections.map((section, index) => <button type="button" key={`${section.pageStart}:${section.label}:${index}`} onClick={() => onGoToPage?.(section.pageStart)}>
          {section.label} · pág. {section.pageStart}
        </button>)}
      </nav> : <p>No se detectaron secciones navegables con suficiente confianza.</p>}
    </details> : null}
    {unresolvedActive && active && <p className={styles.mappingFallback} role="status" aria-live="polite">
      Encontramos la coincidencia en el texto del documento, pero no pudimos señalarla en la página. Podés continuar desde la lista de coincidencias.
      {(active.context || active.text) && <span> Contexto: {active.context || active.text}</span>}
    </p>}
    <Document file={file} loading={<p role="status" aria-label="Cargando PDF">Cargando PDF…</p>} error={<p role="alert">No se pudo mostrar el PDF. Podés descargarlo y consultar la información del documento.</p>} onLoadSuccess={({ numPages }) => {
      setRenderState(null);
      setPageCountState({ file, count: numPages });
      onLoadSuccess(numPages);
    }}>
      {pageReady ? <p className={styles.viewerStatus} role="status" aria-live="polite" aria-label={`Documento PDF cargado, página ${renderedPage}`} data-testid="pdf-viewer-ready">
        Documento cargado · página {renderedPage}
      </p> : null}
      {pageError ? <p className={styles.viewerError} role="alert">
        No se pudo dibujar esta página del PDF. Podés intentar otra página o descargar el documento.
      </p> : null}
      <Page
        key={`${renderedPage}-${activeMatch}`}
        pageNumber={renderedPage}
        width={width}
        renderTextLayer
        renderAnnotationLayer
        customTextRenderer={renderText}
        onGetTextSuccess={handleTextSuccess}
        onRenderSuccess={() => setRenderState({ key: renderKey, status: 'ready' })}
        onRenderError={() => setRenderState({ key: renderKey, status: 'error' })}
      />
    </Document>
  </div>;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

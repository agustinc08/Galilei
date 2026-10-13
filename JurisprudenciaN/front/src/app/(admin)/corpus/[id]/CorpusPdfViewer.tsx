'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import styles from './viewer.module.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export type PdfMatch = { page: number; offset: number; term: string; ordinal: number };

type Props = {
  file: string;
  page: number;
  matches: PdfMatch[];
  activeMatch: number;
  onLoadSuccess: (pages: number) => void;
};

export function CorpusPdfViewer({ file, page, matches, activeMatch, onLoadSuccess }: Props) {
  const [width, setWidth] = useState(960);
  const pageTextOffset = useRef(0);
  const active = matches[activeMatch];
  const terms = useMemo(
    () => [...new Set(matches.filter((match) => match.page === page).map((match) => match.term))],
    [matches, page],
  );
  useEffect(() => { pageTextOffset.current = 0; }, [activeMatch, page, terms]);

  const renderText = useCallback(({ str }: { str: string }) => {
    const baseOffset = pageTextOffset.current;
    pageTextOffset.current += str.length;
    const escapedTerms = terms.filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRegExp);
    if (!escapedTerms.length) return escapeHtml(str);
    const matcher = new RegExp(`(${escapedTerms.join('|')})`, 'giu');
    let cursor = 0;
    let html = '';
    for (const match of str.matchAll(matcher)) {
      const value = match[0];
      const start = match.index ?? 0;
      html += escapeHtml(str.slice(cursor, start));
      const isCurrent = active?.page === page
        && baseOffset + start <= active.offset + 3
        && baseOffset + start + value.length >= active.offset;
      html += `<mark class="${isCurrent ? 'bjc-pdf-match-current' : 'bjc-pdf-match'}">${escapeHtml(value)}</mark>`;
      cursor = start + value.length;
    }
    return html + escapeHtml(str.slice(cursor));
  }, [active, page, terms]);

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
      <Page key={`${page}-${activeMatch}-${terms.join('|')}`} pageNumber={page} width={width} renderTextLayer renderAnnotationLayer customTextRenderer={renderText} onRenderTextLayerSuccess={() => { pageTextOffset.current = 0; }} />
    </Document>
  </div>;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

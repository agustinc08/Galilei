'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { downloadBlob } from '@/lib/utils';
import { extractPdfTextPages, findPdfTextMatches } from '@/lib/pdf-text-search';
import styles from './documento.module.css';

export type PdfViewerControls = {
  hasPdf: boolean;
  openInNewTab: () => void;
  download: () => void;
  print: () => void;
};

type Props = {
  downloadPath?: string | null;
  filename: string;
  skipAuth?: boolean;
  title?: string;
  page?: number | null;
  searchQuery?: string;
  onControlsChange?: (controls: PdfViewerControls) => void;
};

const EMPTY_CONTROLS: PdfViewerControls = {
  hasPdf: false,
  openInNewTab: () => undefined,
  download: () => undefined,
  print: () => undefined,
};

export function PdfViewer({
  downloadPath,
  filename,
  skipAuth = false,
  title = 'Documento PDF',
  page,
  searchQuery,
  onControlsChange,
}: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobData, setBlobData] = useState<Blob | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(downloadPath));
  const [error, setError] = useState<string | null>(null);
  const externalPage = typeof page === 'number' && page >= 1 ? page : null;
  const [pageOverride, setPageOverride] = useState<{
    externalPage: number | null;
    value: number;
  } | null>(null);
  const currentPage = pageOverride?.externalPage === externalPage
    ? pageOverride.value
    : externalPage ?? 1;
  const setCurrentPage = useCallback((value: number) => {
    setPageOverride({ externalPage, value });
  }, [externalPage]);
  const [zoom, setZoom] = useState('auto');
  const [searchOpen, setSearchOpen] = useState(false);
  const [draftQueryState, setDraftQueryState] = useState({
    source: searchQuery ?? '',
    value: searchQuery ?? '',
  });
  const draftSearchQuery = draftQueryState.source === (searchQuery ?? '')
    ? draftQueryState.value
    : searchQuery ?? '';
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [pageTexts, setPageTexts] = useState<string[] | null>(null);
  const [searchProgress, setSearchProgress] = useState<{ page: number; total: number } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  const buildPdfSrc = useCallback((url: string) => {
    const params = new URLSearchParams();
    if (currentPage > 1) params.set('page', String(currentPage));
    if (zoom !== 'auto') params.set('zoom', zoom);
    if (searchQuery?.trim()) params.set('search', searchQuery.trim());
    const fragment = params.toString().replace(/&/g, '&');
    return fragment ? `${url}#${fragment}` : url;
  }, [currentPage, searchQuery, zoom]);

  useEffect(() => {
    onControlsChange?.(EMPTY_CONTROLS);
  }, [onControlsChange]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    const load = async () => {
      if (!downloadPath) {
        setIsLoading(false);
        setBlobData(null);
        setBlobUrl(null);
        setError(null);
        setPageTexts(null);
        onControlsChange?.(EMPTY_CONTROLS);
        return;
      }

      setIsLoading(true);
      setError(null);
      setBlobData(null);
      setBlobUrl(null);
      setPageTexts(null);
      setSearchError(null);
      setActiveSearchQuery('');
      setActiveMatchIndex(0);
      setSearchOpen(false);

      try {
        const blob = await api.download(downloadPath, { skipAuth });
        objectUrl = URL.createObjectURL(blob);

        if (!active) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        setBlobData(blob);
        setBlobUrl(objectUrl);

      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'No se pudo cargar el PDF.',
          );
          setBlobData(null);
          setBlobUrl(null);
          onControlsChange?.(EMPTY_CONTROLS);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [downloadPath, filename, onControlsChange, skipAuth]);

  useEffect(() => {
    if (!blobData || !blobUrl) {
      onControlsChange?.(EMPTY_CONTROLS);
      return;
    }

    const controls: PdfViewerControls = {
      hasPdf: true,
      openInNewTab: () => window.open(buildPdfSrc(blobUrl), '_blank', 'noopener'),
      download: () => downloadBlob(blobData, filename),
      print: () => window.open(buildPdfSrc(blobUrl), '_blank', 'noopener'),
    };
    onControlsChange?.(controls);
  }, [blobData, blobUrl, buildPdfSrc, filename, onControlsChange]);

  useEffect(() => {
    if (!searchOpen || !blobData || pageTexts !== null) return;

    const controller = new AbortController();
    void extractPdfTextPages(
      blobData,
      controller.signal,
      (extractedPage, pageCount) => setSearchProgress({ page: extractedPage, total: pageCount }),
    )
      .then((texts) => {
        if (!controller.signal.aborted) {
          setPageTexts(texts);
          setSearchProgress(null);
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSearchProgress(null);
        setSearchError('No se pudo buscar dentro de este PDF.');
      });

    return () => controller.abort();
  }, [blobData, pageTexts, searchOpen]);

  const matches = useMemo(
    () => pageTexts ? findPdfTextMatches(pageTexts, activeSearchQuery) : [],
    [activeSearchQuery, pageTexts],
  );

  const goToMatch = useCallback((index: number) => {
    if (!matches.length) return;
    const wrappedIndex = (index + matches.length) % matches.length;
    setActiveMatchIndex(wrappedIndex);
    setCurrentPage(matches[wrappedIndex].page);
  }, [matches, setCurrentPage]);

  const submitSearch = useCallback((event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const nextQuery = draftSearchQuery.trim();
    if (!nextQuery || pageTexts === null) return;

    if (nextQuery !== activeSearchQuery) {
      const nextMatches = findPdfTextMatches(pageTexts, nextQuery);
      setActiveSearchQuery(nextQuery);
      setActiveMatchIndex(0);
      if (nextMatches.length) setCurrentPage(nextMatches[0].page);
      return;
    }
    goToMatch(activeMatchIndex + 1);
  }, [activeMatchIndex, activeSearchQuery, draftSearchQuery, goToMatch, pageTexts, setCurrentPage]);

  const previousMatch = useCallback(() => {
    goToMatch(activeMatchIndex - 1);
  }, [activeMatchIndex, goToMatch]);

  const clearSearch = useCallback(() => {
    setDraftQueryState({ source: searchQuery ?? '', value: '' });
    setActiveSearchQuery('');
    setActiveMatchIndex(0);
  }, [searchQuery]);

  const toolbarLabel = useMemo(() => {
    if (!downloadPath) {
      return 'Sin PDF asociado';
    }
    if (blobData) {
      return filename;
    }
    return 'Cargando PDF';
  }, [blobData, downloadPath, filename]);

  if (!downloadPath) {
    return (
      <>
        <div className={styles.viewerToolbar}>
          <span className={styles.viewerToolbarInfo}>Sin PDF asociado</span>
        </div>
        <div className={`${styles.viewerFrameWrap} ${styles.viewerEmptyState}`}>
          <EmptyState
            title="Sin PDF disponible"
            description="El fallo se puede consultar desde los sumarios, la reseña y las referencias. El visor se habilita cuando se publica un PDF."
          />
        </div>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <div className={styles.viewerToolbar}>
          <span className={styles.viewerToolbarInfo}>Cargando PDF</span>
        </div>
        <div className={`${styles.viewerFrameWrap} ${styles.viewerEmptyState}`}>
          <LoadingSpinner label="Cargando documento..." />
        </div>
      </>
    );
  }

  if (error || !blobUrl) {
    return (
      <>
        <div className={styles.viewerToolbar}>
          <span className={styles.viewerToolbarInfo}>Error al cargar el PDF</span>
        </div>
        <div className={`${styles.viewerFrameWrap} ${styles.viewerEmptyState}`}>
          <EmptyState
            title="No se pudo mostrar el PDF"
            description={error ?? 'El documento no está disponible en este momento.'}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.viewerToolbar}>
        <span className={styles.viewerToolbarInfo}>{toolbarLabel}</span>
        <div className={styles.actions}>
          <label className={styles.compactControl}>
            Página
            <input
              type="number"
              min={1}
              value={currentPage}
              onChange={(event) => {
                const requested = Math.max(1, Number(event.target.value) || 1);
                setCurrentPage(pageTexts?.length ? Math.min(requested, pageTexts.length) : requested);
              }}
            />
          </label>
          <label className={styles.compactControl}>
            Zoom
            <select value={zoom} onChange={(event) => setZoom(event.target.value)}>
              <option value="auto">Ajustar</option>
              <option value="100">100%</option>
              <option value="125">125%</option>
              <option value="150">150%</option>
            </select>
          </label>
          <Button
            variant="secondary"
            onClick={() =>
              window.open(buildPdfSrc(blobUrl), '_blank', 'noopener')
            }
          >
            Abrir en nueva pestaña
          </Button>
          <Button variant="secondary" onClick={() => blobData && downloadBlob(blobData, filename)}>
            Descargar
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const opening = !searchOpen;
              setSearchOpen(opening);
              setSearchProgress(opening ? { page: 0, total: 0 } : null);
              if (opening) setSearchError(null);
            }}
          >
            {searchOpen ? 'Cerrar búsqueda' : 'Buscar dentro del fallo'}
          </Button>
        </div>
      </div>
      {searchOpen && (
        <section className={styles.inDocumentSearch} aria-label="Buscar dentro del fallo">
          <form
            className={styles.inDocumentSearchForm}
            onSubmit={(event) => submitSearch(event)}
          >
            <label htmlFor="pdf-document-search">Buscar en este fallo</label>
            <input
              id="pdf-document-search"
              type="search"
              value={draftSearchQuery}
              onChange={(event) => setDraftQueryState({ source: searchQuery ?? '', value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.shiftKey) {
                  event.preventDefault();
                  if (draftSearchQuery.trim() === activeSearchQuery) previousMatch();
                  else submitSearch();
                }
              }}
              placeholder="Escribí una palabra o frase"
              aria-describedby="pdf-document-search-status"
            />
            <Button type="submit" disabled={pageTexts === null || !draftSearchQuery.trim()}>
              Buscar
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!matches.length}
              onClick={previousMatch}
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!matches.length}
              onClick={() => goToMatch(activeMatchIndex + 1)}
            >
              Siguiente
            </Button>
            <Button type="button" variant="secondary" onClick={clearSearch}>
              Limpiar
            </Button>
          </form>
          <p id="pdf-document-search-status" className={styles.inDocumentSearchStatus} role="status" aria-live="polite">
            {searchProgress
              ? searchProgress.total
                ? `Leyendo página ${searchProgress.page} de ${searchProgress.total}…`
                : 'Preparando búsqueda local…'
              : searchError
                ? searchError
                : pageTexts === null
                  ? 'Preparando búsqueda local…'
                  : pageTexts.every((text) => !text.trim())
                    ? 'No hay texto disponible para buscar dentro de este PDF.'
                    : !activeSearchQuery
                      ? 'La búsqueda se procesa en este dispositivo.'
                      : matches.length
                        ? `${activeMatchIndex + 1} de ${matches.length} · Página ${matches[activeMatchIndex]?.page ?? currentPage}`
                        : 'Sin coincidencias en este documento.'}
          </p>
        </section>
      )}
      <div className={styles.viewerFrameWrap}>
        <iframe
          className={styles.viewerFrame}
          src={buildPdfSrc(blobUrl)}
          title={title}
        />
      </div>
    </>
  );
}

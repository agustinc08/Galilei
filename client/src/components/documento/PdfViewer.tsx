'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { downloadBlob } from '@/lib/utils';
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
  const [currentPage, setCurrentPage] = useState(page ?? 1);
  const [zoom, setZoom] = useState('auto');

  const buildPdfSrc = useCallback((url: string) => {
    const effectivePage = page ?? currentPage;
    const params = new URLSearchParams();
    if (effectivePage > 1) params.set('page', String(effectivePage));
    if (zoom !== 'auto') params.set('zoom', zoom);
    if (searchQuery?.trim()) params.set('search', searchQuery.trim());
    const fragment = params.toString().replace(/&/g, '&');
    return fragment ? `${url}#${fragment}` : url;
  }, [currentPage, page, searchQuery, zoom]);

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
        onControlsChange?.(EMPTY_CONTROLS);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const blob = await api.download(downloadPath, { skipAuth });
        objectUrl = URL.createObjectURL(blob);

        if (!active) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        setBlobData(blob);
        setBlobUrl(objectUrl);

        const controls: PdfViewerControls = {
          hasPdf: true,
          openInNewTab: () =>
            window.open(
              buildPdfSrc(objectUrl!),
              '_blank',
              'noopener',
            ),
          download: () => downloadBlob(blob, filename),
          print: () =>
            window.open(
              buildPdfSrc(objectUrl!),
              '_blank',
              'noopener',
            ),
        };

        onControlsChange?.(controls);
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
  }, [buildPdfSrc, downloadPath, filename, onControlsChange, skipAuth]);

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
              value={page ?? currentPage}
              onChange={(event) => setCurrentPage(Math.max(1, Number(event.target.value) || 1))}
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
        </div>
      </div>
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

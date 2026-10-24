'use client';

import { useParams, useSearchParams } from '@/lib/router-compat';
import { useEffect, useMemo, useState } from 'react';
import { DocumentoSidePanel } from '@/components/documento/DocumentoSidePanel';
import { DocumentoViewerLayout } from '@/components/documento/DocumentoViewerLayout';
import { PdfViewer, type PdfViewerControls } from '@/components/documento/PdfViewer';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { ApiResponse } from '@/types/common';
import type { ArchivoPdf } from '@/types/archivo';
import type { FichaSentencia } from '@/types/sentencia';

const EMPTY_CONTROLS: PdfViewerControls = {
  hasPdf: false,
  openInNewTab: () => undefined,
  download: () => undefined,
  print: () => undefined,
};

function buildTitle(data: FichaSentencia) {
  const sentencia = data.sentencia;
  return (
    [sentencia.actor, sentencia.demandado].filter(Boolean).join(' c/ ') ||
    sentencia.numeroSentencia ||
    `Sentencia #${sentencia.id}`
  );
}

export default function ConsultaSentenciaDocumentoPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = params.slug;
  const [data, setData] = useState<FichaSentencia | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfControls, setPdfControls] = useState<PdfViewerControls>(EMPTY_CONTROLS);
  const [pdfPage, setPdfPage] = useState<number | null>(null);
  const highlightQuery = searchParams.get('q') ?? '';

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await api.get<ApiResponse<FichaSentencia>>(
          `/public/sentencias/${slug}/documento`,
          { skipAuth: true },
        );
        if (active) {
          setData(response.data);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'No se pudo cargar el documento público.',
          );
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
    };
  }, [slug]);

  const archivoPrincipal = useMemo<ArchivoPdf | null>(
    () => data?.archivosPdf?.[0] ?? null,
    [data],
  );

  if (isLoading) {
    return <LoadingSpinner label="Cargando documento público..." />;
  }

  if (!data) {
    return (
      <EmptyState
        title="Documento no disponible"
        description={error ?? 'No se pudo cargar la vista documental pública.'}
      />
    );
  }

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
  const title = buildTitle(data);
  const subtitle = [
    data.sentencia.numeroSentencia ? `Sentencia ${data.sentencia.numeroSentencia}` : null,
    data.sentencia.sala ? `Sala ${data.sentencia.sala}` : null,
    formatDate(data.sentencia.fecha),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <DocumentoViewerLayout
      title={title}
      subtitle={subtitle}
      backHref={`/consulta/sentencia/${slug}`}
      backLabel="Volver al detalle"
      sidePanel={
        <DocumentoSidePanel
          data={data}
          publicView
          fichaHref={`/consulta/sentencia/${slug}/ficha`}
          currentUrl={currentUrl}
          publicUrl={currentUrl}
          pdfControls={pdfControls}
          highlightQuery={highlightQuery}
          onGoToPage={setPdfPage}
        />
      }
      viewer={
        <PdfViewer
          downloadPath={archivoPrincipal ? `/public/sentencias/${slug}/pdf` : null}
          filename={
            archivoPrincipal?.nombreOriginal ??
            archivoPrincipal?.nombreArchivo ??
            `sentencia-${slug}.pdf`
          }
          title={title}
          skipAuth
          page={pdfPage}
          onControlsChange={setPdfControls}
        />
      }
    />
  );
}

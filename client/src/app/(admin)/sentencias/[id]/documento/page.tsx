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
import { parsePdfPageParam } from '@/lib/pdf-page';
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

export default function SentenciaDocumentoPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const requestedPage = parsePdfPageParam(searchParams.get('page'));
  const [data, setData] = useState<FichaSentencia | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfControls, setPdfControls] = useState<PdfViewerControls>(EMPTY_CONTROLS);
  const [pdfPage, setPdfPage] = useState<number | null>(requestedPage);
  const highlightQuery = searchParams.get('q') ?? '';

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await api.get<ApiResponse<FichaSentencia>>(
          `/sentencias/${id}/documento`,
        );
        if (active) {
          setData(response.data);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'No se pudo cargar el documento.',
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
  }, [id]);

  const archivoPrincipal = useMemo<ArchivoPdf | null>(
    () => data?.archivosPdf?.[0] ?? null,
    [data],
  );

  if (isLoading) {
    return <LoadingSpinner label="Cargando documento..." />;
  }

  if (!data) {
    return (
      <EmptyState
        title="Documento no disponible"
        description={error ?? 'No se pudo cargar la vista documental.'}
      />
    );
  }

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
  const publicUrl =
    typeof window !== 'undefined' && data.sentencia.slugPublico
      ? `${window.location.origin}/consulta/sentencia/${data.sentencia.slugPublico}/documento`
      : null;
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
      backHref={`/sentencias/${id}`}
      viewportOffset={117}
      sidePanel={
        <DocumentoSidePanel
          data={data}
          fichaHref={`/sentencias/${id}/imprimir`}
          currentUrl={currentUrl}
          publicUrl={publicUrl}
          pdfControls={pdfControls}
          highlightQuery={highlightQuery}
          onGoToPage={setPdfPage}
        />
      }
      viewer={
        <PdfViewer
          downloadPath={
            archivoPrincipal ? `/archivos/${archivoPrincipal.id}/download` : null
          }
          filename={
            archivoPrincipal?.nombreOriginal ??
            archivoPrincipal?.nombreArchivo ??
            `sentencia-${id}.pdf`
          }
          title={title}
          page={pdfPage}
          structurePath={`/sentencias/${id}/estructura`}
          citationPath={`/sentencias/${id}/cita`}
          onControlsChange={setPdfControls}
        />
      }
    />
  );
}

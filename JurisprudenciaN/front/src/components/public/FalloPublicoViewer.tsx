'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DocumentoAccordion } from '@/components/documento/DocumentoAccordion';
import { DocumentoSidePanel } from '@/components/documento/DocumentoSidePanel';
import { DocumentoViewerLayout } from '@/components/documento/DocumentoViewerLayout';
import { PdfViewer, type PdfViewerControls } from '@/components/documento/PdfViewer';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { ArchivoPdf } from '@/types/archivo';
import type { ApiResponse } from '@/types/common';
import type { FalloRelacionadoPublico, FichaSentencia } from '@/types/sentencia';
import styles from './fallo-publico.module.css';

const EMPTY_CONTROLS: PdfViewerControls = {
  hasPdf: false,
  openInNewTab: () => undefined,
  download: () => undefined,
  print: () => undefined,
};

type Props = {
  identifier: string;
};

function buildTitle(data: FichaSentencia) {
  const sentencia = data.sentencia;
  return (
    sentencia.caratula ||
    [sentencia.actor, sentencia.demandado].filter(Boolean).join(' c/ ') ||
    sentencia.numeroSentencia ||
    `Fallo ${sentencia.id}`
  );
}

function buildPublicTimeline(data: FichaSentencia) {
  return [
    data.sentencia.fecha
      ? { label: 'Fecha del fallo', value: formatDate(data.sentencia.fecha) }
      : null,
    data.sumarios.length
      ? { label: 'Sumarios publicados', value: `${data.sumarios.length}` }
      : null,
    data.resena ? { label: 'Reseña disponible', value: 'Publicada' } : null,
    data.archivosPdf.length ? { label: 'Documento PDF', value: 'Disponible' } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));
}

export function FalloPublicoViewer({ identifier }: Props) {
  const searchParams = useSearchParams();
  const highlightQuery = searchParams.get('q') ?? '';
  const requestedReturn = searchParams.get('returnTo') ?? '';
  const backHref = requestedReturn.startsWith('/consulta') ? requestedReturn : `/consulta${highlightQuery ? `?q=${encodeURIComponent(highlightQuery)}` : ''}`;
  const [data, setData] = useState<FichaSentencia | null>(null);
  const [relacionados, setRelacionados] = useState<FalloRelacionadoPublico[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfControls, setPdfControls] = useState<PdfViewerControls>(EMPTY_CONTROLS);
  const [pdfPage, setPdfPage] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const [documentoResponse, relacionadosResponse] = await Promise.all([
          api.get<ApiResponse<FichaSentencia>>(
            `/public/sentencias/${identifier}/documento`,
            { skipAuth: true },
          ),
          api
            .get<ApiResponse<FalloRelacionadoPublico[]>>(
              `/public/sentencias/${identifier}/relacionados`,
              { skipAuth: true },
            )
            .catch(() => ({ data: [] })),
        ]);

        if (!active) return;
        setData(documentoResponse.data);
        setRelacionados(relacionadosResponse.data);
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'No se pudo cargar el fallo público.',
        );
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
  }, [identifier]);

  const archivoPrincipal = useMemo<ArchivoPdf | null>(
    () => data?.archivosPdf?.[0] ?? null,
    [data],
  );

  if (isLoading) {
    return <LoadingSpinner label="Cargando fallo publicado..." />;
  }

  if (!data) {
    return (
      <main className={styles.emptyPage}>
        <EmptyState
          title="Fallo no disponible"
          description={error ?? 'No se encontró una sentencia pública con ese identificador.'}
        />
      </main>
    );
  }

  const title = buildTitle(data);
  const subtitle = [
    data.sentencia.sala ? `Sala ${data.sentencia.sala}` : null,
    formatDate(data.sentencia.fecha),
    data.sentencia.expediente ? `Expte. ${data.sentencia.expediente}` : null,
    data.sentencia.tribunalOrigen,
    data.sentencia.tipoFallo,
  ]
    .filter(Boolean)
    .join(' · ');
  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
  const publicIdentifier = data.sentencia.slugPublico ?? String(data.sentencia.id);
  const timeline = buildPublicTimeline(data);

  return (
    <DocumentoViewerLayout
      title={title}
      subtitle={subtitle}
      backHref={backHref}
      backLabel="Volver a consulta"
      sidePanel={
        <>
          <div className={styles.institutionalBlock}>
            <span>Consulta pública</span>
            <strong>Jurisprudencia Civil</strong>
            <p>Contenido publicado para consulta pública.</p>
          </div>

          <DocumentoSidePanel
            data={data}
            publicView
            fichaHref={`/consulta/sentencia/${publicIdentifier}/ficha`}
            currentUrl={currentUrl}
            publicUrl={currentUrl}
            pdfControls={pdfControls}
            highlightQuery={highlightQuery}
            onGoToPage={setPdfPage}
          />

          <DocumentoAccordion title="Historial del fallo">
            {timeline.length ? (
              <div className={styles.timeline}>
                {timeline.map((item) => (
                  <div key={item.label} className={styles.timelineItem}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyBox}>Sin hitos públicos disponibles.</div>
            )}
          </DocumentoAccordion>

          <DocumentoAccordion title="Fallos relacionados" defaultOpen>
            {relacionados.length ? (
              <div className={styles.relatedList}>
                {relacionados.map((item) => (
                  <Link
                    key={item.id}
                    href={`/fallos/${item.slugPublico ?? item.id}`}
                    className={styles.relatedItem}
                  >
                    <strong>{item.caratula ?? item.numeroSentencia ?? `Fallo ${item.id}`}</strong>
                    <span>
                      {[item.sala ? `Sala ${item.sala}` : null, formatDate(item.fecha)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <p>{item.temaPrincipal ?? item.sumarioBreve ?? 'Sin sumario breve.'}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <div className={styles.emptyBox}>Sin fallos relacionados publicados.</div>
            )}
          </DocumentoAccordion>
        </>
      }
      viewer={
        <>
          <div className={styles.publicHeader}>
            <div>
              <span>Fallo publicado</span>
              <strong>{data.cita.citaBreve}</strong>
            </div>
            <div className={styles.publicHeaderActions}>
              <Button variant="secondary" onClick={() => window.print()}>
                Imprimir
              </Button>
              <Button variant="secondary" onClick={pdfControls.download} disabled={!pdfControls.hasPdf}>
                Descargar PDF
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigator.clipboard?.writeText(currentUrl)}
              >
                Compartir enlace
              </Button>
            </div>
          </div>
          <PdfViewer
            downloadPath={archivoPrincipal ? `/public/sentencias/${publicIdentifier}/pdf` : null}
            filename={
              archivoPrincipal?.nombreOriginal ??
              archivoPrincipal?.nombreArchivo ??
              `fallo-${publicIdentifier}.pdf`
            }
            title={title}
            skipAuth
            page={pdfPage}
            searchQuery={highlightQuery}
            onControlsChange={setPdfControls}
          />
        </>
      }
    />
  );
}

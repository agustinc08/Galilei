'use client';

import { Link } from '@/lib/router-compat';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from '@/lib/router-compat';
import { DocumentoAccordion } from '@/components/documento/DocumentoAccordion';
import { DocumentoSidePanel } from '@/components/documento/DocumentoSidePanel';
import { DocumentoViewerLayout } from '@/components/documento/DocumentoViewerLayout';
import { PdfViewer, type PdfViewerControls } from '@/components/documento/PdfViewer';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { formatTipoFallo } from '@/lib/jurisprudencia-labels';
import type { ArchivoPdf } from '@/types/archivo';
import type { ApiResponse } from '@/types/common';
import type { FalloRelacionadoPublico, FichaSentencia } from '@/types/sentencia';
import { AddToCollectionButton } from '@/components/research/AddToCollectionButton';
import { CopyReferenceButton } from '@/components/sentencias/CopyReferenceButton';
import { useAuth } from '@/hooks/use-auth';
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

type VerifiedCitationRelationship = {
  type: 'CITES' | 'CITED_BY';
  status: 'VERIFIED';
  rawCitation: string;
  page: number | null;
  judgment: {
    id: number;
    slugPublico: string | null;
    caratula: string | null;
    numeroSentencia: string | null;
    expediente: string | null;
    sala: string | null;
    fecha: string | null;
  };
};

type SameExpedienteDecision = {
  id: number;
  slugPublico: string | null;
  caratula: string | null;
  numeroSentencia: string | null;
  sala: string | null;
  fecha: string | null;
  expediente: string | null;
  tipoFallo: string | null;
};

type SameExpedienteResponse = {
  data: SameExpedienteDecision[];
  total: number;
  limit: number;
  hasMore: boolean;
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
  const { user } = useAuth();
  const userId = user?.id;
  const canManageFavorites = ['ADMIN', 'OPERADOR'].includes(user?.rol.nombre ?? '');
  const canUseCollections = [
    'ADMIN',
    'OPERADOR',
    'LECTOR',
    'REVISOR',
    'JURISPRUDENCIA',
    'DIGESTO',
  ].includes(user?.rol.nombre ?? '');
  const searchParams = useSearchParams();
  const highlightQuery = searchParams.get('q') ?? '';
  const requestedPageValue = Number(searchParams.get('page'));
  const requestedPage = Number.isInteger(requestedPageValue) && requestedPageValue > 0
    ? requestedPageValue
    : null;
  const requestedReturn = searchParams.get('returnTo') ?? '';
  const backHref = requestedReturn.startsWith('/consulta') ? requestedReturn : `/consulta${highlightQuery ? `?q=${encodeURIComponent(highlightQuery)}` : ''}`;
  const [data, setData] = useState<FichaSentencia | null>(null);
  const [relacionados, setRelacionados] = useState<FalloRelacionadoPublico[]>([]);
  const [verifiedRelationships, setVerifiedRelationships] = useState<VerifiedCitationRelationship[]>([]);
  const [sameExpediente, setSameExpediente] = useState<SameExpedienteResponse | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(() => new Set());
  const [relationshipMessage, setRelationshipMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfControls, setPdfControls] = useState<PdfViewerControls>(EMPTY_CONTROLS);
  const [pdfPage, setPdfPage] = useState<number | null>(requestedPage);

  useEffect(() => {
    if (!data) return;

    const title = `${buildTitle(data)} | Jurisprudencia Civil`;
    const description = (data.resena ?? data.sumarios?.[0]?.texto ?? 'Fallo publicado para consulta pública.')
      .replace(/\s+/gu, ' ')
      .slice(0, 180);
    document.title = title;
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', description);
    document.querySelector<HTMLMetaElement>('meta[property="og:type"]')?.setAttribute('content', 'article');
    document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.setAttribute('content', title);
    document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.setAttribute('content', description);

    return () => {
      document.title = 'Galilei';
      document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', 'Jurisprudencia, documentos de tu dependencia y tus documentos personales.');
      document.querySelector<HTMLMetaElement>('meta[property="og:type"]')?.setAttribute('content', 'website');
      document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.setAttribute('content', 'Galilei');
      document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.setAttribute('content', 'Jurisprudencia, documentos de tu dependencia y tus documentos personales.');
    };
  }, [data]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const [documentoResponse, relacionadosResponse, relationshipsResponse, sameExpedienteResponse] = await Promise.all([
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
          api
            .get<ApiResponse<VerifiedCitationRelationship[]>>(
              `/public/sentencias/${identifier}/relaciones-verificadas`,
              { skipAuth: true },
            )
            .catch(() => ({ data: [] })),
          api
            .get<SameExpedienteResponse>(
              `/public/sentencias/${identifier}/mismo-expediente`,
              { query: { limit: 10 }, skipAuth: true },
            )
            .catch(() => ({ data: [], total: 0, limit: 10, hasMore: false })),
        ]);

        if (!active) return;
        setData(documentoResponse.data);
        setRelacionados(relacionadosResponse.data);
        setVerifiedRelationships(relationshipsResponse.data);
        setSameExpediente(sameExpedienteResponse);
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

  useEffect(() => {
    let active = true;
    if (!userId || !canManageFavorites) {
      return () => { active = false; };
    }
    void api.get<{ data: Array<{ sentenciaId: number }> }>('/favoritos')
      .then((response) => {
        if (active) setFavoriteIds(new Set(response.data.map((item) => item.sentenciaId)));
      })
      .catch(() => {
        if (active) setRelationshipMessage('No pudimos cargar tus favoritos.');
      });
    return () => { active = false; };
  }, [canManageFavorites, userId]);

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
  const salaLabel = data.sentencia.sala
    ? (data.sentencia.sala.toLowerCase().startsWith('sala') ? data.sentencia.sala : `Sala ${data.sentencia.sala}`)
    : 'Sin Sala informada';
  const subtitle = [
    salaLabel,
    data.sentencia.fecha ? formatDate(data.sentencia.fecha) : null,
    data.sentencia.expediente ? `Expte. ${data.sentencia.expediente}` : null,
    data.sentencia.tribunalOrigen,
    formatTipoFallo(data.sentencia.tipoFallo),
  ]
    .filter(Boolean)
    .join(' · ');
  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
  const publicIdentifier = data.sentencia.slugPublico ?? String(data.sentencia.id);
  const timeline = buildPublicTimeline(data);

  const toggleRelatedFavorite = async (sentenceId: number) => {
    if (!user || !canManageFavorites) return;
    const wasFavorite = favoriteIds.has(sentenceId);
    try {
      if (wasFavorite) await api.delete(`/favoritos/${sentenceId}`);
      else await api.post(`/favoritos/${sentenceId}`);
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (wasFavorite) next.delete(sentenceId);
        else next.add(sentenceId);
        return next;
      });
      setRelationshipMessage(wasFavorite ? 'Fallo quitado de favoritos.' : 'Fallo guardado en favoritos.');
    } catch {
      setRelationshipMessage('No se pudo actualizar el favorito.');
    }
  };

  return (
    <DocumentoViewerLayout
      title={title}
      subtitle={subtitle}
      backHref={backHref}
      backLabel="Volver a resultados"
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

          {relationshipMessage ? <p role="status">{relationshipMessage}</p> : null}
          <DocumentoAccordion title="Citas verificadas" defaultOpen>
            {verifiedRelationships.length ? (
              <div className={styles.relatedList}>
                {verifiedRelationships.map((relationship, index) => (
                  <article key={`${relationship.type}-${relationship.judgment.id}-${index}`} className={styles.relatedItem}>
                    <Link href={`/fallos/${relationship.judgment.slugPublico ?? relationship.judgment.id}`}>
                      <strong>{relationship.type === 'CITES' ? 'Este fallo cita a' : 'Citado por'}: {relationship.judgment.caratula ?? relationship.judgment.numeroSentencia ?? `Fallo ${relationship.judgment.id}`}</strong>
                      <span>{[relationship.judgment.sala, relationship.judgment.fecha ? formatDate(relationship.judgment.fecha) : null, relationship.judgment.expediente ? `Expte. ${relationship.judgment.expediente}` : null].filter(Boolean).join(' · ')}</span>
                    </Link>
                    <p>Relación verificada por revisión editorial · {relationship.rawCitation}</p>
                    <div className={styles.publicHeaderActions}>
                      {canManageFavorites ? <Button variant="secondary" onClick={() => void toggleRelatedFavorite(relationship.judgment.id)}>{favoriteIds.has(relationship.judgment.id) ? 'Quitar favorito' : 'Guardar favorito'}</Button> : null}
                      {canUseCollections ? <AddToCollectionButton sentenciaId={relationship.judgment.id} /> : null}
                      <CopyReferenceButton referencia={relationship.rawCitation} />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyBox}>No hay citas verificadas entre fallos publicados para mostrar.</div>
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

          <DocumentoAccordion title="Otras decisiones del mismo expediente">
            {sameExpediente?.data.length ? (
              <>
                <p>Coincidencia determinística por número y año de expediente; no representa una cita editorial.</p>
                <div className={styles.relatedList}>
                  {sameExpediente.data.map((item) => (
                    <Link
                      key={item.id}
                      href={`/fallos/${item.slugPublico ?? item.id}`}
                      className={styles.relatedItem}
                    >
                      <strong>{item.caratula ?? item.numeroSentencia ?? `Fallo ${item.id}`}</strong>
                      <span>
                        {[
                          item.sala ? `Sala ${item.sala}` : null,
                          item.fecha ? formatDate(item.fecha) : null,
                          item.numeroSentencia ? `Sentencia ${item.numeroSentencia}` : null,
                          formatTipoFallo(item.tipoFallo),
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </Link>
                  ))}
                </div>
                {sameExpediente.hasMore ? <p>Se muestran {sameExpediente.data.length} de {sameExpediente.total} decisiones.</p> : null}
              </>
            ) : (
              <div className={styles.emptyBox}>No encontramos otras decisiones públicas con el mismo número y año de expediente.</div>
            )}
          </DocumentoAccordion>
        </>
      }
      viewer={
        <>
          <div className={styles.publicHeader}>
            <div>
              <span>Fallo publicado</span>
              <strong>{[title, salaLabel, data.sentencia.fecha ? formatDate(data.sentencia.fecha) : null].filter(Boolean).join(' · ')}</strong>
            </div>
            <div className={styles.publicHeaderActions}>
              {canUseCollections ? <AddToCollectionButton sentenciaId={data.sentencia.id} /> : null}
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
            structurePath={`/public/sentencias/${publicIdentifier}/estructura`}
            citationPath={`/public/sentencias/${publicIdentifier}/cita`}
            onControlsChange={setPdfControls}
          />
        </>
      }
    />
  );
}

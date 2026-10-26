'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from "@/lib/router-compat";
import { useParams, useSearchParams } from '@/lib/router-compat';
import { CorpusPdfViewer } from './CorpusPdfViewer';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { downloadBlob } from '@/lib/utils';
import { clampPdfPage, parsePdfPageParam } from '@/lib/pdf-page';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import styles from './viewer.module.css';

type DocumentInfo = {
  id: string;
  title: string;
  subtitle?: string | null;
  status: string;
  caseNumber?: string | null;
  court?: string | null;
  chamber?: string | null;
  instance?: string | null;
  decisionDate?: string | null;
  source?: { code: string; sourceReference?: string | null; checksum?: string | null } | null;
  file?: { filename: string; pageCount?: number | null; mimeType: string } | null;
  extraction?: { status: string; extractor: string; extractorVersion: string; extractedAt: string; pageCount: number } | null;
  selectedPage?: { pageNumber: number; text: string; textKind?: 'NATIVE' | 'OCR' } | null;
};
type DocumentMatches = {
  total: number;
  returned: number;
  exactTotalKnown: boolean;
  truncated: boolean;
  matches: Array<{
    page: number;
    textKind: 'NATIVE' | 'OCR';
    start: number;
    end: number;
    offset: number;
    text: string;
    term: string;
    kind: 'TERM' | 'PHRASE';
    context: string;
    contextBefore: string;
    contextAfter: string;
    ordinal: number;
    pageOccurrenceOrdinal: number;
    total: number;
  }>;
};
type CurationData = {
  editorialStatus: string;
  metadata: Record<string, unknown> | null;
  visibility: string;
  anonymizationStatus: string;
  associations: Array<{ id: string; confidence: string; reviewStatus: string; targetId: string; evidence: unknown }>;
  classifications: Array<{ id: string; category: string; value: string; origin: string; confidence: number | null; reviewStatus: string }>;
  digestoCollections: Array<{ collection: { id: string; name: string } }>;
  digestoTopics: Array<{ topic: { id: string; name: string } }>;
  digestoTags: Array<{ tag: { id: string; name: string } }>;
  linkedSentencias: Array<{ id: number; caratula: string | null; expediente: string | null; fecha: string | null; sala: string | null; sumarios: Array<{ id: number; numeroSumario: string | null; tema: string | null; texto: string }> }>;
  history: Array<{ accion: string; descripcion: string | null; datosAntes: unknown; datosDespues: unknown; createdAt: string; usuario: { nombre: string; apellido: string | null } }>;
};
type CollectionOption = { id: string; name: string; _count: { memberships: number } };
type TopicOption = { id: string; name: string };
type TagOption = { id: string; name: string };
type DocumentLoadState = {
  documentId: string;
  status: 'ready' | 'unavailable';
  document?: DocumentInfo;
  pdfUrl?: string;
};
type CurationLoadState = {
  documentId: string;
  status: 'ready' | 'unavailable';
  data?: CurationData;
};

export default function CorpusDocumentPage() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const initialPage = parsePdfPageParam(searchParams.get('page'));
  const initialQuery = searchParams.get('q') || '';
  const [documentLoad, setDocumentLoad] = useState<DocumentLoadState | null>(null);
  const [page, setPage] = useState(initialPage);
  const [query, setQuery] = useState(initialQuery);
  const [matches, setMatches] = useState<DocumentMatches | null>(null);
  const [activeMatch, setActiveMatch] = useState(0);
  const [errorState, setErrorState] = useState<{ documentId: string; message: string } | null>(null);
  const [curationLoad, setCurationLoad] = useState<CurationLoadState | null>(null);
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [topics, setTopics] = useState<TopicOption[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [collectionId, setCollectionId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [tagId, setTagId] = useState('');
  const [selectionReason, setSelectionReason] = useState('');
  const [selectionNote, setSelectionNote] = useState('');
  const [curationBusy, setCurationBusy] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [sourcePageState, setSourcePageState] = useState<{ key: string; text: string } | null>(null);
  const searchRequest = useRef(0);
  const sourcePageKey = `${params.id}:${page}`;
  const sourcePageText = sourcePageState?.key === sourcePageKey ? sourcePageState.text : null;
  const currentDocumentLoad = documentLoad?.documentId === params.id ? documentLoad : null;

  const handlePdfLoadSuccess = useCallback((count: number) => {
    setPageCount(count);
    setPage((current) => clampPdfPage(current, count));
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('page', String(page));
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [page]);
  const error = errorState && errorState.documentId === params.id ? errorState.message : '';
  const setError = useCallback((message: string) => setErrorState(message ? { documentId: params.id ?? '', message } : null), [params.id]);
  const document = currentDocumentLoad?.status === 'ready' ? currentDocumentLoad.document ?? null : null;
  const pdfUrl = currentDocumentLoad?.status === 'ready' ? currentDocumentLoad.pdfUrl ?? null : null;
  const documentLoading = currentDocumentLoad === null;
  const documentUnavailable = currentDocumentLoad?.status === 'unavailable';
  const currentCurationLoad = curationLoad?.documentId === params.id ? curationLoad : null;
  const curation = currentCurationLoad?.status === 'ready' ? currentCurationLoad.data ?? null : null;
  const curationLoading = currentCurationLoad === null;
  const role = user?.rol.nombre ?? '';
  const canReview = ['ADMIN', 'OPERADOR', 'REVISOR', 'JURISPRUDENCIA'].includes(role);
  const canSelectJurisprudence = ['ADMIN', 'OPERADOR', 'JURISPRUDENCIA'].includes(role) && document?.source?.code === 'JURISPRUDENCIA_LOCAL_PDF';
  const canEditDigesto = ['ADMIN', 'OPERADOR', 'DIGESTO'].includes(role);

  const refreshCuration = async () => {
    const data = await api.get<CurationData>(`/corpus/curation/documents/${params.id}`);
    setCurationLoad({ documentId: params.id ?? '', status: 'ready', data });
  };

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void Promise.all([
      api.get<DocumentInfo>(`/corpus/documents/${params.id}`),
      api.download(`/corpus/documents/${params.id}/file`),
    ]).then(([info, blob]) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setDocumentLoad({ documentId: params.id ?? '', status: 'ready', document: info, pdfUrl: objectUrl });
    }).catch((loadError: unknown) => {
      if (active) {
        setDocumentLoad({ documentId: params.id ?? '', status: 'unavailable' });
        setError(loadError instanceof ApiError && loadError.status === 0
          ? 'No pudimos conectarnos para abrir el documento. Intentá nuevamente más tarde.'
          : 'No encontramos este documento o no tenés acceso.');
      }
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [params.id, setError]);

  useEffect(() => {
    let active = true;
    void api.get<DocumentInfo>(`/corpus/documents/${params.id}`, {
      query: { pageNumber: page },
    }).then((info) => {
      if (active && info.selectedPage?.pageNumber === page) {
        setSourcePageState({ key: sourcePageKey, text: info.selectedPage.text });
      }
    }).catch(() => {
      // The PDF viewer keeps its context-only fail-closed fallback when page text is unavailable.
    });
    return () => { active = false; };
  }, [page, params.id, sourcePageKey]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.get<CurationData>(`/corpus/curation/documents/${params.id}`),
      api.get<CollectionOption[]>('/corpus/curation/digesto/collections'),
      api.get<TopicOption[]>('/corpus/curation/digesto/topics'),
      api.get<TagOption[]>('/corpus/curation/digesto/tags'),
    ]).then(([data, availableCollections, availableTopics, availableTags]) => {
      if (!active) return;
      setCurationLoad({ documentId: params.id ?? '', status: 'ready', data });
      setCollections(availableCollections);
      setTopics(availableTopics);
      setTags(availableTags);
    }).catch(() => {
      if (active) setCurationLoad({ documentId: params.id ?? '', status: 'unavailable' });
    });
    return () => { active = false; };
  }, [params.id]);

  const runCuration = async (action: () => Promise<unknown>) => {
    setCurationBusy(true);
    try { await action(); await refreshCuration(); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la revisión.'); }
    finally { setCurationBusy(false); }
  };

  const searchInside = async (nextQuery = query) => {
    const clean = nextQuery.trim();
    const requestId = ++searchRequest.current;
    setMatches(null);
    setActiveMatch(0);
    if (!clean) return;
    try {
      const result = await api.get<DocumentMatches>(`/corpus/documents/${params.id}/matches`, { query: { q: clean } });
      if (requestId !== searchRequest.current) return;
      setMatches(result);
      setActiveMatch(0);
      if (result.matches[0]) setPage(result.matches[0].page);
      setError('');
    } catch (searchError) {
      if (requestId === searchRequest.current) {
        setError(searchError instanceof Error ? searchError.message : 'No se pudo buscar en el documento.');
      }
    }
  };

  useEffect(() => {
    // The URL's initial query starts an async request; its result updates component state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialQuery.trim()) void searchInside(initialQuery);
  // URL query is the initial request; later searches are user-driven.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, params.id]);

  const navigateMatch = (direction: -1 | 1) => {
    if (!matches?.matches.length) return;
    const nextIndex = (activeMatch + direction + matches.matches.length) % matches.matches.length;
    setActiveMatch(nextIndex);
    setPage(matches.matches[nextIndex].page);
  };

  useEffect(() => {
    if (!matches?.matches.length) return;
    const timer = window.setTimeout(() => {
      window.document.querySelector('.bjc-pdf-match-current')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [activeMatch, page, matches]);

  const download = async () => {
    const blob = await api.download(`/corpus/documents/${params.id}/file`, { query: { download: true } });
    downloadBlob(blob, document?.file?.filename ?? 'documento.pdf');
  };

  return (
    <div className={styles.page}>
      <PageHeader title={document?.title ?? 'Documento'} description={document?.extraction?.extractor === 'Tesseract OCR' ? 'Texto obtenido por OCR local. El PDF original se conserva sin cambios.' : 'Documento con procedencia y acceso controlado.'} />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.toolbar}>
        <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))}>Página anterior</button>
        <label>Página <input type="number" min={1} step={1} max={pageCount || document?.file?.pageCount || undefined} value={page} onChange={(event) => setPage(parsePdfPageParam(event.target.value))} /></label>
        <span>{pageCount ? `de ${pageCount}` : ''}</span>
        <button type="button" onClick={() => setPage((value) => Math.min(pageCount || value + 1, value + 1))}>Página siguiente</button>
        <form onSubmit={(event) => { event.preventDefault(); void searchInside(); }}>
          <input aria-label="Buscar en este documento" placeholder="Buscar en este documento" value={query} onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            if (next.trim() !== query.trim()) {
              searchRequest.current += 1;
              setMatches(null);
              setActiveMatch(0);
            }
          }} />
          <button type="submit">Buscar</button>
        </form>
        <button type="button" onClick={() => void download()}>Descargar PDF</button>
      </div>
      <div className={styles.layout}>
        <section className={styles.pdfPanel} aria-label="Visor PDF">
          {matches?.matches[activeMatch]?.textKind === 'OCR' && (
            <p role="status">Texto OCR reconocido para esta página. La navegación y el contexto están disponibles; no se dibujan resaltados visuales de OCR.</p>
          )}
          {pdfUrl ? <CorpusPdfViewer file={pdfUrl} page={page} sourceText={sourcePageText} matches={matches?.matches ?? []} activeMatch={activeMatch} onLoadSuccess={handlePdfLoadSuccess} structurePath={`/corpus/documents/${params.id}/structure`} onGoToPage={setPage} /> : documentLoading ? <Card><p role="status">Cargando PDF…</p></Card> : <Card><p role="status">{documentUnavailable ? 'Documento no disponible.' : 'No se pudo abrir el PDF.'}</p></Card>}
        </section>
        <aside className={styles.sidePanel}>
          <Card>
            <h2>Coincidencias</h2>
            {matches ? <>
              <p>{matches.truncated ? `Mostrando las primeras ${matches.returned} coincidencias; total exacto desconocido` : `${matches.total} coincidencias`}</p>
              <div className={styles.matchNav}>
                <button type="button" disabled={!matches.total} onClick={() => navigateMatch(-1)}>← Anterior</button>
                <span>{matches.total ? `${activeMatch + 1} de ${matches.total}` : '0 de 0'}</span>
                <button type="button" disabled={!matches.total} onClick={() => navigateMatch(1)}>Siguiente →</button>
              </div>
              <ol className={styles.matches}>{matches.matches.map((match) => <li key={`${match.ordinal}-${match.page}`}>
                <button type="button" onClick={() => { setActiveMatch(match.ordinal - 1); setPage(match.page); }}>Coincidencia {match.ordinal} — página {match.page}</button>
                <p>{match.context}</p>
              </li>)}</ol>
            </> : <p>Ingresá una consulta para buscar dentro del texto extraído.</p>}
          </Card>
          <Card>
            <h2>Datos y procedencia</h2>
            <dl className={styles.metadata}>
              <dt>Expediente</dt><dd>{document?.caseNumber ?? 'Sin dato'}</dd>
              <dt>Tribunal</dt><dd>{document?.court ?? 'Sin dato'}</dd>
              <dt>Sala</dt><dd>{document?.chamber ?? 'Sin dato'}</dd>
              <dt>Instancia</dt><dd>{document?.instance ?? 'Sin dato'}</dd>
              <dt>Fecha</dt><dd>{document?.decisionDate ? new Date(document.decisionDate).toLocaleDateString('es-AR') : 'Sin dato'}</dd>
              <dt>Estado</dt><dd>{document?.status ?? '—'}</dd>
              <dt>Fuente</dt><dd>{document?.source?.code ?? '—'}</dd>
              <dt>SHA-256</dt><dd className={styles.hash}>{document?.source?.checksum ?? '—'}</dd>
            </dl>
          </Card>
          {curation ? <Card>
            <h2>Jurisprudencia</h2>
            <p>Estado editorial: <strong>{curation.editorialStatus}</strong></p>
            <p>Acceso: <strong>{curation.visibility}</strong> · Anonimización: <strong>{curation.anonymizationStatus}</strong></p>
            {canSelectJurisprudence && ['NO_REVIEWED', 'NOT_SELECTED'].includes(curation.editorialStatus) ? <button type="button" disabled={curationBusy} onClick={() => void runCuration(() => api.patch(`/corpus/curation/documents/${params.id}/jurisprudence`, { status: 'REVIEW_PENDING' }))}>Enviar a revisión</button> : null}
            {curation.editorialStatus === 'SELECTED' && curation.metadata?.jurisprudenceCuration && typeof curation.metadata.jurisprudenceCuration === 'object' ? <p>Motivo: {String((curation.metadata.jurisprudenceCuration as { reason?: string }).reason ?? '—')}</p> : null}
            {canSelectJurisprudence && curation.editorialStatus === 'REVIEW_PENDING' ? <div className={styles.curationControls}>
              <label>Motivo de selección<select value={selectionReason} onChange={(event) => setSelectionReason(event.target.value)}><option value="">Elegir motivo</option><option value="CASO_NOVEDOSO">Caso novedoso</option><option value="CRITERIO_AISLADO">Criterio aislado</option><option value="CAMBIO_CRITERIO">Cambio de criterio</option><option value="CONTRADICCION">Contradicción</option><option value="RELEVANCIA_HISTORICA">Relevancia histórica</option><option value="TEMA_RELEVANTE">Tema relevante</option><option value="OTRO">Otro</option></select></label>
              <label>Observación<input maxLength={500} value={selectionNote} onChange={(event) => setSelectionNote(event.target.value)} placeholder={selectionReason === 'OTRO' ? 'Describí el motivo' : 'Nota opcional'} /></label>
              <button type="button" disabled={curationBusy || !selectionReason || (selectionReason === 'OTRO' && !selectionNote.trim())} onClick={() => void runCuration(() => api.patch(`/corpus/curation/documents/${params.id}/jurisprudence`, { status: 'SELECTED', reason: selectionReason, note: selectionNote }))}>Seleccionar como Jurisprudencia</button>
              <button type="button" disabled={curationBusy} onClick={() => void runCuration(() => api.patch(`/corpus/curation/documents/${params.id}/jurisprudence`, { status: 'NOT_SELECTED', note: selectionNote }))}>No seleccionar</button>
            </div> : null}
            <h3>Asociaciones a sentencias</h3>
            {curation.associations.map((association) => <div key={association.id} className={styles.curationItem}>
              <strong>{association.confidence} · {association.reviewStatus}</strong><span>{association.targetId ? `Sentencia #${association.targetId}` : 'Sin sentencia identificada'}</span><small>{JSON.stringify(association.evidence)}</small>
              {canReview && document?.source?.code === 'JURISPRUDENCIA_LOCAL_PDF' && association.reviewStatus === 'REVIEW_PENDING' ? <div className={styles.curationControls}><button type="button" disabled={curationBusy || !/^\d+$/.test(association.targetId)} onClick={() => void runCuration(() => api.patch(`/corpus/curation/associations/${association.id}`, { status: 'APPROVED' }))}>Aprobar vínculo</button><button type="button" disabled={curationBusy} onClick={() => void runCuration(() => api.patch(`/corpus/curation/associations/${association.id}`, { status: 'REJECTED' }))}>Rechazar</button></div> : null}
            </div>)}
            {curation.linkedSentencias.map((sentence) => <div key={sentence.id} className={styles.curationItem}>
              <strong><Link href={`/sentencias/${sentence.id}`}>{sentence.caratula ?? `Sentencia #${sentence.id}`}</Link></strong>
              <span>{[sentence.expediente, sentence.sala, sentence.fecha ? new Date(sentence.fecha).toLocaleDateString('es-AR') : null].filter(Boolean).join(' · ')}</span>
              {sentence.sumarios.map((sumario) => <p key={sumario.id}><strong>{sumario.tema ?? sumario.numeroSumario ?? 'Sumario jurídico'}</strong><br />{sumario.texto}</p>)}
            </div>)}
            <h3>Temas sugeridos</h3>
            {curation.classifications.map((item) => <div key={item.id} className={styles.curationItem}><strong>{item.value}</strong><span>{item.category} · {item.origin} · {item.confidence == null ? 'sin confianza' : `${Math.round(item.confidence * 100)}%`} · {item.reviewStatus}</span>
              {canReview && item.reviewStatus === 'SUGGESTED' ? <div className={styles.curationControls}><button type="button" disabled={curationBusy} onClick={() => void runCuration(() => api.patch(`/corpus/curation/classifications/${item.id}`, { status: 'APPROVED' }))}>Aprobar</button><button type="button" disabled={curationBusy} onClick={() => void runCuration(() => api.patch(`/corpus/curation/classifications/${item.id}`, { status: 'REJECTED' }))}>Rechazar</button></div> : null}
            </div>)}
            <h3>Digesto</h3>
            <ul>{curation.digestoCollections.map(({ collection }) => <li key={collection.id}>{collection.name} {canEditDigesto ? <button type="button" disabled={curationBusy} onClick={() => void runCuration(() => api.delete(`/corpus/curation/documents/${params.id}/digesto/collections/${collection.id}`))}>Quitar</button> : null}</li>)}</ul>
            {canEditDigesto ? <div className={styles.curationControls}><select aria-label="Colección Digesto" value={collectionId} onChange={(event) => setCollectionId(event.target.value)}><option value="">Agregar a colección…</option>{collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" disabled={curationBusy || !collectionId} onClick={() => void runCuration(() => api.post(`/corpus/curation/documents/${params.id}/digesto/collections/${collectionId}`))}>Agregar</button></div> : null}
            <p>Temas: {curation.digestoTopics.length ? curation.digestoTopics.map(({ topic }) => <span key={topic.id} className={styles.curationTag}>{topic.name} {canEditDigesto ? <button type="button" aria-label={`Quitar tema ${topic.name}`} disabled={curationBusy} onClick={() => void runCuration(() => api.delete(`/corpus/curation/documents/${params.id}/digesto/topics/${topic.id}`))}>×</button> : null}</span>) : '—'}</p>
            {canEditDigesto ? <div className={styles.curationControls}><select aria-label="Tema Digesto" value={topicId} onChange={(event) => setTopicId(event.target.value)}><option value="">Asignar tema…</option>{topics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" disabled={curationBusy || !topicId} onClick={() => void runCuration(() => api.post(`/corpus/curation/documents/${params.id}/digesto/topics/${topicId}`))}>Asignar</button></div> : null}
            <p>Etiquetas: {curation.digestoTags.length ? curation.digestoTags.map(({ tag }) => <span key={tag.id} className={styles.curationTag}>{tag.name} {canEditDigesto ? <button type="button" aria-label={`Quitar etiqueta ${tag.name}`} disabled={curationBusy} onClick={() => void runCuration(() => api.delete(`/corpus/curation/documents/${params.id}/digesto/tags/${tag.id}`))}>×</button> : null}</span>) : '—'}</p>
            {canEditDigesto ? <div className={styles.curationControls}><select aria-label="Etiqueta Digesto" value={tagId} onChange={(event) => setTagId(event.target.value)}><option value="">Asignar etiqueta…</option>{tags.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" disabled={curationBusy || !tagId} onClick={() => void runCuration(() => api.post(`/corpus/curation/documents/${params.id}/digesto/tags/${tagId}`))}>Asignar</button></div> : null}
            <h3>Historial</h3>
            {curation.history.length ? <ol className={styles.history}>{curation.history.map((event, index) => <li key={`${event.accion}-${event.createdAt}-${index}`}><strong>{event.accion}</strong><span>{new Date(event.createdAt).toLocaleString('es-AR')} · {event.usuario.nombre} {event.usuario.apellido ?? ''}</span></li>)}</ol> : <p>Sin decisiones de curaduría registradas.</p>}
          </Card> : <Card><p role="status">{curationLoading ? 'Cargando panel de curaduría…' : documentUnavailable ? 'La revisión no está disponible para este documento.' : 'No se pudo cargar el panel de curaduría.'}</p></Card>}
        </aside>
      </div>
    </div>
  );
}

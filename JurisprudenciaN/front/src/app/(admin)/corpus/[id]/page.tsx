'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { CorpusPdfViewer } from './CorpusPdfViewer';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { downloadBlob } from '@/lib/utils';
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
};
type DocumentMatches = { total: number; truncated: boolean; matches: Array<{ page: number; offset: number; term: string; context: string; ordinal: number; total: number }> };
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

export default function CorpusDocumentPage() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const initialPage = Math.max(1, Number(searchParams.get('page') || 1));
  const initialQuery = searchParams.get('q') || '';
  const [document, setDocument] = useState<DocumentInfo | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [page, setPage] = useState(initialPage);
  const [query, setQuery] = useState(initialQuery);
  const [matches, setMatches] = useState<DocumentMatches | null>(null);
  const [activeMatch, setActiveMatch] = useState(0);
  const [error, setError] = useState('');
  const [curation, setCuration] = useState<CurationData | null>(null);
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
  const role = user?.rol.nombre ?? '';
  const canReview = ['ADMIN', 'OPERADOR', 'REVISOR', 'JURISPRUDENCIA'].includes(role);
  const canSelectJurisprudence = ['ADMIN', 'OPERADOR', 'JURISPRUDENCIA'].includes(role) && document?.source?.code === 'JURISPRUDENCIA_LOCAL_PDF';
  const canEditDigesto = ['ADMIN', 'OPERADOR', 'DIGESTO'].includes(role);

  const refreshCuration = async () => {
    const data = await api.get<CurationData>(`/corpus/curation/documents/${params.id}`);
    setCuration(data);
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
      setDocument(info);
      setPdfUrl(objectUrl);
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'No se pudo abrir el documento.');
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [params.id]);

  useEffect(() => {
    void Promise.all([
      api.get<CurationData>(`/corpus/curation/documents/${params.id}`).then(setCuration),
      api.get<CollectionOption[]>('/corpus/curation/digesto/collections').then(setCollections),
      api.get<TopicOption[]>('/corpus/curation/digesto/topics').then(setTopics),
      api.get<TagOption[]>('/corpus/curation/digesto/tags').then(setTags),
    ]).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'No se pudo cargar la curaduría.'));
  }, [params.id]);

  const runCuration = async (action: () => Promise<unknown>) => {
    setCurationBusy(true);
    try { await action(); await refreshCuration(); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la revisión.'); }
    finally { setCurationBusy(false); }
  };

  const searchInside = async (nextQuery = query) => {
    const clean = nextQuery.trim();
    if (!clean) { setMatches(null); return; }
    try {
      const result = await api.get<DocumentMatches>(`/corpus/documents/${params.id}/matches`, { query: { q: clean } });
      setMatches(result);
      setActiveMatch(0);
      if (result.matches[0]) setPage(result.matches[0].page);
      setError('');
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'No se pudo buscar en el documento.');
    }
  };

  useEffect(() => {
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
        <label>Página <input type="number" min={1} max={document?.file?.pageCount ?? undefined} value={page} onChange={(event) => setPage(Math.max(1, Number(event.target.value) || 1))} /></label>
        <span>{pageCount ? `de ${pageCount}` : ''}</span>
        <button type="button" onClick={() => setPage((value) => Math.min(pageCount || value + 1, value + 1))}>Página siguiente</button>
        <form onSubmit={(event) => { event.preventDefault(); void searchInside(); }}>
          <input aria-label="Buscar en este documento" placeholder="Buscar en este documento" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button type="submit">Buscar</button>
        </form>
        <button type="button" onClick={() => void download()}>Descargar PDF</button>
      </div>
      <div className={styles.layout}>
        <section className={styles.pdfPanel} aria-label="Visor PDF">
          {pdfUrl ? <CorpusPdfViewer file={pdfUrl} page={page} matches={matches?.matches ?? []} activeMatch={activeMatch} onLoadSuccess={setPageCount} /> : <Card><p>Cargando PDF…</p></Card>}
        </section>
        <aside className={styles.sidePanel}>
          <Card>
            <h2>Coincidencias</h2>
            {matches ? <>
              <p>{matches.truncated ? `${matches.total}+ coincidencias (límite de navegación)` : `${matches.total} coincidencias`}</p>
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
          </Card> : <Card><p>Cargando panel de curaduría…</p></Card>}
        </aside>
      </div>
    </div>
  );
}

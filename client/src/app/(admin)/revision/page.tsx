'use client';

import { Link } from "@/lib/router-compat";
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from '@/lib/router-compat';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api';
import { confidenceLabel, evidenceLabel, reviewStatusLabel } from '@/lib/review-presentation';
import styles from './revision.module.css';

type ReviewKind = 'classification' | 'candidate' | 'ocr' | 'sourceMissing' | 'failed' | 'metadata';
type Queue = { total: number; page: number; pageSize: number; results: Array<{ id: string; title: string; status: string; locations?: Array<{ id: string }>; caseNumber: string | null; associations: Array<{ id: string; targetId: string; confidence: string; reviewStatus: string; evidence: unknown }>; classifications: Array<{ id: string; category: string; value: string; origin: string; confidence: number | null; reviewStatus: string }> }> };

function sourceDocumentLabel(title: string): string {
  return /^\d+$/u.test(title.trim()) ? 'Ver documento de origen' : title;
}

export default function RevisionPage() {
  const searchParams = useSearchParams();
  const [kind, setKind] = useState<ReviewKind>(() => {
    const filter = searchParams.get('filter') as ReviewKind | null;
    return filter && ['classification', 'candidate', 'ocr', 'sourceMissing', 'failed', 'metadata'].includes(filter) ? filter : 'candidate';
  });
  const [queue, setQueue] = useState<Queue | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setQueue(await api.get<Queue>('/corpus/documents/admin/review', { query: { filter: kind, page, pageSize: 50 } })); setSelected([]); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar la revisión.'); }
  }, [kind, page]);
  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);
  const reviewBatch = async (status: 'APPROVED' | 'REJECTED') => {
    if (!selected.length) return;
    const action = status === 'APPROVED' ? 'aprobar' : 'rechazar';
    const preview = suggestions.filter((item) => selected.includes(item.id)).map((item) => `• ${sourceDocumentLabel(item.doc.title)}: ${item.value}`).join('\n');
    if (!window.confirm(`Vista previa: ${action} ${selected.length} clasificación(es).\n\n${preview}\n\nLa decisión quedará auditada. No existe deshacer automático.`)) return;
    setBusy(true);
    try { await api.post('/corpus/curation/classifications/batch', { ids: selected, status }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron guardar las decisiones.'); }
    finally { setBusy(false); }
  };
  const reviewAssociation = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    setBusy(true);
    try { await api.patch(`/corpus/curation/associations/${id}`, { status }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo revisar la asociación.'); }
    finally { setBusy(false); }
  };
  const editClassification = async (item: (Queue['results'][number]['classifications'][number]) & { doc: Queue['results'][number] }) => {
    const value = window.prompt('Editar tema sugerido antes de aprobarlo', item.value);
    if (value === null || !value.trim()) return;
    setBusy(true);
    try { await api.patch(`/corpus/curation/classifications/${item.id}`, { status: 'APPROVED', category: item.category, value: value.trim() }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el tema.'); }
    finally { setBusy(false); }
  };

  const suggestions = queue?.results.flatMap((doc) => doc.classifications.filter((item) => item.reviewStatus === 'SUGGESTED').map((item) => ({ ...item, doc }))) ?? [];
  const associations = queue?.results.flatMap((doc) => doc.associations.filter((item) => item.reviewStatus === 'REVIEW_PENDING').map((item) => ({ ...item, doc }))) ?? [];
  return <main className={styles.page}>
    <PageHeader title="Revisión" description="Decisiones humanas pendientes. Las sugerencias no se aprueban ni vinculan automáticamente." />
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <div className={styles.tabs}>
      {([['candidate', 'Asociaciones'], ['classification', 'Temas sugeridos'], ['ocr', 'OCR pendiente'], ['sourceMissing', 'Fuente faltante'], ['failed', 'Errores'], ['metadata', 'Metadatos']] as Array<[ReviewKind, string]>).map(([filter, label]) => <button key={filter} type="button" aria-pressed={kind === filter} onClick={() => { setKind(filter); setPage(1); }}>{label}{kind === filter ? ` · ${queue?.total ?? '…'}` : ''}</button>)}
    </div>
    {kind === 'classification' ? <Card>
      <div className={styles.actions}><span>{selected.length} seleccionadas (máximo 20 por acción)</span><button disabled={!selected.length || busy} onClick={() => void reviewBatch('APPROVED')}>Aprobar seleccionadas</button><button disabled={!selected.length || busy} onClick={() => void reviewBatch('REJECTED')}>Rechazar seleccionadas</button></div>
      {suggestions.length ? <div className={styles.list}>{suggestions.map((item) => <div key={item.id} className={styles.row}>
        <input type="checkbox" aria-label={`Seleccionar sugerencia ${item.value}`} checked={selected.includes(item.id)} disabled={!selected.includes(item.id) && selected.length >= 20} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} />
        <span><strong>{item.value}</strong><small>{item.category} · {item.origin} · confianza {item.confidence == null ? '—' : `${Math.round(item.confidence * 100)}%`}</small><Link href={`/corpus/${encodeURIComponent(item.doc.id)}`} aria-label="Abrir documento de origen">{sourceDocumentLabel(item.doc.title)}</Link><button type="button" disabled={busy} onClick={() => void editClassification(item)}>Editar y aprobar</button></span>
      </div>)}</div> : <p>No hay temas sugeridos pendientes en esta página.</p>}
    </Card> : kind === 'candidate' ? <Card>
      <p>{queue?.total.toLocaleString('es-AR') ?? '—'} documentos con sugerencias de asociación. Todas requieren revisión humana; la coincidencia automática no aprueba ni publica un vínculo.</p>
      {associations.length ? <div className={styles.list}>{associations.map((item) => <article key={item.id} className={styles.row}>
        <span><strong>{confidenceLabel(item.confidence)}</strong><small>{reviewStatusLabel(item.reviewStatus)}</small><small>Destino sugerido · referencia interna del fallo #{item.targetId || 'sin ID'} · expediente {item.doc.caseNumber ?? 'no informado'}</small><small className={styles.evidence}>Evidencia: {evidenceLabel(item.evidence)}</small><Link href={`/corpus/${encodeURIComponent(item.doc.id)}`} aria-label="Abrir documento de origen">{sourceDocumentLabel(item.doc.title)}</Link></span>
        <div className={styles.actions}><button disabled={busy || !/^\d+$/.test(item.targetId)} title={!/^\d+$/.test(item.targetId) ? 'No hay un ID de sentencia verificable para aprobar' : undefined} onClick={() => void reviewAssociation(item.id, 'APPROVED')}>Aprobar vínculo</button><button disabled={busy} onClick={() => void reviewAssociation(item.id, 'REJECTED')}>Rechazar</button></div>
      </article>)}</div> : <p>No hay asociaciones pendientes en esta página.</p>}
    </Card> : <Card>
      <p>{queue?.total.toLocaleString('es-AR') ?? '—'} documentos en esta cola.</p>
      {queue?.results.length ? <div className={styles.list}>{queue.results.map((item) => <article key={item.id} className={styles.row}><span><strong>{item.title}</strong><small>Estado: {item.status}{item.locations?.length ? ' · fuente faltante' : ''}</small><small>{item.caseNumber ?? 'Sin expediente'}</small><Link href={`/corpus/${encodeURIComponent(item.id)}`}>Abrir documento</Link></span></article>)}</div> : <p>No hay documentos para revisar en esta página.</p>}
    </Card>}
    {queue && queue.total > queue.pageSize ? <div className={styles.pager}><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button><span>Página {queue.page} de {Math.ceil(queue.total / queue.pageSize)} · {queue.total.toLocaleString('es-AR')} documentos</span><button type="button" disabled={page * queue.pageSize >= queue.total} onClick={() => setPage((value) => value + 1)}>Siguiente</button></div> : null}
  </main>;
}

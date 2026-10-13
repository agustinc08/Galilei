'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api';
import styles from './corpus.module.css';

type Summary = {
  physicalFiles: number; documents: number; files: number; pages: number; unclassified: number; linked: number; unresolved: number; pendingAssociations: number; classifications: number;
  statusCounts: Record<string, number>;
  runs: Array<{ id: string; status: string; processed: number; uniqueHashes: number; failed: number; ocrRequired: number; startedAt: string; finishedAt: string | null }>;
};
type Review = { total: number; page: number; pageSize: number; results: Array<{ id: string; title: string; status: string; court: string | null; chamber: string | null; instance: string | null; caseNumber: string | null; decisionDate: string | null; editorialStatus: string; anonymizationStatus: string; associations: Array<{ confidence: string; reviewStatus: string }>; classifications: Array<{ category: string; value: string; origin: string; confidence: number | null; reviewStatus: string }>; files: Array<{ originalFilename: string; sha256: string; pageCount: number | null }> }> };
const filters = [
  ['all', 'Todos'], ['unresolved', 'Sin asociación'], ['candidate', 'Asociación candidata'], ['unclassified', 'Sin clasificación'], ['ocr', 'OCR requerido'], ['failed', 'Fallidos'], ['metadata', 'Metadata incompleta'],
] as const;

export default function CorpusAdminPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [filter, setFilter] = useState<string>('unresolved');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const [nextSummary, nextReview] = await Promise.all([
        api.get<Summary>('/corpus/documents/admin/summary'),
        api.get<Review>('/corpus/documents/admin/review', { query: { filter, page, pageSize: 50 } }),
      ]);
      setSummary(nextSummary);
      setReview(nextReview);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el inventario documental.');
    }
  }, [filter, page]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(timer); }, [load]);

  return <div className={styles.page}>
    <PageHeader title="Corpus documental" description="Inventario institucional local, extracción y elementos pendientes de revisión." />
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <div className={styles.metrics}>
      <Metric title="PDF físicos" value={summary?.physicalFiles} />
      <Metric title="Documentos Corpus" value={summary?.documents} />
      <Metric title="Páginas extraídas" value={summary?.pages} />
      <Metric title="Con texto" value={summary?.statusCounts.INDEXED} />
      <Metric title="OCR requerido" value={summary?.statusCounts.OCR_REQUIRED} />
      <Metric title="Vinculados a Jurisprudencia" value={summary?.linked} />
      <Metric title="Sin asociación" value={summary?.unresolved} />
      <Metric title="Sin clasificar" value={summary?.unclassified} />
    </div>
    <Card>
      <h2>Corridas de ingesta</h2>
      {summary?.runs.length ? <div className={styles.runs}>{summary.runs.map((run) => <div key={run.id}>
        <strong>{run.status}</strong><span>{run.processed.toLocaleString('es-AR')} / {run.uniqueHashes.toLocaleString('es-AR')} hashes</span><span>Fallidos {run.failed} · OCR {run.ocrRequired}</span>
      </div>)}</div> : <p>Sin corridas institucionales.</p>}
    </Card>
    <Card>
      <div className={styles.reviewHeader}><div><h2>Pendientes de revisión</h2><p>{review?.total.toLocaleString('es-AR') ?? '—'} documentos</p></div>
        <div className={styles.filterRow}>{filters.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); }}>{label}</button>)}</div>
      </div>
      <div className={styles.documents}>{review?.results.map((doc) => <article key={doc.id}>
        <div><strong>{doc.title}</strong><span className={styles.badge}>CORPUS · {doc.status}</span></div>
        <p>{[doc.caseNumber, doc.court, doc.chamber, doc.instance, doc.decisionDate ? new Date(doc.decisionDate).toLocaleDateString('es-AR') : null].filter(Boolean).join(' · ') || 'Metadata pendiente'}</p>
        <p>Curaduría: {doc.editorialStatus} · Anonimización: {doc.anonymizationStatus} · Asociaciones: {doc.associations.map((a) => `${a.confidence}/${a.reviewStatus}`).join(', ') || 'ninguna'}</p>
        {doc.classifications.length ? <p>{doc.classifications.map((item) => `${item.value} (${item.origin}, ${item.reviewStatus})`).join(' · ')}</p> : <p>Sin clasificación</p>}
        <Link href={`/corpus/${encodeURIComponent(doc.id)}`}>Abrir documento</Link>
      </article>)}</div>
      {review && review.total > review.pageSize ? <div className={styles.pager}><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button><span>{review.page} / {Math.ceil(review.total / review.pageSize)}</span><button type="button" disabled={page * review.pageSize >= review.total} onClick={() => setPage((value) => value + 1)}>Siguiente</button></div> : null}
    </Card>
  </div>;
}

function Metric({ title, value }: { title: string; value?: number }) {
  return <Card><span>{title}</span><strong>{value?.toLocaleString('es-AR') ?? '—'}</strong></Card>;
}

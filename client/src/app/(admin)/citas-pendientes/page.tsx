'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/lib/router-compat';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import type { ApiResponse } from '@/types/common';
import styles from './citation-review.module.css';

type Candidate = {
  id: number;
  sourceSentenceId: number;
  targetSentenceId: number | null;
  rawCitation: string;
  normalizedIdentifier: string | null;
  identifierType: string | null;
  status: string;
  extractionMethod: string;
  page: number | null;
  sourceSentence: { id: number; slugPublico: string | null; caratula: string | null; expediente: string | null; sala: string | null; fecha: string | null };
  targetSentence: { id: number; slugPublico: string | null; caratula: string | null; expediente: string | null; sala: string | null; fecha: string | null } | null;
};

export default function CitationReviewPage() {
  const [items, setItems] = useState<Candidate[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [targetIds, setTargetIds] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<ApiResponse<Candidate[]> & { meta: { total: number } }>(
        '/research/citation-candidates',
        { query: { status: 'DETECTED_CANDIDATE', pageSize: 100 } },
      );
      setItems(response.data);
      setTargetIds(Object.fromEntries(response.data.map((item) => [item.id, item.targetSentenceId ? String(item.targetSentenceId) : ''])));
      setError(null);
    } catch {
      setError('No se pudo cargar la cola de revisión.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void api.get<ApiResponse<Candidate[]> & { meta: { total: number } }>(
      '/research/citation-candidates',
      { query: { status: 'DETECTED_CANDIDATE', pageSize: 100 } },
    ).then((response) => {
      if (!active) return;
      setItems(response.data);
      setTargetIds(Object.fromEntries(response.data.map((item) => [item.id, item.targetSentenceId ? String(item.targetSentenceId) : ''])));
    }).catch(() => {
      if (active) setError('No se pudo cargar la cola de revisión.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const extract = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = Number(sourceId);
    if (!Number.isSafeInteger(id) || id < 1) return;
    setError(null);
    setMessage(null);
    try {
      const response = await api.post<ApiResponse<{ created: number }>>(`/research/citation-candidates/${id}/extract`);
      setMessage(`Detección acotada completa: ${response.data.created} candidatas nuevas. Nada se confirmó automáticamente.`);
      await load();
    } catch {
      setError('No se pudieron detectar citas para ese fallo.');
    }
  };

  const review = async (candidate: Candidate, status: 'VERIFIED' | 'REJECTED' | 'UNRESOLVED') => {
    setBusyId(candidate.id);
    setError(null);
    setMessage(null);
    try {
      const targetSentenceId = Number(targetIds[candidate.id] || candidate.targetSentenceId);
      await api.patch(`/research/citation-candidates/${candidate.id}/review`, {
        status,
        ...(status === 'VERIFIED' ? { targetSentenceId } : {}),
      });
      setMessage(status === 'VERIFIED' ? 'Relación verificada.' : status === 'REJECTED' ? 'Candidata rechazada.' : 'Candidata marcada sin resolver.');
      await load();
    } catch {
      setError(status === 'VERIFIED' ? 'No se pudo verificar. Indicá un destino publicado y activo.' : 'No se pudo actualizar la candidata.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <PageHeader title="Revisión de citas" description="Las referencias detectadas son candidatas. Solo una revisión editorial las publica como relaciones verificadas." />
      <Card>
        <form className={styles.extractForm} onSubmit={(event) => void extract(event)}>
          <label htmlFor="citation-source-id">Detectar citas de un fallo específico</label>
          <div className={styles.extractControls}>
            <input id="citation-source-id" type="number" min="1" step="1" value={sourceId} onChange={(event) => setSourceId(event.target.value)} placeholder="ID del fallo" required />
            <Button type="submit" disabled={!sourceId}>Detectar candidatas</Button>
          </div>
          <p>Solo analiza las referencias ya cargadas en esa ficha. No ejecuta backfill ni cambia la búsqueda.</p>
        </form>
      </Card>
      {error ? <StatusMessage variant="error" title="Revisión no completada" message={error} /> : null}
      {message ? <StatusMessage variant="success" title="Listo" message={message} /> : null}
      {loading ? <LoadingSpinner label="Cargando citas pendientes…" /> : items.length ? (
        <div className={styles.candidateList}>
          {items.map((item) => (
            <Card key={item.id}>
              <article className={styles.candidate}>
                <p><strong>Candidata sin verificar</strong></p>
                <blockquote>{item.rawCitation}</blockquote>
                <p>Origen: <Link href={`/sentencias/${item.sourceSentenceId}`}>{item.sourceSentence.caratula || item.sourceSentence.expediente || `Fallo ${item.sourceSentenceId}`}</Link></p>
                <p>Identificador detectado: {item.identifierType ?? 'sin clasificar'} · {item.normalizedIdentifier ?? 'no resuelto'}</p>
                <p>El destino propuesto se usa como sugerencia; una cita no determina vigencia ni autoridad legal.</p>
                <label htmlFor={`target-${item.id}`}>ID del fallo destino publicado</label>
                <input className={styles.targetInput} id={`target-${item.id}`} type="number" min="1" step="1" value={targetIds[item.id] ?? ''} onChange={(event) => setTargetIds((current) => ({ ...current, [item.id]: event.target.value }))} />
                <div className={styles.actions}>
                  <Button disabled={busyId === item.id || !targetIds[item.id]} onClick={() => void review(item, 'VERIFIED')}>Verificar relación</Button>
                  <Button variant="secondary" disabled={busyId === item.id} onClick={() => void review(item, 'UNRESOLVED')}>Sin resolver</Button>
                  <Button variant="danger" disabled={busyId === item.id} onClick={() => void review(item, 'REJECTED')}>Rechazar</Button>
                </div>
              </article>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No hay citas pendientes" description="Las nuevas detecciones quedan en revisión y nunca se publican automáticamente." />
      )}
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';
import styles from '@/components/sentencias/sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Textarea } from '@/components/ui/Textarea';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import {
  filterLegalVocabulary,
  findLegalVocabularyMatches,
  type LegalVocabularyStatusFilter,
} from '@/lib/legal-vocabulary-list';
import type { ApiResponse } from '@/types/common';
import type { InstitutoJuridico } from '@/types/busqueda';

type ReviewableKind = 'voz' | 'relacion';

function validationLabel(status?: InstitutoJuridico['estadoValidacion']) {
  switch (status) {
    case 'APROBADO': return 'Aprobada';
    case 'RECHAZADO': return 'Rechazada';
    default: return 'Pendiente de revisión';
  }
}

function publicationLabel(active: boolean, status?: InstitutoJuridico['estadoValidacion']) {
  if (active && status === 'APROBADO') return 'Activa para sugerencias';
  if (active) return 'Marcada activa; excluida por revisión pendiente';
  if (status === 'APROBADO') return 'Aprobada; inactiva';
  if (status === 'RECHAZADO') return 'Rechazada; inactiva';
  return 'Inactiva';
}

export default function InstitutosJuridicosPage() {
  const { user } = useAuth();
  const canReview = user?.rol.nombre === 'ADMIN';
  const [items, setItems] = useState<InstitutoJuridico[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [materia, setMateria] = useState('');
  const [fuente, setFuente] = useState('');
  const [identificadorFuente, setIdentificadorFuente] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [sinonimos, setSinonimos] = useState<Record<number, string>>({});
  const [sinonimoFuentes, setSinonimoFuentes] = useState<Record<number, string>>({});
  const [sinonimoReferencias, setSinonimoReferencias] = useState<Record<number, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<LegalVocabularyStatusFilter>('ALL');

  const filteredItems = filterLegalVocabulary(items, query, statusFilter);
  const possibleDuplicates = findLegalVocabularyMatches(items, nombre);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<ApiResponse<InstitutoJuridico[]>>('/institutos-juridicos');
      setItems(response.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el catálogo.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const initialLoad = async () => {
      try {
        const response = await api.get<ApiResponse<InstitutoJuridico[]>>('/institutos-juridicos');
        if (active) setItems(response.data);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el catálogo.');
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void initialLoad();
    return () => { active = false; };
  }, []);

  const resetForm = () => {
    setNombre('');
    setDescripcion('');
    setMateria('');
    setFuente('');
    setIdentificadorFuente('');
    setEditingId(null);
  };

  const saveVoice = async () => {
    if (!nombre.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || undefined,
        materia: materia.trim() || undefined,
        fuente: fuente.trim() || undefined,
        identificadorFuente: identificadorFuente.trim() || undefined,
      };
      if (editingId !== null) {
        await api.patch(`/institutos-juridicos/${editingId}`, payload);
        setFeedback('Propuesta actualizada y enviada nuevamente a revisión; queda inactiva.');
      } else {
        await api.post('/institutos-juridicos', payload);
        setFeedback('Propuesta guardada pendiente e inactiva.');
      }
      resetForm();
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo guardar la propuesta.');
    } finally {
      setIsSaving(false);
    }
  };

  const startEditing = (item: InstitutoJuridico) => {
    setEditingId(item.id);
    setNombre(item.nombre);
    setDescripcion(item.descripcion ?? '');
    setMateria(item.materia ?? '');
    setFuente(item.fuente ?? '');
    setIdentificadorFuente(item.identificadorFuente ?? '');
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const desactivar = async (id: number) => {
    setIsSaving(true);
    setError(null);
    try {
      await api.delete(`/institutos-juridicos/${id}`);
      setFeedback('Voz desactivada; la ficha y su procedencia se conservaron.');
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo desactivar la voz.');
    } finally {
      setIsSaving(false);
    }
  };

  const activar = async (kind: ReviewableKind, id: number, activo: boolean) => {
    setIsSaving(true);
    setError(null);
    try {
      const route = kind === 'voz'
        ? `/institutos-juridicos/${id}/activacion`
        : `/sinonimos-juridicos/${id}/activacion`;
      await api.post(route, { activo });
      setFeedback(activo
        ? 'Propuesta aprobada y activada para sugerencias opcionales.'
        : 'Propuesta desactivada; se conservó su historial.');
      await load();
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : 'No se pudo cambiar la activación.');
    } finally {
      setIsSaving(false);
    }
  };

  const agregarSinonimo = async (id: number) => {
    const termino = sinonimos[id]?.trim();
    if (!termino) return;
    setIsSaving(true);
    setError(null);
    try {
      await api.post(`/institutos-juridicos/${id}/sinonimos`, {
        termino,
        fuente: sinonimoFuentes[id]?.trim() || undefined,
        identificadorFuente: sinonimoReferencias[id]?.trim() || undefined,
      });
      setSinonimos((current) => ({ ...current, [id]: '' }));
      setSinonimoFuentes((current) => ({ ...current, [id]: '' }));
      setSinonimoReferencias((current) => ({ ...current, [id]: '' }));
      setFeedback('Relación de equivalencia guardada pendiente e inactiva.');
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo guardar la relación.');
    } finally {
      setIsSaving(false);
    }
  };

  const desactivarSinonimo = async (id: number) => {
    setIsSaving(true);
    setError(null);
    try {
      await api.delete(`/sinonimos-juridicos/${id}`);
      setFeedback('Relación desactivada; se conservó para auditoría.');
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo desactivar la relación.');
    } finally {
      setIsSaving(false);
    }
  };

  const review = async (kind: ReviewableKind, id: number, estado: 'APROBADO' | 'RECHAZADO') => {
    const key = `${kind}:${id}`;
    const observacion = reviewNotes[key]?.trim();
    if (estado === 'RECHAZADO' && !observacion) {
      setError('Indicá el motivo antes de rechazar una propuesta.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const route = kind === 'voz'
        ? `/institutos-juridicos/${id}/revision`
        : `/sinonimos-juridicos/${id}/revision`;
      await api.post(route, { estado, observacion: observacion || undefined });
      setFeedback(estado === 'APROBADO'
        ? 'Propuesta aprobada; queda inactiva hasta una activación explícita.'
        : 'Propuesta rechazada y mantenida inactiva.');
      setReviewNotes((current) => ({ ...current, [key]: '' }));
      await load();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'No se pudo registrar la revisión.');
    } finally {
      setIsSaving(false);
    }
  };

  const reviewControls = (kind: ReviewableKind, id: number, status?: InstitutoJuridico['estadoValidacion']) => (
    canReview ? (
      <div className={styles.section}>
        <Input
          label="Observación de revisión (obligatoria para rechazar)"
          value={reviewNotes[`${kind}:${id}`] ?? ''}
          onChange={(event) => setReviewNotes((current) => ({ ...current, [`${kind}:${id}`]: event.target.value }))}
        />
        <div className={styles.inlineActions}>
          {status !== 'APROBADO' ? <Button onClick={() => void review(kind, id, 'APROBADO')} disabled={isSaving}>Aprobar</Button> : null}
          {status !== 'RECHAZADO' ? <Button variant="secondary" onClick={() => void review(kind, id, 'RECHAZADO')} disabled={isSaving}>Rechazar</Button> : null}
        </div>
      </div>
    ) : null
  );

  return (
    <div className={styles.section}>
      <PageHeader
        title="Catálogo de voces jurídicas"
        description="Propuestas con procedencia visible y revisión previa a su uso en sugerencias."
      />

      {feedback ? <StatusMessage variant="success" title="Operación realizada" message={feedback} /> : null}
      {error ? <StatusMessage variant="error" title="Error" message={error} /> : null}
      <StatusMessage
        variant="info"
        title="Las propuestas no cambian la búsqueda"
        message="Aprobación y activación son pasos separados. Aprobar no habilita sugerencias: un administrador debe activar la voz o relación por separado. La búsqueda original se conserva siempre y las relaciones activas sólo se ofrecen como sugerencias seleccionables."
      />

      <Card>
        <div className={styles.section}>
          <h2>{editingId === null ? 'Nueva propuesta' : 'Editar propuesta'}</h2>
          {editingId !== null ? <p>Al editar se retira la aprobación anterior y la propuesta vuelve a quedar inactiva.</p> : null}
          <div className={styles.formGrid}>
            <Input label="Voz jurídica" value={nombre} onChange={(event) => setNombre(event.target.value)} />
            <Input label="Materia" value={materia} onChange={(event) => setMateria(event.target.value)} />
            <Input label="Fuente de procedencia" value={fuente} onChange={(event) => setFuente(event.target.value)} />
            <Input label="Identificador en la fuente" value={identificadorFuente} onChange={(event) => setIdentificadorFuente(event.target.value)} />
            <Textarea label="Descripción" value={descripcion} onChange={(event) => setDescripcion(event.target.value)} />
          </div>
          {possibleDuplicates.length ? (
            <StatusMessage variant="info" title="Revisá posibles duplicados" message={possibleDuplicates.map((item) => `${item.term} (${item.relation})`).join(' · ')} />
          ) : null}
          <div className={styles.inlineActions}>
            <Button onClick={() => void saveVoice()} disabled={isSaving || !nombre.trim()}>
              {isSaving ? 'Guardando...' : editingId === null ? 'Guardar propuesta' : 'Guardar cambios pendientes'}
            </Button>
            {editingId !== null ? <Button variant="secondary" onClick={resetForm} disabled={isSaving}>Cancelar edición</Button> : null}
          </div>
        </div>
      </Card>

      <Card>
        <div className={styles.formGrid}>
          <Input label="Buscar voz, materia, procedencia o equivalencia" value={query} onChange={(event) => setQuery(event.target.value)} />
          <label>
            Estado de uso
            <select aria-label="Filtrar voces por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as LegalVocabularyStatusFilter)}>
              <option value="ALL">Todos</option>
              <option value="ACTIVE">Activos</option>
              <option value="INACTIVE">Inactivos / propuestas</option>
            </select>
          </label>
        </div>
        <p>Coincidencias: {filteredItems.length}</p>
      </Card>

      {isLoading ? <LoadingSpinner label="Cargando catálogo..." /> : filteredItems.length === 0 ? (
        <EmptyState title={items.length ? 'Sin coincidencias' : 'Catálogo sin voces'} description={items.length ? 'Probá otro texto o cambiá el filtro.' : 'Las propuestas revisadas aparecerán aquí.'} />
      ) : (
        <div className={styles.listGrid}>
          {filteredItems.map((item) => (
            <Card key={item.id}>
              <div className={styles.section}>
                <div className={styles.splitHeader}>
                  <strong>{item.nombre}</strong>
                  <div className={styles.badgeRow}>
                    <span className={styles.badge}>{validationLabel(item.estadoValidacion)}</span>
                    <span className={styles.badge}>{publicationLabel(item.activo, item.estadoValidacion)}</span>
                  </div>
                </div>
                {item.descripcion ? <p>{item.descripcion}</p> : null}
                <p>Materia: {item.materia || 'Sin clasificar'} · Fuente: {item.fuente || 'Sin registrar'} · Ref.: {item.identificadorFuente || 'Sin identificar'}</p>
                {item.observacionRevision ? <p>Observación: {item.observacionRevision}</p> : null}
                {reviewControls('voz', item.id, item.estadoValidacion)}
                {canReview && item.estadoValidacion === 'APROBADO' && !item.activo ? (
                  <Button onClick={() => void activar('voz', item.id, true)} disabled={isSaving}>Activar voz</Button>
                ) : null}
                <div className={styles.inlineActions}>
                  <Button variant="secondary" onClick={() => startEditing(item)} disabled={isSaving}>Editar</Button>
                  <Button variant="danger" onClick={() => void desactivar(item.id)} disabled={isSaving || !item.activo}>Desactivar</Button>
                </div>

                <div className={styles.listGrid}>
                  {(item.sinonimos ?? []).map((sinonimo) => (
                    <article key={sinonimo.id} className={styles.listItem}>
                      <strong>{sinonimo.termino}</strong>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>{validationLabel(sinonimo.estadoValidacion)}</span>
                        <span className={styles.badge}>{publicationLabel(sinonimo.activo, sinonimo.estadoValidacion)}</span>
                      </div>
                      <p>Fuente: {sinonimo.fuente || 'Sin registrar'} · Ref.: {sinonimo.identificadorFuente || 'Sin identificar'}</p>
                      {sinonimo.observacionRevision ? <p>Observación: {sinonimo.observacionRevision}</p> : null}
                      {reviewControls('relacion', sinonimo.id, sinonimo.estadoValidacion)}
                      {canReview && sinonimo.estadoValidacion === 'APROBADO' && !sinonimo.activo ? (
                        <Button onClick={() => void activar('relacion', sinonimo.id, true)} disabled={isSaving || item.estadoValidacion !== 'APROBADO' || !item.activo}>
                          Activar relación
                        </Button>
                      ) : null}
                      <Button variant="danger" onClick={() => void desactivarSinonimo(sinonimo.id)} disabled={isSaving || !sinonimo.activo}>Desactivar relación</Button>
                    </article>
                  ))}
                </div>

                <div className={styles.section}>
                  <Input label="Equivalencia propuesta" value={sinonimos[item.id] ?? ''} onChange={(event) => setSinonimos((current) => ({ ...current, [item.id]: event.target.value }))} />
                  <div className={styles.formGrid}>
                    <Input label="Fuente de la equivalencia" value={sinonimoFuentes[item.id] ?? ''} onChange={(event) => setSinonimoFuentes((current) => ({ ...current, [item.id]: event.target.value }))} />
                    <Input label="Identificador de procedencia" value={sinonimoReferencias[item.id] ?? ''} onChange={(event) => setSinonimoReferencias((current) => ({ ...current, [item.id]: event.target.value }))} />
                  </div>
                  <Button variant="secondary" onClick={() => void agregarSinonimo(item.id)} disabled={isSaving || !(sinonimos[item.id] ?? '').trim()}>
                    Guardar relación pendiente
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

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
import { api } from '@/lib/api';
import {
  filterLegalVocabulary,
  findLegalVocabularyMatches,
  type LegalVocabularyStatusFilter,
} from '@/lib/legal-vocabulary-list';
import type { ApiResponse } from '@/types/common';
import type { InstitutoJuridico } from '@/types/busqueda';

export default function InstitutosJuridicosPage() {
  const [items, setItems] = useState<InstitutoJuridico[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [sinonimos, setSinonimos] = useState<Record<number, string>>({});
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] =
    useState<LegalVocabularyStatusFilter>('ALL');

  const filteredItems = filterLegalVocabulary(items, query, statusFilter);
  const possibleDuplicates = findLegalVocabularyMatches(items, nombre);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<ApiResponse<InstitutoJuridico[]>>(
        '/institutos-juridicos',
      );
      setItems(response.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    const initialLoad = async () => {
      try {
        const response = await api.get<ApiResponse<InstitutoJuridico[]>>(
          '/institutos-juridicos',
        );
        if (!active) return;
        setItems(response.data);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar.');
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void initialLoad();

    return () => {
      active = false;
    };
  }, []);

  const crear = async () => {
    if (!nombre.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      await api.post('/institutos-juridicos', { nombre, descripcion: descripcion || undefined });
      setNombre('');
      setDescripcion('');
      setFeedback('Propuesta guardada inactiva; todavía no alimenta sugerencias.');
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo guardar la propuesta.');
    } finally {
      setIsSaving(false);
    }
  };

  const desactivar = async (id: number) => {
    setIsSaving(true);
    try {
      await api.delete(`/institutos-juridicos/${id}`);
      setFeedback('Instituto jurídico desactivado.');
      await load();
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
      await api.post(`/institutos-juridicos/${id}/sinonimos`, { termino });
      setSinonimos((current) => ({ ...current, [id]: '' }));
      setFeedback('Equivalencia propuesta guardada inactiva.');
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo guardar la equivalencia.');
    } finally {
      setIsSaving(false);
    }
  };

  const desactivarSinonimo = async (id: number) => {
    setIsSaving(true);
    try {
      await api.delete(`/sinonimos-juridicos/${id}`);
      setFeedback('Sinonimo desactivado.');
      await load();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.section}>
      <PageHeader
        title="Institutos jurídicos"
        description="Voces y equivalencias registradas para la búsqueda jurídica."
      />

      {feedback ? <StatusMessage variant="success" title="Operacion realizada" message={feedback} /> : null}
      {error ? <StatusMessage variant="error" title="Error" message={error} /> : null}
      <StatusMessage
        variant="info"
        title="Revisión de procedencia pendiente"
        message="El modelo actual no registra materia, fuente, identificador ni estado de validación. Las voces y equivalencias nuevas se guardan inactivas y no alimentan sugerencias hasta que se incorpore ese control."
      />

      <Card>
        <div className={styles.section}>
          <div className={styles.formGrid}>
            <Input label="Voz propuesta" value={nombre} onChange={(event) => setNombre(event.target.value)} />
            <Textarea label="Descripción y referencia de procedencia" value={descripcion} onChange={(event) => setDescripcion(event.target.value)} />
          </div>
          {possibleDuplicates.length ? (
            <StatusMessage
              variant="info"
              title="Revisá posibles duplicados"
              message={possibleDuplicates.map((item) => `${item.term} (${item.relation})`).join(' · ')}
            />
          ) : null}
          <div className={styles.inlineActions}>
            <Button onClick={() => void crear()} disabled={isSaving || !nombre.trim()}>
              {isSaving ? 'Guardando...' : 'Guardar propuesta inactiva'}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className={styles.formGrid}>
          <Input
            label="Buscar voz, descripción o equivalencia"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label>
            Estado
            <select
              aria-label="Filtrar voces por estado"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as LegalVocabularyStatusFilter)
              }
            >
              <option value="ALL">Todos</option>
              <option value="ACTIVE">Activos</option>
              <option value="INACTIVE">Inactivos / propuestas</option>
            </select>
          </label>
        </div>
        <p>Coincidencias: {filteredItems.length}</p>
      </Card>

      {isLoading ? (
        <LoadingSpinner label="Cargando institutos..." />
      ) : filteredItems.length === 0 && items.length === 0 ? (
        <EmptyState title="Sin institutos" description="Todavia no hay institutos cargados." />
      ) : filteredItems.length === 0 ? (
        <EmptyState title="Sin coincidencias" description="Probá otro texto o cambiá el filtro de estado." />
      ) : (
        <div className={styles.listGrid}>
          {filteredItems.map((item) => (
            <Card key={item.id}>
              <div className={styles.section}>
                <div className={styles.splitHeader}>
                  <strong>{item.nombre}</strong>
                  <div className={styles.badgeRow}>
                    <span className={styles.badge}>{item.activo ? 'Activo' : 'Inactivo'}</span>
                  </div>
                </div>
                {item.descripcion ? <p>{item.descripcion}</p> : null}
                <div className={styles.badgeRow}>
                  {(item.sinonimos ?? []).map((sinonimo) => (
                    <span key={sinonimo.id} className={styles.badge}>
                      {sinonimo.termino} · {sinonimo.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  ))}
                </div>
                <div className={styles.formGrid}>
                  <Input
                    label="Nueva equivalencia propuesta"
                    value={sinonimos[item.id] ?? ''}
                    onChange={(event) =>
                      setSinonimos((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                </div>
                <div className={styles.inlineActions}>
                  <Button variant="secondary" onClick={() => void agregarSinonimo(item.id)} disabled={isSaving || !(sinonimos[item.id] ?? '').trim()}>
                    Guardar equivalencia inactiva
                  </Button>
                  <Button variant="danger" onClick={() => void desactivar(item.id)} disabled={isSaving}>
                    Desactivar instituto
                  </Button>
                </div>
                {(item.sinonimos ?? []).length ? (
                  <div className={styles.listGrid}>
                    {(item.sinonimos ?? []).map((sinonimo) => (
                      <article key={sinonimo.id} className={styles.listItem}>
                        <strong>{sinonimo.termino}</strong>
                        <div className={styles.inlineActions}>
                          <Button
                            variant="danger"
                            onClick={() => void desactivarSinonimo(sinonimo.id)}
                            disabled={isSaving}
                          >
                            Desactivar
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

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
    try {
      await api.post('/institutos-juridicos', { nombre, descripcion: descripcion || undefined });
      setNombre('');
      setDescripcion('');
      setFeedback('Instituto jurídico creado.');
      await load();
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
    try {
      await api.post(`/institutos-juridicos/${id}/sinonimos`, { termino });
      setSinonimos((current) => ({ ...current, [id]: '' }));
      setFeedback('Sinonimo agregado.');
      await load();
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
        description="Equivalencias terminológicas para ampliar la búsqueda."
      />

      {feedback ? <StatusMessage variant="success" title="Operacion realizada" message={feedback} /> : null}
      {error ? <StatusMessage variant="error" title="Error" message={error} /> : null}

      <Card>
        <div className={styles.section}>
          <div className={styles.formGrid}>
            <Input label="Nombre" value={nombre} onChange={(event) => setNombre(event.target.value)} />
            <Textarea label="Descripcion" value={descripcion} onChange={(event) => setDescripcion(event.target.value)} />
          </div>
          <div className={styles.inlineActions}>
            <Button onClick={() => void crear()} disabled={isSaving}>
              {isSaving ? 'Guardando...' : 'Crear instituto'}
            </Button>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <LoadingSpinner label="Cargando institutos..." />
      ) : items.length === 0 ? (
        <EmptyState title="Sin institutos" description="Todavia no hay institutos cargados." />
      ) : (
        <div className={styles.listGrid}>
          {items.map((item) => (
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
                      {sinonimo.termino}
                    </span>
                  ))}
                </div>
                <div className={styles.formGrid}>
                  <Input
                    label="Nuevo sinonimo"
                    value={sinonimos[item.id] ?? ''}
                    onChange={(event) =>
                      setSinonimos((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                </div>
                <div className={styles.inlineActions}>
                  <Button variant="secondary" onClick={() => void agregarSinonimo(item.id)} disabled={isSaving}>
                    Agregar sinonimo
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

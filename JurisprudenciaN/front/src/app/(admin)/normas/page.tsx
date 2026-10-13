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
import type { ApiResponse, PaginatedResponse } from '@/types/common';
import type { EquivalenciaNormativa, NormaArticulo } from '@/types/busqueda';

export default function NormasPage() {
  const [items, setItems] = useState<NormaArticulo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [form, setForm] = useState({
    codigo: '',
    numeroNorma: '',
    articulo: '',
    titulo: '',
    texto: '',
    url: '',
  });
  const [equivalencias, setEquivalencias] = useState<Record<number, EquivalenciaNormativa[]>>({});
  const [equivForm, setEquivForm] = useState<Record<number, { articuloDestinoId: string; tipoRelacion: string; observacion: string }>>({});

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<PaginatedResponse<NormaArticulo>>('/normas');
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
        const response = await api.get<PaginatedResponse<NormaArticulo>>('/normas');
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
    if (!form.codigo.trim() || !form.articulo.trim()) return;
    setIsSaving(true);
    try {
      await api.post('/normas', {
        ...form,
        numeroNorma: form.numeroNorma || undefined,
        titulo: form.titulo || undefined,
        texto: form.texto || undefined,
        url: form.url || undefined,
      });
      setForm({
        codigo: '',
        numeroNorma: '',
        articulo: '',
        titulo: '',
        texto: '',
        url: '',
      });
      setFeedback('Norma creada.');
      await load();
    } finally {
      setIsSaving(false);
    }
  };

  const desactivar = async (id: number) => {
    setIsSaving(true);
    try {
      await api.delete(`/normas/${id}`);
      setFeedback('Norma desactivada.');
      await load();
    } finally {
      setIsSaving(false);
    }
  };

  const cargarEquivalencias = async (id: number) => {
    const response = await api.get<ApiResponse<EquivalenciaNormativa[]>>(`/normas/${id}/equivalencias`);
    setEquivalencias((current) => ({ ...current, [id]: response.data }));
  };

  const crearEquivalencia = async (id: number) => {
    const values = equivForm[id];
    if (!values?.articuloDestinoId || !values.tipoRelacion.trim()) return;
    setIsSaving(true);
    try {
      await api.post(`/normas/${id}/equivalencias`, {
        articuloDestinoId: Number(values.articuloDestinoId),
        tipoRelacion: values.tipoRelacion,
        observacion: values.observacion || undefined,
      });
      setEquivForm((current) => ({
        ...current,
        [id]: { articuloDestinoId: '', tipoRelacion: '', observacion: '' },
      }));
      setFeedback('Equivalencia agregada.');
      await cargarEquivalencias(id);
    } finally {
      setIsSaving(false);
    }
  };

  const eliminarEquivalencia = async (id: number, equivalenciaId: number) => {
    setIsSaving(true);
    try {
      await api.delete(`/equivalencias-normativas/${equivalenciaId}`);
      setFeedback('Equivalencia eliminada.');
      await cargarEquivalencias(id);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.section}>
      <PageHeader title="Normas y articulos" description="Base normativa y tabla de equivalencias." />

      {feedback ? <StatusMessage variant="success" title="Operacion realizada" message={feedback} /> : null}
      {error ? <StatusMessage variant="error" title="Error" message={error} /> : null}

      <Card>
        <div className={styles.section}>
          <div className={styles.formGrid}>
            <Input label="Codigo" value={form.codigo} onChange={(event) => setForm((current) => ({ ...current, codigo: event.target.value }))} />
            <Input label="N° norma" value={form.numeroNorma} onChange={(event) => setForm((current) => ({ ...current, numeroNorma: event.target.value }))} />
            <Input label="Articulo" value={form.articulo} onChange={(event) => setForm((current) => ({ ...current, articulo: event.target.value }))} />
            <Input label="Titulo" value={form.titulo} onChange={(event) => setForm((current) => ({ ...current, titulo: event.target.value }))} />
            <Input label="URL" value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} />
          </div>
          <Textarea label="Texto" value={form.texto} onChange={(event) => setForm((current) => ({ ...current, texto: event.target.value }))} />
          <div className={styles.inlineActions}>
            <Button onClick={() => void crear()} disabled={isSaving}>
              {isSaving ? 'Guardando...' : 'Crear norma'}
            </Button>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <LoadingSpinner label="Cargando normas..." />
      ) : items.length === 0 ? (
        <EmptyState title="Sin normas" description="Todavia no hay articulos cargados." />
      ) : (
        <div className={styles.listGrid}>
          {items.map((item) => (
            <Card key={item.id}>
              <div className={styles.section}>
                <div className={styles.splitHeader}>
                  <strong>
                    {item.codigo} {item.numeroNorma ? `${item.numeroNorma} ` : ''}art. {item.articulo}
                  </strong>
                  <span className={styles.badge}>{item.vigente ? 'Vigente' : 'No vigente'}</span>
                </div>
                {item.titulo ? <p>{item.titulo}</p> : null}
                {item.texto ? <p className={styles.mutedText}>{item.texto}</p> : null}
                <div className={styles.inlineActions}>
                  <Button variant="secondary" onClick={() => void cargarEquivalencias(item.id)}>
                    Ver equivalencias
                  </Button>
                  <Button variant="danger" onClick={() => void desactivar(item.id)} disabled={isSaving}>
                    Desactivar
                  </Button>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <Button variant="secondary">Abrir link</Button>
                    </a>
                  ) : null}
                </div>
                <div className={styles.formGrid}>
                  <Input
                    label="Articulo destino ID"
                    value={equivForm[item.id]?.articuloDestinoId ?? ''}
                    onChange={(event) =>
                      setEquivForm((current) => ({
                        ...current,
                        [item.id]: {
                          articuloDestinoId: event.target.value,
                          tipoRelacion: current[item.id]?.tipoRelacion ?? '',
                          observacion: current[item.id]?.observacion ?? '',
                        },
                      }))
                    }
                  />
                  <Input
                    label="Tipo relacion"
                    value={equivForm[item.id]?.tipoRelacion ?? ''}
                    onChange={(event) =>
                      setEquivForm((current) => ({
                        ...current,
                        [item.id]: {
                          articuloDestinoId: current[item.id]?.articuloDestinoId ?? '',
                          tipoRelacion: event.target.value,
                          observacion: current[item.id]?.observacion ?? '',
                        },
                      }))
                    }
                  />
                  <Input
                    label="Observacion"
                    value={equivForm[item.id]?.observacion ?? ''}
                    onChange={(event) =>
                      setEquivForm((current) => ({
                        ...current,
                        [item.id]: {
                          articuloDestinoId: current[item.id]?.articuloDestinoId ?? '',
                          tipoRelacion: current[item.id]?.tipoRelacion ?? '',
                          observacion: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div className={styles.inlineActions}>
                  <Button variant="secondary" onClick={() => void crearEquivalencia(item.id)} disabled={isSaving}>
                    Agregar equivalencia
                  </Button>
                </div>

                {(equivalencias[item.id] ?? []).length ? (
                  <div className={styles.listGrid}>
                    {(equivalencias[item.id] ?? []).map((equivalencia) => (
                      <article key={equivalencia.id} className={styles.listItem}>
                        <strong>
                          {equivalencia.tipoRelacion}: art. {equivalencia.articuloDestino?.articulo ?? equivalencia.articuloDestinoId}
                        </strong>
                        {equivalencia.observacion ? <p>{equivalencia.observacion}</p> : null}
                        <div className={styles.inlineActions}>
                          <Button
                            variant="danger"
                            onClick={() => void eliminarEquivalencia(item.id, equivalencia.id)}
                            disabled={isSaving}
                          >
                            Eliminar
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

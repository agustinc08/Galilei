'use client';

import { Link, useRouter } from '@/lib/router-compat';
import { useEffect, useMemo, useState } from 'react';
import styles from '@/components/sentencias/sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Table } from '@/components/ui/Table';
import { Textarea } from '@/components/ui/Textarea';
import { api } from '@/lib/api';
import { buildQueryString, formatDate, formatDateTime } from '@/lib/utils';
import { publicSearchPathFromSaved } from '@/lib/research-continuity';
import type { ApiResponse } from '@/types/common';
import type { BusquedaGuardada } from '@/types/busqueda-guardada';
import researchStyles from '@/components/research/saved-search-novelties.module.css';

type NoveltyDecision = {
  id: number;
  slugPublico: string | null;
  caratula: string | null;
  numeroSentencia: string | null;
  sala: string | null;
  fecha: string | null;
  expediente: string | null;
  tipoFallo: string | null;
};

type NoveltyResponse = {
  data: NoveltyDecision[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
    hasMore: boolean;
    baselineEstablished: boolean;
    lastViewedAt: string;
    evaluatedAt: string;
  };
};

type NoveltyView = {
  searchId: number;
  searchName: string;
  response: NoveltyResponse;
};

type FormValues = {
  nombre: string;
  queryJson: string;
};

const initialForm: FormValues = {
  nombre: '',
  queryJson: '{\n  "tema": "danos"\n}',
};

export default function BusquedasGuardadasPage() {
  const router = useRouter();
  const [items, setItems] = useState<BusquedaGuardada[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormValues>(initialForm);
  const [noveltyView, setNoveltyView] = useState<NoveltyView | null>(null);
  const [noveltyLoadingId, setNoveltyLoadingId] = useState<number | null>(null);

  const title = useMemo(
    () => (editingId ? `Editar búsqueda #${editingId}` : 'Nueva búsqueda guardada'),
    [editingId],
  );

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<ApiResponse<BusquedaGuardada[]>>('/busquedas-guardadas');
      setItems(response.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar las búsquedas.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    const loadInitial = async () => {
      try {
        const response = await api.get<ApiResponse<BusquedaGuardada[]>>('/busquedas-guardadas');
        if (active) {
          setItems(response.data);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar las búsquedas.');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadInitial();

    return () => {
      active = false;
    };
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm(initialForm);
  };

  const submit = async () => {
    let parsedQuery: Record<string, unknown>;

    try {
      parsedQuery = JSON.parse(form.queryJson) as Record<string, unknown>;
    } catch {
      setError('El JSON de filtros no es valido.');
      return;
    }

    if (editingId) {
      await api.patch(`/busquedas-guardadas/${editingId}`, {
        nombre: form.nombre,
        queryJson: parsedQuery,
      });
      setFeedback('Búsqueda actualizada.');
    } else {
      await api.post('/busquedas-guardadas', {
        nombre: form.nombre,
        queryJson: parsedQuery,
      });
      setFeedback('Búsqueda creada.');
    }

    resetForm();
    await load();
  };

  const loadNovelties = async (
    search: BusquedaGuardada,
    page = 1,
    evaluatedAt?: string,
  ) => {
    setNoveltyLoadingId(search.id);
    setError(null);
    try {
      const response = await api.get<NoveltyResponse>(
        `/busquedas-guardadas/${search.id}/novedades`,
        { query: { page, pageSize: 25, evaluatedAt } },
      );
      setNoveltyView({ searchId: search.id, searchName: search.nombre, response });
      setItems((current) => current.map((item) => item.id === search.id
        ? { ...item, lastNewCount: response.meta.total, noveltyAvailable: true }
        : item));
    } catch {
      setError('No se pudieron cargar las novedades. No se marcaron como revisadas.');
    } finally {
      setNoveltyLoadingId(null);
    }
  };

  const markNoveltiesViewed = async () => {
    if (!noveltyView) return;
    setError(null);
    try {
      await api.post(`/busquedas-guardadas/${noveltyView.searchId}/novedades/vistas`, {
        viewedThrough: noveltyView.response.meta.evaluatedAt,
      });
      setNoveltyView(null);
      setFeedback('Novedades marcadas como revisadas.');
      await load();
    } catch {
      setError('No se pudieron marcar las novedades como revisadas. Podés intentarlo nuevamente.');
    }
  };

  return (
    <div className={styles.section}>
      <PageHeader
        title="Búsquedas guardadas"
        description="Persistencia simple de filtros de consulta para reutilizarlos despues."
      />

      {feedback ? <StatusMessage variant="success" title="Operacion realizada" message={feedback} /> : null}
      {error ? <StatusMessage variant="error" title="Error" message={error} /> : null}

      <Card>
        <div className={styles.section}>
          <strong>{title}</strong>
          <Input
            label="Nombre"
            value={form.nombre}
            onChange={(event) => setForm((current) => ({ ...current, nombre: event.target.value }))}
          />
          <Textarea
            label="Filtros JSON"
            value={form.queryJson}
            onChange={(event) => setForm((current) => ({ ...current, queryJson: event.target.value }))}
          />
          <div className={styles.inlineActions}>
            <Button onClick={() => void submit()}>{editingId ? 'Guardar cambios' : 'Guardar búsqueda'}</Button>
            {editingId ? <Button variant="secondary" onClick={resetForm}>Cancelar</Button> : null}
          </div>
        </div>
      </Card>

      {isLoading ? (
        <LoadingSpinner label="Cargando búsquedas..." />
      ) : items.length === 0 ? (
        <EmptyState title="No hay búsquedas guardadas" description="Podés guardar filtros desde Sentencias o crear una manualmente aquí." />
      ) : (
        <>
          {noveltyView ? (
            <Card>
              <section className={researchStyles.panel} aria-labelledby="saved-search-novelties-title">
                <div className={researchStyles.panelHeader}>
                  <div>
                    <h2 id="saved-search-novelties-title">Novedades: {noveltyView.searchName}</h2>
                    <p>{noveltyView.response.meta.total} fallo(s) nuevo(s) desde {formatDateTime(noveltyView.response.meta.lastViewedAt)}.</p>
                  </div>
                  <Button variant="secondary" onClick={() => void markNoveltiesViewed()}>
                    Marcar como revisadas
                  </Button>
                </div>
                {noveltyView.response.meta.baselineEstablished ? (
                  <p role="status">Se creó el punto de inicio de esta búsqueda. Las incorporaciones posteriores aparecerán como novedades.</p>
                ) : noveltyView.response.data.length ? (
                  <div className={researchStyles.results}>
                    {noveltyView.response.data.map((item) => (
                      <article key={item.id} className={researchStyles.result}>
                        <Link href={`/fallos/${item.slugPublico ?? item.id}`}>
                          <strong>{item.caratula ?? item.numeroSentencia ?? `Fallo ${item.id}`}</strong>
                        </Link>
                        <span>{[
                          item.sala ? `Sala ${item.sala}` : null,
                          item.fecha ? formatDate(item.fecha) : null,
                          item.numeroSentencia ? `Sentencia ${item.numeroSentencia}` : null,
                          item.expediente ? `Expte. ${item.expediente}` : null,
                          item.tipoFallo,
                        ].filter(Boolean).join(' · ')}</span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p>No hay fallos nuevos para esta búsqueda desde la última revisión.</p>
                )}
                {noveltyView.response.meta.pageCount > 1 ? (
                  <nav className={researchStyles.pagination} aria-label="Páginas de novedades">
                    <Button
                      variant="secondary"
                      disabled={noveltyView.response.meta.page <= 1 || noveltyLoadingId !== null}
                      onClick={() => {
                        const search = items.find((item) => item.id === noveltyView.searchId);
                        if (search) void loadNovelties(
                          search,
                          noveltyView.response.meta.page - 1,
                          noveltyView.response.meta.evaluatedAt,
                        );
                      }}
                    >Anterior</Button>
                    <span>Página {noveltyView.response.meta.page} de {noveltyView.response.meta.pageCount}</span>
                    <Button
                      variant="secondary"
                      disabled={noveltyView.response.meta.page >= noveltyView.response.meta.pageCount || noveltyLoadingId !== null}
                      onClick={() => {
                        const search = items.find((item) => item.id === noveltyView.searchId);
                        if (search) void loadNovelties(
                          search,
                          noveltyView.response.meta.page + 1,
                          noveltyView.response.meta.evaluatedAt,
                        );
                      }}
                    >Siguiente</Button>
                  </nav>
                ) : null}
              </section>
            </Card>
          ) : null}
          <Card>
            <Table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Ultima actualizacion</th>
                  <th>Novedades</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.nombre}</td>
                    <td>{formatDateTime(item.updatedAt)}</td>
                    <td>
                      {item.noveltyAvailable === false ? (
                        <span aria-label="Novedades temporalmente no disponibles">No disponible</span>
                      ) : item.lastNewCount ? (
                        <span className={researchStyles.badge}>{item.lastNewCount} {item.lastNewCount === 1 ? 'novedad' : 'novedades'}</span>
                      ) : (
                        <span>0</span>
                      )}
                    </td>
                    <td>
                      <div className={styles.inlineActions}>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            const publicPath = publicSearchPathFromSaved(item.queryJson);
                            if (publicPath) {
                              router.push(publicPath);
                              return;
                            }
                            const query = buildQueryString(item.queryJson);
                            router.push(`/sentencias?${query}`);
                          }}
                        >
                          Ejecutar
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void loadNovelties(item)}
                          disabled={noveltyLoadingId !== null || (item.noveltyAvailable !== false && !item.lastNewCount)}
                        >
                          {noveltyLoadingId === item.id ? 'Cargando…' : item.noveltyAvailable === false ? 'Reintentar novedades' : 'Ver novedades'}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setEditingId(item.id);
                            setForm({
                              nombre: item.nombre,
                              queryJson: JSON.stringify(item.queryJson, null, 2),
                            });
                          }}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="danger"
                          onClick={async () => {
                            await api.delete(`/busquedas-guardadas/${item.id}`);
                            await load();
                          }}
                        >
                          Eliminar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

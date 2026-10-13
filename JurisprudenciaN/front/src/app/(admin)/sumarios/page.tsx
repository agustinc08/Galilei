'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import styles from '@/components/sentencias/sentencias.module.css';
import { SumarioForm } from '@/components/sumarios/SumarioForm';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Select } from '@/components/ui/Select';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Table } from '@/components/ui/Table';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { ApiResponse, PaginatedResponse } from '@/types/common';
import type { Sumario, SumarioFilters, SumarioFormValues } from '@/types/sumario';

const defaultFilters: SumarioFilters = {
  page: 1,
  pageSize: 10,
  sentenciaId: '',
  numeroSumario: '',
  tema: '',
  publicado: '',
  activo: '',
};

const emptyForm: SumarioFormValues = {
  sentenciaId: '',
  numeroSumario: '',
  tema: '',
  texto: '',
  resumenBusqueda: '',
  publicado: false,
  activo: true,
};

export default function SumariosPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<SumarioFilters>(defaultFilters);
  const [result, setResult] = useState<PaginatedResponse<Sumario> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<SumarioFormValues>(emptyForm);
  const [isLoadingForm, setIsLoadingForm] = useState(false);

  const title = useMemo(
    () => (editingId ? `Editar sumario #${editingId}` : 'Nuevo sumario'),
    [editingId],
  );

  useEffect(() => {
    let active = true;

    const loadInitial = async () => {
      if (active) {
        setIsLoading(true);
        setError(null);
      }

      try {
        const response = await api.get<PaginatedResponse<Sumario>>('/sumarios', {
          query: defaultFilters,
        });
        if (active) {
          setResult(response);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los sumarios.');
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

  const load = async (nextFilters = filters) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<PaginatedResponse<Sumario>>('/sumarios', {
        query: nextFilters,
      });
      setResult(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los sumarios.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadForEdit = async (id: number) => {
    setIsLoadingForm(true);
    setFeedback(null);
    setError(null);
    try {
      const response = await api.get<ApiResponse<Sumario>>(`/sumarios/${id}`);
      setEditingId(id);
      setFormValues({
        sentenciaId: response.data.sentenciaId,
        numeroSumario: response.data.numeroSumario ?? '',
        tema: response.data.tema ?? '',
        texto: response.data.texto,
        resumenBusqueda: response.data.resumenBusqueda ?? '',
        publicado: response.data.publicado,
        activo: response.data.activo,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el sumario.');
    } finally {
      setIsLoadingForm(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setFormValues(emptyForm);
  };

  const submitForm = async (values: SumarioFormValues) => {
    const payload = {
      sentenciaId: Number(values.sentenciaId),
      numeroSumario: values.numeroSumario.trim() || undefined,
      tema: values.tema.trim() || undefined,
      texto: values.texto.trim(),
      resumenBusqueda: values.resumenBusqueda.trim() || undefined,
      publicado: values.publicado,
      activo: values.activo,
    };

    if (editingId) {
      await api.patch(`/sumarios/${editingId}`, payload);
      setFeedback(`Se actualizo el sumario #${editingId}.`);
    } else {
      await api.post('/sumarios', payload);
      setFeedback('Se creo el sumario.');
    }

    resetForm();
    await load();
  };

  const togglePublished = async (sumario: Sumario) => {
    await api.patch(`/sumarios/${sumario.id}/${sumario.publicado ? 'despublicar' : 'publicar'}`);
    setFeedback(sumario.publicado ? 'Sumario despublicado.' : 'Sumario publicado.');
    await load();
  };

  const removeSumario = async (sumario: Sumario) => {
    if (!window.confirm(`Desactivar sumario ${sumario.id}?`)) {
      return;
    }

    await api.delete(`/sumarios/${sumario.id}`);
    setFeedback(`Se desactivo el sumario #${sumario.id}.`);
    await load();
  };

  const isAdmin = user?.rol.nombre === 'ADMIN';

  return (
    <div className={styles.section}>
      <PageHeader
        title="Sumarios"
        description="Gestión de sumarios con filtros, paginación y edición directa."
        actions={
          editingId ? (
            <Button variant="secondary" onClick={resetForm}>
              Nuevo sumario
            </Button>
          ) : null
        }
      />

      {feedback ? (
        <StatusMessage variant="success" title="Operacion realizada" message={feedback} />
      ) : null}
      {error ? <StatusMessage variant="error" title="Error" message={error} /> : null}

      <Card>
        <div className={styles.section}>
          <strong>Filtros</strong>
          <div className={styles.filtersGrid}>
            <Input
              label="ID sentencia"
              type="number"
              min={1}
              value={filters.sentenciaId ?? ''}
              onChange={(event) =>
                setFilters((current) => ({ ...current, sentenciaId: event.target.value, page: 1 }))
              }
            />
            <Input
              label="N° de sumario"
              value={filters.numeroSumario ?? ''}
              onChange={(event) =>
                setFilters((current) => ({ ...current, numeroSumario: event.target.value, page: 1 }))
              }
            />
            <Input
              label="Tema"
              value={filters.tema ?? ''}
              onChange={(event) =>
                setFilters((current) => ({ ...current, tema: event.target.value, page: 1 }))
              }
            />
            <Select
              label="Publicado"
              value={filters.publicado ?? ''}
              onChange={(event) =>
                setFilters((current) => ({ ...current, publicado: event.target.value, page: 1 }))
              }
              options={[
                { label: 'Todos', value: '' },
                { label: 'Publicados', value: 'true' },
                { label: 'No publicados', value: 'false' },
              ]}
            />
            <Select
              label="Activo"
              value={filters.activo ?? ''}
              onChange={(event) =>
                setFilters((current) => ({ ...current, activo: event.target.value, page: 1 }))
              }
              options={[
                { label: 'Todos', value: '' },
                { label: 'Activos', value: 'true' },
                { label: 'Inactivos', value: 'false' },
              ]}
            />
          </div>
          <div className={styles.inlineActions}>
            <Button onClick={() => void load(filters)}>Buscar</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setFilters(defaultFilters);
                void load(defaultFilters);
              }}
            >
              Limpiar filtros
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className={styles.section}>
          <strong>{title}</strong>
          {isLoadingForm ? (
            <LoadingSpinner label="Cargando sumario..." />
          ) : (
            <SumarioForm
              key={editingId ? `sumario-${editingId}` : 'sumario-new'}
              initialValues={formValues}
              submitLabel={editingId ? 'Guardar cambios' : 'Crear sumario'}
              onSubmit={submitForm}
              onCancel={editingId ? resetForm : undefined}
            />
          )}
        </div>
      </Card>

      {isLoading ? (
        <LoadingSpinner label="Cargando sumarios..." />
      ) : !result || result.data.length === 0 ? (
        <EmptyState title="No hay sumarios para mostrar" description="Ajusta filtros o crea un nuevo sumario." />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Número</th>
                <th>Tema</th>
                <th>Sentencia</th>
                <th>Publicado</th>
                <th>Activo</th>
                <th>Creado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((sumario) => (
                <tr key={sumario.id}>
                  <td>{sumario.id}</td>
                  <td>{sumario.numeroSumario ?? '-'}</td>
                  <td>{sumario.tema ?? '-'}</td>
                  <td>
                    <div className={styles.section}>
                      <span>#{sumario.sentenciaId}</span>
                      {sumario.sentencia ? (
                        <Link href={`/sentencias/${sumario.sentenciaId}`}>
                          {sumario.sentencia.numeroSentencia ?? 'Ver sentencia'}
                        </Link>
                      ) : null}
                    </div>
                  </td>
                  <td>{sumario.publicado ? 'Sí' : 'No'}</td>
                  <td>{sumario.activo ? 'Sí' : 'No'}</td>
                  <td>{formatDateTime(sumario.createdAt)}</td>
                  <td>
                    <div className={styles.inlineActions}>
                      <Button variant="secondary" onClick={() => void loadForEdit(sumario.id)}>
                        Editar
                      </Button>
                      <Button variant="secondary" onClick={() => void togglePublished(sumario)}>
                        {sumario.publicado ? 'Despublicar' : 'Publicar'}
                      </Button>
                      {isAdmin ? (
                        <Button variant="danger" onClick={() => void removeSumario(sumario)}>
                          Desactivar
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={result.meta.page}
            pageCount={result.meta.pageCount}
            total={result.meta.total}
            pageSize={result.meta.pageSize}
            onPageChange={(page) => {
              const next = { ...filters, page };
              setFilters(next);
              void load(next);
            }}
            onPageSizeChange={(pageSize) => {
              const next = { ...filters, page: 1, pageSize };
              setFilters(next);
              void load(next);
            }}
          />
        </Card>
      )}
    </div>
  );
}

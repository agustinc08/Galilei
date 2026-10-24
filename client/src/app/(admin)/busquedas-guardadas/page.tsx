'use client';

import { useRouter } from '@/lib/router-compat';
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
import { buildQueryString, formatDateTime } from '@/lib/utils';
import type { ApiResponse } from '@/types/common';
import type { BusquedaGuardada } from '@/types/busqueda-guardada';

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
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Ultima actualizacion</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.nombre}</td>
                  <td>{formatDateTime(item.updatedAt)}</td>
                  <td>
                    <div className={styles.inlineActions}>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          const query = buildQueryString(item.queryJson);
                          router.push(`/sentencias?${query}`);
                        }}
                      >
                        Ejecutar
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
      )}
    </div>
  );
}

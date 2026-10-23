'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { PaginatedResponse } from '@/types/common';
import type { AccionLog, LogsFilters } from '@/types/logs';

const entidadOptions = [
  { label: 'Todas', value: '' },
  { label: 'Sentencia', value: 'SENTENCIA' },
  { label: 'Sumario', value: 'SUMARIO' },
  { label: 'Reseña', value: 'RESEÑA' },
  { label: 'Cita', value: 'CITA' },
  { label: 'Referencia', value: 'REFERENCIA' },
  { label: 'PDF', value: 'PDF' },
];

const accionOptions = [
  { label: 'Todas', value: '' },
  { label: 'Create', value: 'CREATE' },
  { label: 'Update', value: 'UPDATE' },
  { label: 'Delete', value: 'DELETE' },
  { label: 'Publicar', value: 'PUBLICAR' },
  { label: 'Despublicar', value: 'DESPUBLICAR' },
  { label: 'Anonimizar', value: 'ANONIMIZAR' },
  { label: 'Desanonimizar', value: 'DESANONIMIZAR' },
  { label: 'Confirmar', value: 'CONFIRMAR' },
  { label: 'Upload', value: 'UPLOAD' },
  { label: 'Detectar', value: 'DETECTAR' },
];

const defaultFilters: LogsFilters = {
  usuarioId: '',
  entidad: '',
  accion: '',
  fechaDesde: '',
  fechaHasta: '',
  page: 1,
  pageSize: 20,
};

export default function AdminLogsPage() {
  const [filters, setFilters] = useState<LogsFilters>(defaultFilters);
  const [result, setResult] = useState<PaginatedResponse<AccionLog> | null>(null);
  const [selected, setSelected] = useState<AccionLog | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextFilters: LogsFilters) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get<PaginatedResponse<AccionLog>>('/logs', {
        query: nextFilters,
      });
      setResult(response);
      if (selected) {
        const detail = await api.get<{ data: AccionLog }>(`/logs/${selected.id}`);
        setSelected(detail.data);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los logs.');
    } finally {
      setIsLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load(defaultFilters);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [load]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Auditoria"
        description="Registro de acciones internas sobre contenido y publicación."
      />

      <Card>
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <Input
              label="Usuario ID"
              type="number"
              min={1}
              value={filters.usuarioId ?? ''}
              onChange={(event) => setFilters((current) => ({ ...current, usuarioId: event.target.value, page: 1 }))}
            />
            <Select
              label="Entidad"
              value={filters.entidad ?? ''}
              options={entidadOptions}
              onChange={(event) => setFilters((current) => ({ ...current, entidad: event.target.value, page: 1 }))}
            />
            <Select
              label="Accion"
              value={filters.accion ?? ''}
              options={accionOptions}
              onChange={(event) => setFilters((current) => ({ ...current, accion: event.target.value, page: 1 }))}
            />
            <Input
              label="Fecha desde"
              type="date"
              value={filters.fechaDesde ?? ''}
              onChange={(event) => setFilters((current) => ({ ...current, fechaDesde: event.target.value, page: 1 }))}
            />
            <Input
              label="Fecha hasta"
              type="date"
              value={filters.fechaHasta ?? ''}
              onChange={(event) => setFilters((current) => ({ ...current, fechaHasta: event.target.value, page: 1 }))}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Button onClick={() => void load(filters)}>Filtrar</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setFilters(defaultFilters);
                setSelected(null);
                void load(defaultFilters);
              }}
            >
              Limpiar
            </Button>
          </div>
        </div>
      </Card>

      {error ? <StatusMessage variant="error" title="Error" message={error} /> : null}

      {isLoading ? (
        <LoadingSpinner label="Cargando auditoria..." />
      ) : !result || result.data.length === 0 ? (
        <EmptyState title="Sin logs" description="No hay acciones registradas para los filtros actuales." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(320px, 1fr)', gap: 16 }}>
          <Card>
            <Table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Usuario</th>
                  <th>Entidad</th>
                  <th>Accion</th>
                  <th>Descripcion</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>
                      {item.usuario.nombre} {item.usuario.apellido ?? ''}
                    </td>
                    <td>{item.entidad}</td>
                    <td>{item.accion}</td>
                    <td>{item.descripcion ?? '-'}</td>
                    <td>
                      <Button
                        variant="secondary"
                        onClick={async () => {
                          const detail = await api.get<{ data: AccionLog }>(`/logs/${item.id}`);
                          setSelected(detail.data);
                        }}
                      >
                        Ver
                      </Button>
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

          <Card>
            {!selected ? (
              <EmptyState
                title="Selecciona un log"
                description="Desde la tabla puedes abrir el detalle para ver el antes y el después."
              />
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                <strong>
                  {selected.descripcion ?? `${selected.accion} ${selected.entidad}`}
                </strong>
                <span>{formatDateTime(selected.createdAt)}</span>
                <span>
                  Usuario: {selected.usuario.nombre} {selected.usuario.apellido ?? ''} ({selected.usuario.email})
                </span>
                <span>
                  Entidad: {selected.entidad} {selected.entidadId ? `#${selected.entidadId}` : ''}
                </span>
                <span>Accion: {selected.accion}</span>
                <div>
                  <strong>Datos antes</strong>
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {JSON.stringify(selected.datosAntes ?? null, null, 2)}
                  </pre>
                </div>
                <div>
                  <strong>Datos despues</strong>
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {JSON.stringify(selected.datosDespues ?? null, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

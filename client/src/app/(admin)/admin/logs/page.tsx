'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Select } from '@/components/ui/Select';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { PaginatedResponse } from '@/types/common';
import type { AccionLog, LogsFilters } from '@/types/logs';
import styles from './logs.module.css';

const entidadOptions = [
  { label: 'Todas', value: '' }, { label: 'Sentencia', value: 'SENTENCIA' },
  { label: 'Sumario', value: 'SUMARIO' }, { label: 'Reseña', value: 'RESEÑA' },
  { label: 'Cita', value: 'CITA' }, { label: 'Referencia', value: 'REFERENCIA' },
  { label: 'PDF', value: 'PDF' },
];
const accionOptions = [
  { label: 'Todas', value: '' }, { label: 'Crear', value: 'CREATE' },
  { label: 'Actualizar', value: 'UPDATE' }, { label: 'Eliminar', value: 'DELETE' },
  { label: 'Publicar', value: 'PUBLICAR' }, { label: 'Despublicar', value: 'DESPUBLICAR' },
  { label: 'Anonimizar', value: 'ANONIMIZAR' }, { label: 'Desanonimizar', value: 'DESANONIMIZAR' },
  { label: 'Confirmar', value: 'CONFIRMAR' }, { label: 'Subir archivo', value: 'UPLOAD' },
  { label: 'Detectar', value: 'DETECTAR' },
];
const defaultFilters: LogsFilters = {
  usuarioId: '', entidad: '', accion: '', fechaDesde: '', fechaHasta: '', page: 1, pageSize: 20,
};

export default function AdminLogsPage() {
  const [filters, setFilters] = useState<LogsFilters>(defaultFilters);
  const [result, setResult] = useState<PaginatedResponse<AccionLog> | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<AccionLog | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);

  const loadList = useCallback(async (nextFilters: LogsFilters) => {
    const request = ++listRequest.current;
    setIsLoading(true);
    setListError(null);
    try {
      const response = await api.get<PaginatedResponse<AccionLog>>('/logs', { query: nextFilters });
      if (request === listRequest.current) setResult(response);
    } catch {
      if (request === listRequest.current) setListError('No pudimos cargar los registros de auditoría. Revisá la conexión e intentá nuevamente.');
    } finally {
      if (request === listRequest.current) setIsLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    const request = ++detailRequest.current;
    setSelectedId(id);
    setSelected(null);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await api.get<{ data: AccionLog }>(`/logs/${id}`);
      if (request === detailRequest.current) setSelected(response.data);
    } catch {
      if (request === detailRequest.current) setDetailError('No pudimos cargar el detalle. La lista sigue disponible; podés volver a intentar.');
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }, []);

  const closeDetail = () => {
    detailRequest.current += 1;
    setSelectedId(null);
    setSelected(null);
    setDetailError(null);
    setDetailLoading(false);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadList(defaultFilters); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadList]);

  return (
    <div className={styles.page}>
      <PageHeader title="Auditoría" description="Registro de acciones internas sobre contenido y publicación." />

      <Card>
        <div className={styles.filters}>
          <Input label="Usuario ID" type="number" min={1} value={filters.usuarioId ?? ''}
            onChange={(event) => setFilters((current) => ({ ...current, usuarioId: event.target.value, page: 1 }))} />
          <Select label="Entidad" value={filters.entidad ?? ''} options={entidadOptions}
            onChange={(event) => setFilters((current) => ({ ...current, entidad: event.target.value, page: 1 }))} />
          <Select label="Acción" value={filters.accion ?? ''} options={accionOptions}
            onChange={(event) => setFilters((current) => ({ ...current, accion: event.target.value, page: 1 }))} />
          <Input label="Fecha desde (dd/mm/aaaa)" lang="es-AR" type="date" value={filters.fechaDesde ?? ''}
            onChange={(event) => setFilters((current) => ({ ...current, fechaDesde: event.target.value, page: 1 }))} />
          <Input label="Fecha hasta (dd/mm/aaaa)" lang="es-AR" type="date" value={filters.fechaHasta ?? ''}
            onChange={(event) => setFilters((current) => ({ ...current, fechaHasta: event.target.value, page: 1 }))} />
          <div className={styles.filterActions}>
            <Button onClick={() => void loadList(filters)}>Filtrar</Button>
            <Button variant="secondary" onClick={() => { setFilters(defaultFilters); closeDetail(); void loadList(defaultFilters); }}>Limpiar</Button>
          </div>
        </div>
      </Card>

      {listError ? <div className={styles.errorBlock}>
        <StatusMessage variant="error" title="Error de auditoría" message={listError} />
        <Button onClick={() => void loadList(filters)}>Reintentar</Button>
      </div> : null}

      {isLoading && !result ? <LoadingSpinner label="Cargando registros de auditoría…" />
        : !result ? <EmptyState title="Registros no disponibles" description="Intentá cargar la lista nuevamente." />
          : result.data.length === 0 ? <EmptyState title="Sin registros" description="No hay acciones registradas para los filtros actuales. Podés cambiar los filtros para ampliar la búsqueda." />
            : <Card>
              <div className={styles.listHeader}><strong>{result.meta.total.toLocaleString('es-AR')} registros</strong><span>Seleccioná una fila para consultar el detalle.</span></div>
              <div className={styles.logList} aria-label="Registros de auditoría">
                {result.data.map((item) => (
                  <article key={item.id} className={`${styles.logRow} ${selectedId === item.id ? styles.logRowSelected : ''}`}>
                    <button type="button" className={styles.logSummary} onClick={() => void loadDetail(item.id)} aria-label={`Ver detalle del registro ${item.id}`} aria-current={selectedId === item.id ? 'true' : undefined}>
                      <span><small>Fecha</small><strong>{formatDateTime(item.createdAt)}</strong></span>
                      <span><small>Usuario</small><strong>{item.usuario.nombre} {item.usuario.apellido ?? ''}</strong></span>
                      <span><small>Acción</small><strong>{item.accion}</strong></span>
                      <span className={styles.logDescription}><small>Registro</small><strong>{item.descripcion ?? `${item.entidad}${item.entidadId ? ` #${item.entidadId}` : ''}`}</strong><small>{item.entidad}</small></span>
                    </button>
                    <Button variant="secondary" onClick={() => void loadDetail(item.id)}>Ver detalle</Button>
                  </article>
                ))}
              </div>
              <Pagination page={result.meta.page} pageCount={result.meta.pageCount} total={result.meta.total}
                pageSize={result.meta.pageSize}
                onPageChange={(page) => { const next = { ...filters, page }; setFilters(next); void loadList(next); }}
                onPageSizeChange={(pageSize) => { const next = { ...filters, page: 1, pageSize }; setFilters(next); void loadList(next); }} />
            </Card>}

      {selectedId !== null ? <>
        <button type="button" className={styles.drawerBackdrop} aria-label="Cerrar detalle" onClick={closeDetail} />
        <section className={styles.detailDrawer} role="dialog" aria-modal="true" aria-labelledby="audit-detail-title">
          <header className={styles.detailHeader}>
            <div><p className={styles.eyebrow}>REGISTRO #{selectedId}</p><h2 id="audit-detail-title">Detalle de auditoría</h2></div>
            <Button variant="secondary" onClick={closeDetail}>Cerrar</Button>
          </header>
          {detailLoading ? <LoadingSpinner label="Cargando detalle…" />
            : detailError ? <div className={styles.errorBlock}><StatusMessage variant="error" title="Detalle no disponible" message={detailError} /><Button onClick={() => void loadDetail(selectedId)}>Reintentar</Button></div>
              : selected ? <div className={styles.detailContent}>
                <strong>{selected.descripcion ?? `${selected.accion} ${selected.entidad}`}</strong>
                <span>{formatDateTime(selected.createdAt)}</span>
                <span>Usuario: {selected.usuario.nombre} {selected.usuario.apellido ?? ''} ({selected.usuario.email})</span>
                <span>Entidad: {selected.entidad} {selected.entidadId ? `#${selected.entidadId}` : ''}</span>
                <span>Acción: {selected.accion}</span>
                <details><summary>Datos anteriores</summary><pre>{JSON.stringify(selected.datosAntes ?? null, null, 2)}</pre></details>
                <details><summary>Datos posteriores</summary><pre>{JSON.stringify(selected.datosDespues ?? null, null, 2)}</pre></details>
              </div> : null}
        </section>
      </> : null}
    </div>
  );
}

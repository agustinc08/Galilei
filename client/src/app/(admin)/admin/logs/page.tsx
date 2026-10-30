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
import { formatAuditAction, formatAuditEntity, formatDateInput, formatDateTime, maskDateInput, parseDateInput } from '@/lib/utils';
import type { PaginatedResponse } from '@/types/common';
import type { AccionLog, LogsFilters } from '@/types/logs';
import styles from './logs.module.css';

const entidadOptions = [
  { label: 'Todas', value: '' }, { label: 'Sentencia', value: 'SENTENCIA' },
  { label: 'Sumario', value: 'SUMARIO' }, { label: 'Reseña', value: 'RESEÑA' },
  { label: 'Cita', value: 'CITA' }, { label: 'Referencia', value: 'REFERENCIA' },
  { label: 'PDF', value: 'PDF' }, { label: 'Documento personal', value: 'PersonalDocument' },
  { label: 'Documento compartido', value: 'WorkspaceDocument' },
  { label: 'Carpeta de dependencia', value: 'WorkspaceFolder' },
  { label: 'Espacio documental', value: 'DocumentWorkspace' },
  { label: 'Trabajo de OCR', value: 'OcrJob' },
];
const accionOptions = [
  { label: 'Todas', value: '' }, { label: 'Crear', value: 'CREATE' },
  { label: 'Actualizar', value: 'UPDATE' }, { label: 'Eliminar', value: 'DELETE' },
  { label: 'Publicar', value: 'PUBLICAR' }, { label: 'Despublicar', value: 'DESPUBLICAR' },
  { label: 'Anonimizar', value: 'ANONIMIZAR' }, { label: 'Desanonimizar', value: 'DESANONIMIZAR' },
  { label: 'Confirmar', value: 'CONFIRMAR' }, { label: 'Subir archivo', value: 'UPLOAD' },
  { label: 'Detectar', value: 'DETECTAR' }, { label: 'Subir documento personal', value: 'PERSONAL_UPLOAD' },
  { label: 'Subir carpeta a Mis documentos', value: 'PERSONAL_FOLDER_UPLOAD' },
  { label: 'Eliminar documento personal', value: 'PERSONAL_DOCUMENT_DELETE' },
  { label: 'Subir documento al espacio', value: 'WORKSPACE_DOCUMENT_UPLOAD' },
  { label: 'Eliminar documento del espacio', value: 'WORKSPACE_DOCUMENT_DELETE' },
  { label: 'Mover documento entre espacios', value: 'WORKSPACE_DOCUMENT_MOVE' },
  { label: 'Crear carpeta de dependencia', value: 'FOLDER_CREATE' },
  { label: 'Crear carpeta restringida', value: 'RESTRICTED_FOLDER_CREATE' },
  { label: 'Renombrar carpeta', value: 'FOLDER_RENAME' },
  { label: 'Eliminar carpeta', value: 'WORKSPACE_FOLDER_DELETE' },
  { label: 'Cambiar visibilidad de carpeta', value: 'FOLDER_VISIBILITY_CHANGED' },
  { label: 'Cambiar acceso restringido', value: 'RESTRICTED_FOLDER_ACCESS_CHANGED' },
  { label: 'Crear carpeta personal', value: 'PERSONAL_FOLDER_CREATE' },
  { label: 'Renombrar carpeta personal', value: 'PERSONAL_FOLDER_RENAME' },
  { label: 'Aprobar vínculo documental', value: 'DOCUMENT_LINK_APPROVE' },
  { label: 'Rechazar vínculo documental', value: 'DOCUMENT_LINK_REJECT' },
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
  const [dateDrafts, setDateDrafts] = useState({
    fechaDesde: formatDateInput(defaultFilters.fechaDesde),
    fechaHasta: formatDateInput(defaultFilters.fechaHasta),
  });
  const [dateError, setDateError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [compactFilters, setCompactFilters] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
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

  const changeDate = (field: 'fechaDesde' | 'fechaHasta', value: string) => {
    const draft = maskDateInput(value);
    const parsed = draft ? parseDateInput(draft) : '';
    setDateDrafts((current) => ({ ...current, [field]: draft }));
    setFilters((current) => ({ ...current, [field]: parsed ?? '', page: 1 }));
    setDateError('');
  };

  const applyFilters = () => {
    const fechaDesde = dateDrafts.fechaDesde ? parseDateInput(dateDrafts.fechaDesde) : '';
    const fechaHasta = dateDrafts.fechaHasta ? parseDateInput(dateDrafts.fechaHasta) : '';
    if ((dateDrafts.fechaDesde && !fechaDesde) || (dateDrafts.fechaHasta && !fechaHasta)) {
      setDateError('Ingresá fechas válidas en formato dd/mm/aaaa.');
      return;
    }
    if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
      setDateError('La fecha desde debe ser anterior o igual a la fecha hasta.');
      return;
    }
    setDateError('');
    const nextFilters = { ...filters, fechaDesde: fechaDesde || '', fechaHasta: fechaHasta || '', page: 1 };
    setFilters(nextFilters);
    void loadList(nextFilters);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadList(defaultFilters); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadList]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 420px)');
    const update = () => setCompactFilters(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return (
    <div className={styles.page}>
      <PageHeader title="Auditoría" description="Registro de acciones internas sobre contenido y publicación." />

      <Card>
        <button type="button" className={styles.mobileFiltersToggle} aria-controls="audit-filters" aria-expanded={!compactFilters || filtersExpanded}
          onClick={() => setFiltersExpanded((expanded) => !expanded)}>
          <span>Filtros de auditoría</span><span>{filtersExpanded ? 'Ocultar filtros' : 'Mostrar filtros'}</span>
        </button>
        <div id="audit-filters" className={styles.filters} hidden={compactFilters && !filtersExpanded}>
          <Input label="Usuario ID" type="number" min={1} value={filters.usuarioId ?? ''}
            onChange={(event) => setFilters((current) => ({ ...current, usuarioId: event.target.value, page: 1 }))} />
          <Select label="Entidad" value={filters.entidad ?? ''} options={entidadOptions}
            onChange={(event) => setFilters((current) => ({ ...current, entidad: event.target.value, page: 1 }))} />
          <Select label="Acción" value={filters.accion ?? ''} options={accionOptions}
            onChange={(event) => setFilters((current) => ({ ...current, accion: event.target.value, page: 1 }))} />
          <Input label="Fecha desde (dd/mm/aaaa)" type="text" inputMode="numeric" autoComplete="off" maxLength={10} placeholder="dd/mm/aaaa" value={dateDrafts.fechaDesde}
            onChange={(event) => changeDate('fechaDesde', event.target.value)} />
          <Input label="Fecha hasta (dd/mm/aaaa)" type="text" inputMode="numeric" autoComplete="off" maxLength={10} placeholder="dd/mm/aaaa" value={dateDrafts.fechaHasta}
            onChange={(event) => changeDate('fechaHasta', event.target.value)} />
          <div className={styles.filterActions}>
            <Button onClick={applyFilters}>Filtrar</Button>
            <Button variant="secondary" onClick={() => { setDateDrafts({ fechaDesde: '', fechaHasta: '' }); setDateError(''); setFilters(defaultFilters); closeDetail(); void loadList(defaultFilters); }}>Limpiar</Button>
          </div>
        </div>
        {dateError ? <p className={styles.filterError} role="alert">{dateError}</p> : null}
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
                      <span><small>Acción</small><strong>{formatAuditAction(item.accion)}</strong></span>
                      <span className={styles.logDescription}><small>Registro</small><strong>{item.descripcion ?? `${formatAuditEntity(item.entidad, item.accion)}${item.entidadId ? ` #${item.entidadId}` : ''}`}</strong><small>{formatAuditEntity(item.entidad, item.accion)}</small></span>
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
                <strong>{selected.descripcion ?? `${formatAuditAction(selected.accion)} · ${formatAuditEntity(selected.entidad, selected.accion)}`}</strong>
                <span>{formatDateTime(selected.createdAt)}</span>
                <span>Usuario: {selected.usuario.nombre} {selected.usuario.apellido ?? ''} ({selected.usuario.email})</span>
                <span>Entidad: {formatAuditEntity(selected.entidad, selected.accion)} {selected.entidadId ? `#${selected.entidadId}` : ''}</span>
                <span>Acción: {formatAuditAction(selected.accion)}</span>
                <details><summary>Datos anteriores</summary><pre>{JSON.stringify(selected.datosAntes ?? null, null, 2)}</pre></details>
                <details><summary>Datos posteriores</summary><pre>{JSON.stringify(selected.datosDespues ?? null, null, 2)}</pre></details>
              </div> : null}
        </section>
      </> : null}
    </div>
  );
}

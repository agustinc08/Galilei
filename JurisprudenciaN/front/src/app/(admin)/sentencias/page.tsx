'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import styles from '@/components/sentencias/sentencias.module.css';
import { SentenciasFilters } from '@/components/sentencias/SentenciasFilters';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ExportMenu } from '@/components/ui/ExportMenu';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Table } from '@/components/ui/Table';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { limpiarFiltrosBusqueda } from '@/lib/busqueda';
import { downloadBlob, formatDate } from '@/lib/utils';
import type { PaginatedResponse } from '@/types/common';
import type { Sentencia, SentenciaFilters as Filters } from '@/types/sentencia';

const defaultFilters: Filters = {
  page: 1,
  pageSize: 10,
  numeroSentencia: '',
  expediente: '',
  sala: '',
  tipoFallo: '',
  actor: '',
  demandado: '',
  publicado: '',
  activo: '',
  fechaDesde: '',
  fechaHasta: '',
};

function SentenciasContent({ initialFilters }: { initialFilters: Filters }) {
  const { user } = useAuth();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [result, setResult] = useState<PaginatedResponse<Sentencia> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = async (nextFilters = filters) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<PaginatedResponse<Sentencia>>('/sentencias', {
        query: limpiarFiltrosBusqueda(nextFilters),
      });
      setResult(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar las sentencias.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    const loadInitial = async () => {
      try {
        const response = await api.get<PaginatedResponse<Sentencia>>('/sentencias', {
          query: limpiarFiltrosBusqueda(initialFilters),
        });
        if (active) {
          setResult(response);
          setFilters(initialFilters);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar las sentencias.');
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
  }, [initialFilters]);

  const togglePublished = async (sentencia: Sentencia) => {
    await api.patch(`/sentencias/${sentencia.id}/${sentencia.publicado ? 'despublicar' : 'publicar'}`);
    setFeedback(sentencia.publicado ? 'Sentencia despublicada.' : 'Sentencia publicada.');
    await load();
  };

  const removeSentencia = async (sentencia: Sentencia) => {
    if (!window.confirm(`Desactivar sentencia ${sentencia.id}?`)) return;
    await api.delete(`/sentencias/${sentencia.id}`);
    setFeedback(`Se desactivo la sentencia #${sentencia.id}.`);
    await load();
  };

  const saveSearch = async () => {
    const nombre = window.prompt('Nombre para guardar esta busqueda');
    if (!nombre) return;

    await api.post('/busquedas-guardadas', {
      nombre,
      queryJson: filters,
    });
    setFeedback('Busqueda guardada correctamente.');
  };

  const exportResults = async (format: string) => {
    const blob = await api.download('/busqueda/avanzada/exportar', {
      query: limpiarFiltrosBusqueda({ ...filters, formato: format }),
    });
    downloadBlob(blob, `sentencias.${format}`);
  };

  const isAdmin = user?.rol.nombre === 'ADMIN';

  return (
    <div className={styles.section}>
      <PageHeader
        title="Sentencias"
        description="Listado principal, filtros, exportacion y acceso a herramientas de consulta."
        actions={
          <div className={styles.inlineActions}>
            <Link href="/sentencias"><Button variant="secondary">Listado</Button></Link>
            <Link href="/sentencias/carga-rapida"><Button variant="secondary">Carga rápida</Button></Link>
            <Link href="/sentencias/nueva-completa"><Button>Nueva completa</Button></Link>
            <Button variant="secondary" onClick={() => void saveSearch()}>Guardar búsqueda</Button>
            <ExportMenu onExport={exportResults} />
          </div>
        }
      />

      {feedback ? <StatusMessage variant="success" title="Operacion realizada" message={feedback} /> : null}

      <Card>
        <SentenciasFilters
          filters={filters}
          onChange={setFilters}
          onSubmit={() => void load(filters)}
          onClear={() => {
            setFilters(defaultFilters);
            void load(defaultFilters);
          }}
        />
      </Card>

      {error ? <StatusMessage variant="error" title="No se pudo cargar el listado" message={error} /> : null}

      {isLoading ? (
        <LoadingSpinner label="Cargando sentencias..." />
      ) : !result || result.data.length === 0 ? (
        <EmptyState title="No hay sentencias para mostrar" description="Prueba ajustando filtros o creando una sentencia nueva." />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Número</th>
                <th>Sala</th>
                <th>Tipo</th>
                <th>Fecha</th>
                <th>Expediente</th>
                <th>Actor</th>
                <th>Demandado</th>
                <th>Publicada</th>
                <th>Activa</th>
                <th>Destacada</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((sentencia) => (
                <tr key={sentencia.id}>
                  <td>{sentencia.id}</td>
                  <td>{sentencia.numeroSentencia ?? '-'}</td>
                  <td>{sentencia.sala ?? '-'}</td>
                  <td>{sentencia.tipoFallo ?? '-'}</td>
                  <td>{formatDate(sentencia.fecha)}</td>
                  <td>{sentencia.expediente ?? '-'}</td>
                  <td>{sentencia.actor ?? '-'}</td>
                  <td>{sentencia.demandado ?? '-'}</td>
                  <td>
                    <span className={`${styles.badge} ${sentencia.publicado ? styles.badgeSuccess : styles.badgeWarning}`}>
                      {sentencia.publicado ? 'Publicada' : 'Borrador'}
                    </span>
                  </td>
                  <td>
                    <span className={`${styles.badge} ${sentencia.activo ? styles.badgeSuccess : styles.badgeDanger}`}>
                      {sentencia.activo ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td>
                    <div className={styles.badgeRow}>
                      {sentencia.destacada ? <span className={styles.badge}>Destacada</span> : null}
                      {sentencia.anonimizado ? <span className={styles.badge}>Anonimizada</span> : null}
                    </div>
                  </td>
                  <td>
                    <div className={styles.inlineActions}>
                      <Link href={`/sentencias/${sentencia.id}`}><Button variant="secondary">Ver detalle</Button></Link>
                      <Link href={`/sentencias/${sentencia.id}/documento`}><Button variant="secondary">Ver documento</Button></Link>
                      <Button variant="secondary" onClick={() => void togglePublished(sentencia)}>
                        {sentencia.publicado ? 'Despublicar' : 'Publicar'}
                      </Button>
                      {isAdmin ? (
                        <Button variant="danger" onClick={() => void removeSentencia(sentencia)}>
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

export default function SentenciasPage() {
  const searchParams = useSearchParams();
  const initialFilters: Filters = {
    ...defaultFilters,
    numeroSentencia: searchParams.get('numeroSentencia') ?? '',
    expediente: searchParams.get('expediente') ?? '',
    sala: searchParams.get('sala') ?? '',
    tipoFallo: searchParams.get('tipoFallo') ?? '',
    actor: searchParams.get('actor') ?? '',
    demandado: searchParams.get('demandado') ?? '',
    publicado: searchParams.get('publicado') ?? '',
    activo: searchParams.get('activo') ?? '',
    fechaDesde: searchParams.get('fechaDesde') ?? '',
    fechaHasta: searchParams.get('fechaHasta') ?? '',
    page: Number(searchParams.get('page') ?? defaultFilters.page),
    pageSize: Number(searchParams.get('pageSize') ?? defaultFilters.pageSize),
  };

  return <SentenciasContent key={searchParams.toString()} initialFilters={initialFilters} />;
}

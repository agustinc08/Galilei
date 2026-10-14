'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import styles from '@/components/sentencias/sentencias.module.css';
import { SentenciasFilters } from '@/components/sentencias/SentenciasFilters';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { api } from '@/lib/api';
import { limpiarFiltrosBusqueda } from '@/lib/busqueda';
import { formatDate } from '@/lib/utils';
import { formatTipoFallo } from '@/lib/jurisprudencia-labels';
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
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [result, setResult] = useState<PaginatedResponse<Sentencia> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (nextFilters = filters) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<PaginatedResponse<Sentencia>>('/sentencias', {
        query: limpiarFiltrosBusqueda(nextFilters),
      });
      setResult(response);
    } catch {
      setError('No pudimos cargar los fallos. Intentá nuevamente.');
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
      } catch {
        if (active) {
          setError('No pudimos cargar los fallos. Intentá nuevamente.');
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

  const stateLabels: Record<string, string> = {
    BORRADOR: 'Borrador',
    PUBLICADA: 'Publicado',
    ARCHIVADA: 'Archivado',
    PENDIENTE_REVISION: 'Requiere revisión',
    REQUIERE_REVISION: 'Requiere revisión',
  };
  const statusHref = (values: Partial<Filters>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    return `/sentencias${params.size ? `?${params.toString()}` : ''}`;
  };

  return (
    <div className={`${styles.section} ${styles.manageSection}`}>
      <PageHeader
        title="Gestión de fallos"
        description="Buscá un fallo para revisar sus datos, publicación o archivo."
        actions={
          <div className={styles.inlineActions}>
            <Link href="/sentencias/nueva"><Button>+ Nuevo fallo</Button></Link>
          </div>
        }
      />

      <nav className={styles.workflowNav} aria-label="Estado de los fallos">
        <Link href={statusHref({})} aria-current={!filters.publicado && filters.activo !== 'false' ? 'page' : undefined}>Todos</Link>
        <Link href={statusHref({ publicado: 'false', activo: 'true' })} aria-current={filters.publicado === 'false' && filters.activo !== 'false' ? 'page' : undefined}>Borradores y no publicados</Link>
        <Link href={statusHref({ publicado: 'true', activo: 'true' })} aria-current={filters.publicado === 'true' ? 'page' : undefined}>Publicados</Link>
        <Link href={statusHref({ activo: 'false' })} aria-current={filters.activo === 'false' ? 'page' : undefined}>Archivados</Link>
      </nav>

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
        <EmptyState title="No encontramos fallos con esos criterios" description="Modificá los filtros o cargá un fallo nuevo." actionLabel="+ Nuevo fallo" actionHref="/sentencias/nueva" />
      ) : (
        <Card>
          <div className={styles.recordList}>
              {result.data.map((sentencia) => (
                <article className={styles.recordCard} key={sentencia.id}>
                  <div className={styles.recordHeading}>
                    <div>
                      <h2>{sentencia.caratula || sentencia.expediente || sentencia.numeroSentencia || `Fallo ${sentencia.id}`}</h2>
                      <p>{[
                        sentencia.sala ? (sentencia.sala.toLowerCase().startsWith('sala') ? sentencia.sala : `Sala ${sentencia.sala}`) : 'Sin Sala informada',
                        sentencia.fecha ? formatDate(sentencia.fecha) : null,
                        formatTipoFallo(sentencia.tipoFallo),
                        sentencia.expediente ? `Expte. ${sentencia.expediente}` : null,
                        sentencia.numeroSentencia ? `Sentencia ${sentencia.numeroSentencia}` : null,
                      ].filter(Boolean).join(' · ')}</p>
                      {(sentencia.actor || sentencia.demandado) ? <p>{[sentencia.actor, sentencia.demandado].filter(Boolean).join(' c/ ')}</p> : null}
                    </div>
                    <div className={styles.badgeRow}>
                      <span className={`${styles.badge} ${sentencia.publicado ? styles.badgeSuccess : styles.badgeWarning}`}>
                        {stateLabels[sentencia.estadoCarga ?? ''] ?? (sentencia.publicado ? 'Publicado' : 'No publicado')}
                      </span>
                      {!sentencia.activo ? <span className={`${styles.badge} ${styles.badgeDanger}`}>Archivado</span> : null}
                      {sentencia.destacada ? <span className={styles.badge}>Destacado</span> : null}
                      {sentencia.anonimizado ? <span className={styles.badge}>Datos personales protegidos</span> : null}
                    </div>
                  </div>
                  {sentencia.magistrados ? <p className={styles.recordMeta}><strong>Magistrados:</strong> {sentencia.magistrados}</p> : null}
                  <div className={styles.recordActions}>
                    <Link href={`/sentencias/${sentencia.id}`}><Button variant="secondary">Editar fallo</Button></Link>
                    {sentencia.tienePdf || sentencia._count?.archivosPdf ? <Link href={`/sentencias/${sentencia.id}/documento`}><Button variant="ghost">Ver documento</Button></Link> : null}
                  </div>
                </article>
              ))}
          </div>
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

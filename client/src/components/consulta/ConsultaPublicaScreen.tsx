'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import styles from './consulta.module.css';
import { ConsultaPaginacion } from './ConsultaPaginacion';
import { SelectedResultsBar } from './SelectedResultsBar';
import { BusquedaJurisprudenciaForm } from '@/components/busqueda/BusquedaJurisprudenciaForm';
import { ResultadosJurisprudencia } from '@/components/busqueda/ResultadosJurisprudencia';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Select } from '@/components/ui/Select';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useAuth } from '@/hooks/use-auth';
import { useCatalogos } from '@/hooks/use-catalogos';
import { api } from '@/lib/api';
import { limpiarFiltrosBusqueda } from '@/lib/busqueda';
import { trackEvento } from '@/lib/tracking';
import type { PaginatedResponse } from '@/types/common';
import type {
  ConsultaPublicaFilters,
  ConsultaPublicaResultado,
} from '@/types/busqueda';

const PRINT_STORAGE_KEY = 'consulta-print-payload';

function buildQueryString(values: ConsultaPublicaFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

function ConsultaPublicaScreenContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const {
    salas: catalogoSalas,
    tiposFallo: catalogoTiposFallo,
    tribunalesOrigen: catalogoTribunalesOrigen,
  } = useCatalogos(true);
  const [result, setResult] =
    useState<PaginatedResponse<ConsultaPublicaResultado> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfMessage, setPdfMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [temas, setTemas] = useState<string[]>([]);
  const [recentlyPublished, setRecentlyPublished] = useState<Array<{ id: number; slugPublico: string | null; caratula: string | null; expediente: string | null; sala: string | null; fecha: string | null; publishedAt: string | null }>>([]);

  const filters = useMemo<ConsultaPublicaFilters>(
    () => ({
      q: searchParams.get('q') ?? '',
      fraseExacta: searchParams.get('fraseExacta') ?? '',
      excluir: searchParams.get('excluir') ?? '',
      operador: (searchParams.get('operador') as ConsultaPublicaFilters['operador']) ?? 'AND',
      tema: searchParams.get('tema') ?? '',
      sala: searchParams.get('sala') ?? '',
      fechaDesde: searchParams.get('fechaDesde') ?? '',
      fechaHasta: searchParams.get('fechaHasta') ?? '',
      tipoFallo: searchParams.get('tipoFallo') ?? '',
      tribunalOrigen: searchParams.get('tribunalOrigen') ?? '',
      numeroSumario: searchParams.get('numeroSumario') ?? '',
      numeroSentencia: searchParams.get('numeroSentencia') ?? '',
      magistrados: searchParams.get('magistrados') ?? '',
      caratula: searchParams.get('caratula') ?? '',
      expediente: searchParams.get('expediente') ?? '',
      actor: searchParams.get('actor') ?? '',
      demandado: searchParams.get('demandado') ?? '',
      objeto: searchParams.get('objeto') ?? '',
      anio: searchParams.get('anio') ?? '',
      soloConPdf: searchParams.get('soloConPdf') ?? '',
      pdf: (searchParams.get('pdf') as ConsultaPublicaFilters['pdf']) ?? '',
      buscarEn: searchParams.get('buscarEn') ?? 'todo',
      sortBy: searchParams.get('sortBy') ?? '',
      sortOrder: searchParams.get('sortOrder') ?? '',
      page: Number(searchParams.get('page') ?? '1'),
      pageSize: Number(searchParams.get('pageSize') ?? '25'),
    }),
    [searchParams],
  );

  useEffect(() => {
    let active = true;

    const loadLists = async () => {
      try {
        const [temasResponse] = await Promise.all([
          api.get<{ data: string[] }>('/public/busqueda/temas', { skipAuth: true }),
        ]);

        if (!active) return;
        setTemas(temasResponse.data);
      } catch {
        if (!active) return;
      }
    };

    void loadLists();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void api.get<{ data: typeof recentlyPublished }>('/public/sentencias/recientes', { skipAuth: true })
      .then((response) => { if (active) setRecentlyPublished(response.data); })
      .catch(() => { if (active) setRecentlyPublished([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await api.get<PaginatedResponse<ConsultaPublicaResultado>>(
          '/public/busqueda',
          {
            skipAuth: true,
            query: limpiarFiltrosBusqueda(filters),
          },
        );

        if (!active) return;
        setResult(response);
      } catch {
        if (!active) return;
        setError('No pudimos completar la búsqueda. Intentá nuevamente.');
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [filters]);

  const currentData = result?.data ?? [];
  const selectedItems = currentData.filter((item) => selectedIds.includes(item.id));
  const activeFilters = ([
    { key: 'q', label: 'Búsqueda', value: filters.q ?? '' },
    { key: 'tema', label: 'Tema', value: filters.tema ?? '' },
    { key: 'sala', label: 'Sala', value: filters.sala ? (filters.sala.toLowerCase().startsWith('sala') ? filters.sala : `Sala ${filters.sala}`) : '' },
    { key: 'fechaDesde', label: 'Desde', value: filters.fechaDesde ? new Date(`${filters.fechaDesde}T12:00:00`).toLocaleDateString('es-AR') : '' },
    { key: 'fechaHasta', label: 'Hasta', value: filters.fechaHasta ? new Date(`${filters.fechaHasta}T12:00:00`).toLocaleDateString('es-AR') : '' },
    { key: 'tipoFallo', label: 'Tipo', value: filters.tipoFallo ?? '' },
    { key: 'expediente', label: 'Expediente', value: filters.expediente ?? '' },
    { key: 'numeroSumario', label: 'Nº sumario', value: filters.numeroSumario ?? '' },
    { key: 'numeroSentencia', label: 'Sentencia', value: filters.numeroSentencia ?? '' },
    { key: 'magistrados', label: 'Magistrados', value: filters.magistrados ?? '' },
    { key: 'caratula', label: 'Carátula', value: filters.caratula ?? '' },
    { key: 'tribunalOrigen', label: 'Tribunal', value: filters.tribunalOrigen ?? '' },
    { key: 'actor', label: 'Actor', value: filters.actor ?? '' },
    { key: 'demandado', label: 'Demandado', value: filters.demandado ?? '' },
    { key: 'objeto', label: 'Objeto', value: filters.objeto ?? '' },
    { key: 'anio', label: 'Año', value: filters.anio ?? '' },
    { key: 'fraseExacta', label: 'Frase exacta', value: filters.fraseExacta ?? '' },
    { key: 'excluir', label: 'Excluir', value: filters.excluir ?? '' },
    { key: 'pdf', label: 'PDF', value: filters.pdf === 'conPdf' ? 'Con PDF' : filters.pdf === 'sinPdf' ? 'Sin PDF' : '' },
  ] satisfies Array<{ key: keyof ConsultaPublicaFilters; label: string; value: string }>).filter((item) => Boolean(item.value));

  const updateRoute = (next: ConsultaPublicaFilters) => {
    const queryString = buildQueryString(next);
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
  };

  const handleSearch = (nextValues: ConsultaPublicaFilters) => {
    const pdf = nextValues.pdf || (nextValues.soloConPdf === 'true' ? 'conPdf' : 'todos');
    const sala = nextValues.sala?.trim().replace(/^sala\s+/iu, '') ?? '';
    updateRoute({
      ...nextValues,
      sala,
      pdf,
      soloConPdf: '',
      page: 1,
      pageSize: nextValues.pageSize ?? 25,
      sortBy: nextValues.sortBy || (nextValues.q ? 'relevancia' : 'fecha'),
      sortOrder: nextValues.sortOrder || 'desc',
    });
  };

  const handlePageChange = (page: number) => {
    updateRoute({ ...filters, page });
  };

  const handlePageSizeChange = (pageSize: number) => {
    updateRoute({ ...filters, page: 1, pageSize });
  };

  const handleClear = () => {
    setSelectedIds([]);
    updateRoute({});
  };

  const handleToggleSelected = (id: number) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const handlePrint = () => {
    const payload = selectedItems.length > 0 ? selectedItems : currentData;
    if (payload.length === 0) {
      setPdfMessage('No hay resultados para imprimir.');
      return;
    }

    localStorage.setItem(PRINT_STORAGE_KEY, JSON.stringify(payload));
    void trackEvento({
      tipoEvento: 'print_result',
      metadata: {
        origen: 'consulta',
        cantidadResultados: payload.length,
        query: filters.q ?? '',
      },
    });
    window.open('/consulta/imprimir', '_blank', 'noopener');
  };

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>Jurisprudencia</h1>
        <p className={styles.heroSubtitle}>
          Buscar fallos institucionales publicados · Cámara Nacional de Apelaciones en lo Civil
        </p>
        {user && ['ADMIN', 'OPERADOR', 'JURISPRUDENCIA', 'REVISOR'].includes(user.rol.nombre) ? (
          <div className={styles.publicHeader}>
            {['ADMIN', 'OPERADOR', 'JURISPRUDENCIA'].includes(user.rol.nombre) ? (
              <>
                <Link href="/sentencias"><Button variant="secondary">Gestión y borradores</Button></Link>
                <Link href="/sentencias/nueva"><Button>+ Nuevo fallo</Button></Link>
              </>
            ) : null}
            <Link href="/revision"><Button variant="secondary">Requieren revisión</Button></Link>
          </div>
        ) : null}
      </section>

      <BusquedaJurisprudenciaForm
        key={buildQueryString(filters)}
        modo="publico"
        valoresIniciales={filters}
        temas={temas}
        salas={catalogoSalas.map((item) => item.nombre)}
        tiposFallo={catalogoTiposFallo.map((item) => item.nombre)}
        tribunalesOrigen={catalogoTribunalesOrigen.map((item) => item.nombre)}
        onBuscar={(values) => handleSearch(values)}
        onLimpiar={handleClear}
        onImprimir={handlePrint}
        mostrarExportar={false}
        mostrarGuardarBusqueda={false}
        mostrarFiltrosInternos={false}
      />

      {recentlyPublished.length ? (
        <Card>
          <details className={styles.latestDetails}>
            <summary>Últimos fallos publicados <span>({recentlyPublished.length})</span></summary>
            <ul className={styles.latestList}>
            {recentlyPublished.slice(0, 4).map((item) => (
              <li key={item.id}>
                {item.slugPublico ? <Link href={`/fallos/${item.slugPublico}`}>{item.caratula || item.expediente || 'Fallo publicado'}</Link> : <strong>{item.caratula || item.expediente || 'Fallo publicado'}</strong>}
                <span> · {item.sala || 'Sin Sala informada'} · {item.fecha ? new Date(item.fecha).toLocaleDateString('es-AR') : 'Fecha no informada'}</span>
              </li>
            ))}
            </ul>
          </details>
        </Card>
      ) : null}

      {activeFilters.length ? (
        <div className={styles.activeFilters} aria-label="Filtros activos">
          <span className={styles.activeFiltersLabel}>Buscando con:</span>
          {activeFilters.map((filter) => (
            <span className={styles.filterChip} key={filter.key}>
              <span><strong>{filter.label}:</strong> {filter.value}</span>
              <button
                type="button"
                aria-label={`Quitar filtro ${filter.label}`}
                onClick={() => updateRoute({ ...filters, [filter.key]: '', page: 1 })}
              >×</button>
            </span>
          ))}
          <Button variant="ghost" onClick={handleClear}>Limpiar filtros</Button>
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <strong>
            {isLoading
              ? 'Buscando…'
              : result
                ? `${result.meta.total.toLocaleString('es-AR')} ${result.meta.total === 1 ? 'resultado' : 'resultados'}`
              : 'Consulta pública de sumarios y fallos publicados'}
          </strong>
        </div>
        <div className={styles.toolbarRight}>
          <Select
            label="Orden"
            value={`${filters.sortBy || (filters.q ? 'relevancia' : 'fecha')}:${filters.sortOrder || 'desc'}`}
            onChange={(event) => {
              const [sortBy, sortOrder] = event.target.value.split(':');
              const next = { ...filters, sortBy, sortOrder, page: 1 };
              updateRoute(next);
            }}
            options={[
              { label: 'Relevancia', value: 'relevancia:desc' },
              { label: 'Fecha más reciente', value: 'fecha:desc' },
              { label: 'Fecha más antigua', value: 'fecha:asc' },
              { label: 'Sala', value: 'sala:asc' },
              { label: 'N° sentencia', value: 'numeroSentencia:asc' },
            ]}
          />
        </div>
      </div>

      <p className={styles.scopeNote}>La búsqueda incluye fallos y sumarios publicados.</p>

      {pdfMessage ? (
        <StatusMessage
          variant="error"
          title="PDF no disponible"
          message={pdfMessage}
        />
      ) : null}

      {isLoading ? (
        <LoadingSpinner label="Buscando fallos…" />
      ) : error ? (
        <StatusMessage
          variant="error"
          title="No se pudo completar la consulta"
          message={error}
        />
      ) : !result ? (
        <div className={styles.emptyState} role="status"><strong>No hay resultados para mostrar.</strong></div>
      ) : result.data.length === 0 ? (
        <div className={styles.emptyState} role="status">
          <strong>No encontramos fallos con estos criterios.</strong>
          <span>Modificá la búsqueda o quitá los filtros para probar de nuevo.</span>
          <div className={styles.emptyActions}>
            <Button variant="secondary" onClick={handleClear}>Limpiar filtros</Button>
          </div>
        </div>
      ) : (
        <>
          <ResultadosJurisprudencia
            modo="publico"
            data={result.data}
            selectedIds={selectedIds}
            onToggle={handleToggleSelected}
            onMissingPdf={() =>
              setPdfMessage('El fallo seleccionado no tiene PDF público disponible.')
            }
            query={filters.q}
          />
          <Card>
            <ConsultaPaginacion
              page={result.meta.page}
              pageCount={result.meta.pageCount}
              total={result.meta.total}
              pageSize={result.meta.pageSize}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          </Card>
        </>
      )}

      <SelectedResultsBar
        selectedCount={selectedIds.length}
        onPrint={handlePrint}
        onClear={() => setSelectedIds([])}
      />
    </main>
  );
}

export function ConsultaPublicaScreen() {
  return (
    <Suspense fallback={<LoadingSpinner label="Cargando consulta pública..." />}>
      <ConsultaPublicaScreenContent />
    </Suspense>
  );
}

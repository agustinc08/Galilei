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
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Select } from '@/components/ui/Select';
import { SuggestionTag } from '@/components/ui/SuggestionTag';
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
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'No se pudo ejecutar la consulta pública.',
        );
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

  const updateRoute = (next: ConsultaPublicaFilters) => {
    const queryString = buildQueryString(next);
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
  };

  const handleSearch = (nextValues: ConsultaPublicaFilters) => {
    const pdf = nextValues.pdf || (nextValues.soloConPdf === 'true' ? 'conPdf' : 'todos');
    updateRoute({
      ...nextValues,
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
        {user ? (
          <div className={styles.publicHeader}>
            <span />
            <Link href="/dashboard">
              <Button variant="secondary">Volver al panel</Button>
            </Link>
          </div>
        ) : null}
        <div className={styles.heroKicker}>Consulta pública de jurisprudencia</div>
        <h1 className={styles.heroTitle}>Sistema Web de Consulta de Jurisprudencia</h1>
        <p className={styles.heroSubtitle}>
          Cámara Nacional de Apelaciones en lo Civil. Búsqueda por texto libre,
          sala, fecha, tribunal, tipo de fallo, tema, magistrados y expediente.
        </p>
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

      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <strong>
            {result
              ? `${result.meta.total} resultados`
              : 'Consulta pública de sumarios y fallos publicados'}
          </strong>
          {result?.meta.sortUsed ? <span>Orden aplicado: {result.meta.sortUsed}</span> : null}
          {result?.meta.tiempoMs !== undefined ? <span>{result.meta.tiempoMs} ms</span> : null}
          {result?.meta.expandedTerms?.length ? (
            <span>
              También se buscó por:{' '}
              {result.meta.expandedTerms.map((term) => (
                <SuggestionTag key={term} label={term} />
              ))}
            </span>
          ) : null}
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
              { label: 'Fecha desc', value: 'fecha:desc' },
              { label: 'Fecha asc', value: 'fecha:asc' },
              { label: 'Sala', value: 'sala:asc' },
              { label: 'N° sentencia', value: 'numeroSentencia:asc' },
            ]}
          />
        </div>
      </div>

      <Card>
        <p>
          La consulta pública muestra solo fallos y sumarios publicados. El buscador
          admite palabras parciales, tildes, Ñ, frases entre comillas y términos
          excluidos anteponiendo `-`.
        </p>
      </Card>

      {pdfMessage ? (
        <StatusMessage
          variant="error"
          title="PDF no disponible"
          message={pdfMessage}
        />
      ) : null}

      {result && result.meta.total > 300 ? (
        <div className={styles.alert}>
          La búsqueda arroja demasiados resultados. Se muestran los primeros{' '}
          {result.meta.pageSize} sumarios. Si lo desea, refine la búsqueda utilizando
          intervalos de fecha.
        </div>
      ) : null}

      {isLoading ? (
        <LoadingSpinner label="Consultando sumarios publicados..." />
      ) : error ? (
        <StatusMessage
          variant="error"
          title="No se pudo completar la consulta"
          message={error}
        />
      ) : !result ? (
        <EmptyState title="Sin datos" description="No se pudo cargar la consulta." />
      ) : result.data.length === 0 ? (
        <EmptyState
          title="Sin resultados"
          description="Intenta usar menos filtros o términos más generales."
        />
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

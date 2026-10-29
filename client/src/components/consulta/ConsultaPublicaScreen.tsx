'use client';

import { Link } from "@/lib/router-compat";
import { Suspense, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from '@/lib/router-compat';
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
import { SavePublicSearchDialog } from './SavePublicSearchDialog';
import { useAuth } from '@/hooks/use-auth';
import { useCatalogos } from '@/hooks/use-catalogos';
import { api } from '@/lib/api';
import { limpiarFiltrosBusqueda } from '@/lib/busqueda';
import { trackEvento } from '@/lib/tracking';
import { canonicalPublicSearchPath, publicSearchStateFromUrl } from '@/lib/research-continuity';
import { copyToClipboard } from '@/lib/utils';
import type { PaginatedResponse } from '@/types/common';
import type {
  ConsultaPublicaFilters,
  ConsultaPublicaResultado,
} from '@/types/busqueda';

const PRINT_STORAGE_KEY = 'consulta-print-payload';

function buildQueryString(values: ConsultaPublicaFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of [...new Set(value.map((entry) => entry.trim()).filter(Boolean))]) {
        params.append(key, item);
      }
      continue;
    }
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

function filtersFromSearchParams(searchParams: URLSearchParams): ConsultaPublicaFilters {
  return {
    q: searchParams.get('q') ?? '',
    fraseExacta: searchParams.get('fraseExacta') ?? '',
    excluir: searchParams.get('excluir') ?? '',
    operador: (searchParams.get('operador') as ConsultaPublicaFilters['operador']) ?? 'AND',
    tema: searchParams.get('tema') ?? '',
    sala: searchParams.getAll('salas').length ? '' : (searchParams.get('sala') ?? ''),
    salas: [...new Set(searchParams.getAll('salas').map((value) => value.trim()).filter(Boolean))],
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
  };
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
  const [showResultFacets, setShowResultFacets] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfMessage, setPdfMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [temas, setTemas] = useState<string[]>([]);
  const [recentlyPublished, setRecentlyPublished] = useState<Array<{ id: number; slugPublico: string | null; caratula: string | null; expediente: string | null; sala: string | null; fecha: string | null; publishedAt: string | null }>>([]);
  const [latestByDecisionDate, setLatestByDecisionDate] = useState<Array<{ id: number; slugPublico: string | null; caratula: string | null; expediente: string | null; sala: string | null; fecha: string | null; numeroSentencia: string | null }>>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(() => new Set());
  const [favoriteOwnerId, setFavoriteOwnerId] = useState<number | null>(null);
  const [favoritePendingIds, setFavoritePendingIds] = useState<Set<number>>(() => new Set());
  const [favoriteMessage, setFavoriteMessage] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [copySearchMessage, setCopySearchMessage] = useState<string | null>(null);
  const [queryExplanation, setQueryExplanation] = useState<{
    summary: string;
    notes: string;
    q: string;
    operador?: string;
  } | null>(null);
  const canManagePersonalResearch = ['ADMIN', 'OPERADOR'].includes(user?.rol.nombre ?? '');

  const filters = useMemo<ConsultaPublicaFilters>(
    () => filtersFromSearchParams(new URLSearchParams(searchParams.toString())),
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
    void api.get<{ data: typeof latestByDecisionDate }>('/public/sentencias/mas-recientes', { skipAuth: true })
      .then((response) => { if (active) setLatestByDecisionDate(response.data); })
      .catch(() => { if (active) setLatestByDecisionDate([]); });
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

  useEffect(() => {
    let active = true;
    const queryText = filters.q;
    if (!queryText?.trim()) {
      return () => { active = false; };
    }
    void api.get<{ data: { summary: string; notes: string } }>(
      '/public/busqueda/interpretacion',
      { skipAuth: true, query: { q: queryText, operador: filters.operador } },
    ).then((response) => {
      if (active) setQueryExplanation({ ...response.data, q: queryText, operador: filters.operador });
    }).catch(() => {
      if (active) setQueryExplanation(null);
    });
    return () => { active = false; };
  }, [filters.q, filters.operador]);

  useEffect(() => {
    let active = true;
    if (!canManagePersonalResearch) {
      return () => { active = false; };
    }
    void api.get<{ data: Array<{ sentenciaId: number }> }>('/favoritos')
      .then((response) => {
        if (active) {
          setFavoriteIds(new Set(response.data.map((item) => item.sentenciaId)));
          setFavoriteOwnerId(user?.id ?? null);
          setFavoriteMessage(null);
        }
      })
      .catch(() => {
        if (active) setFavoriteMessage('No pudimos cargar tus favoritos. Podés volver a intentarlo más tarde.');
      });
    return () => { active = false; };
  }, [canManagePersonalResearch, user?.id]);

  const currentData = result?.data ?? [];
  const selectedItems = currentData.filter((item) => selectedIds.includes(item.id));
  const selectedSalaFacet = (values: string[]) => {
    const selected = [...new Set(filters.salas ?? [])].sort();
    const candidate = [...new Set(values)].sort();
    return selected.length === candidate.length && selected.every((value, index) => value === candidate[index]);
  };
  const salaFilterLabel = filters.salas?.length
    ? result?.meta.facets?.salas.find((facet) => selectedSalaFacet(facet.filterValues))?.value ?? filters.salas.join(' / ')
    : filters.sala
      ? (filters.sala.toLowerCase().startsWith('sala') ? filters.sala : `Sala ${filters.sala}`)
      : '';
  const activeFilters = ([
    { key: 'q', label: 'Búsqueda', value: filters.q ?? '' },
    { key: 'tema', label: 'Tema', value: filters.tema ?? '' },
    { key: 'sala', label: 'Sala', value: salaFilterLabel },
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
  const currentQueryExplanation = queryExplanation && queryExplanation.q === filters.q &&
    queryExplanation.operador === filters.operador
    ? queryExplanation
    : null;

  const updateRoute = (update: (current: ConsultaPublicaFilters) => ConsultaPublicaFilters) => {
    const current = filtersFromSearchParams(new URLSearchParams(window.location.search));
    const next = update(current);
    const queryString = buildQueryString(next);
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
  };

  const handleSearch = (nextValues: ConsultaPublicaFilters) => {
    const pdf = nextValues.pdf || (nextValues.soloConPdf === 'true' ? 'conPdf' : 'todos');
    const salaValue = nextValues.sala?.trim() ?? '';
    const sala = salaValue
      ? `Sala ${salaValue.replace(/^sala(?:\s+|$)/iu, '').trim()}`.trim()
      : '';
    updateRoute(() => ({
      ...nextValues,
      sala,
      salas: [],
      pdf,
      soloConPdf: '',
      page: 1,
      pageSize: nextValues.pageSize ?? 25,
      sortBy: nextValues.sortBy || (nextValues.q ? 'relevancia' : 'fecha'),
      sortOrder: nextValues.sortOrder || 'desc',
    }));
  };

  const handlePageChange = (page: number) => {
    updateRoute((current) => ({ ...current, page }));
  };

  const handlePageSizeChange = (pageSize: number) => {
    updateRoute((current) => ({ ...current, page: 1, pageSize }));
  };

  const handleCopySearchLink = async () => {
    const path = canonicalPublicSearchPath(new URLSearchParams(searchParams.toString()));
    const copied = await copyToClipboard(`${window.location.origin}${path}`);
    setCopySearchMessage(copied ? 'Enlace de búsqueda copiado.' : 'El navegador no permitió copiar el enlace.');
  };

  const handleSaveSearch = async (name: string) => {
    if (!canManagePersonalResearch) return;
    setSavingSearch(true);
    setSaveMessage(null);
    try {
      await api.post('/busquedas-guardadas', {
        nombre: name,
        queryJson: {
          kind: 'consulta-publica',
          version: 1,
          state: publicSearchStateFromUrl(new URLSearchParams(searchParams.toString())),
        },
      });
      setSaveDialogOpen(false);
      setSaveMessage({ variant: 'success', text: 'Búsqueda guardada en tu cuenta.' });
    } catch {
      setSaveMessage({ variant: 'error', text: 'No se pudo guardar la búsqueda. No se guardaron resultados ni documentos.' });
    } finally {
      setSavingSearch(false);
    }
  };

  const handleToggleFavorite = async (sentenciaId: number) => {
    if (
      !canManagePersonalResearch ||
      favoriteOwnerId !== user?.id ||
      favoritePendingIds.has(sentenciaId)
    ) return;
    const ownerId = user.id;
    const wasFavorite = favoriteIds.has(sentenciaId);
    setFavoritePendingIds((current) => new Set(current).add(sentenciaId));
    setFavoriteIds((current) => {
      const next = new Set(favoriteOwnerId === ownerId ? current : []);
      if (wasFavorite) next.delete(sentenciaId);
      else next.add(sentenciaId);
      return next;
    });
    setFavoriteOwnerId(ownerId);
    setFavoriteMessage(null);
    try {
      if (wasFavorite) await api.delete(`/favoritos/${sentenciaId}`);
      else await api.post(`/favoritos/${sentenciaId}`);
    } catch {
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (wasFavorite) next.add(sentenciaId);
        else next.delete(sentenciaId);
        return next;
      });
      setFavoriteMessage(wasFavorite
        ? 'No se pudo quitar el favorito; se restauró su estado.'
        : 'No se pudo guardar el favorito; se restauró su estado.');
    } finally {
      setFavoritePendingIds((current) => {
        const next = new Set(current);
        next.delete(sentenciaId);
        return next;
      });
    }
  };

  const handleClear = () => {
    setSelectedIds([]);
    updateRoute(() => ({}));
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
            <div className={styles.desktopManagementActions}>
              {['ADMIN', 'OPERADOR', 'JURISPRUDENCIA'].includes(user.rol.nombre) ? (
                <>
                  <Link href="/sentencias"><Button variant="secondary">Gestión y borradores</Button></Link>
                  <Link href="/sentencias/nueva"><Button>+ Nuevo fallo</Button></Link>
                </>
              ) : null}
              <Link href="/revision"><Button variant="secondary">Requieren revisión</Button></Link>
            </div>
            <details className={styles.mobileManagementActions}>
              <summary>Acciones de gestión</summary>
              <div>
                {['ADMIN', 'OPERADOR', 'JURISPRUDENCIA'].includes(user.rol.nombre) ? (
                  <>
                    <Link href="/sentencias"><Button variant="secondary">Gestión y borradores</Button></Link>
                    <Link href="/sentencias/nueva"><Button>+ Nuevo fallo</Button></Link>
                  </>
                ) : null}
                <Link href="/revision"><Button variant="secondary">Requieren revisión</Button></Link>
              </div>
            </details>
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
        onGuardarBusqueda={() => setSaveDialogOpen(true)}
        mostrarExportar={false}
        mostrarGuardarBusqueda={canManagePersonalResearch}
        mostrarFiltrosInternos={false}
      />

      {activeFilters.length ? (
        <div className={styles.activeFilters} aria-label="Filtros activos">
          <span className={styles.activeFiltersLabel}>Buscando con:</span>
          {activeFilters.map((filter) => (
            <span className={styles.filterChip} key={filter.key}>
              <span><strong>{filter.label}:</strong> {filter.value}</span>
              <button
                type="button"
                aria-label={`Quitar filtro ${filter.label}`}
                onClick={() => updateRoute((current) => ({ ...current, [filter.key]: '', ...(filter.key === 'sala' ? { salas: [] } : {}), page: 1 }))}
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
          <Button aria-label="Copiar enlace de búsqueda" className={styles.copySearchLink} variant="secondary" onClick={() => void handleCopySearchLink()}>Copiar enlace</Button>
          <Select
            label="Orden"
            value={`${filters.sortBy || (filters.q ? 'relevancia' : 'fecha')}:${filters.sortOrder || 'desc'}`}
            onChange={(event) => {
              const [sortBy, sortOrder] = event.target.value.split(':');
              updateRoute((current) => ({ ...current, sortBy, sortOrder, page: 1 }));
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

      {result && result.data.length > 0 && result.meta.facets ? (
        <Card className={styles.facetCard}>
          <section aria-labelledby="search-facets-heading" className={styles.facetSection}>
            <div className={styles.facetHeader}>
              <div>
                <h2 id="search-facets-heading">Filtrar estos resultados</h2>
                {showResultFacets ? <p>Los conteos corresponden a la consulta y a los filtros activos.</p> : null}
              </div>
              <Button type="button" variant="secondary" aria-expanded={showResultFacets} aria-controls="search-result-facets" onClick={() => setShowResultFacets((current) => !current)}>
                {showResultFacets ? 'Ocultar filtros' : 'Mostrar filtros'} · {result.meta.facets.salas.length + result.meta.facets.years.length}
              </Button>
            </div>
            <div id="search-result-facets" className={styles.facetBody} hidden={!showResultFacets}>
              {result.meta.facets.salas.length ? (
                <div>
                  <h3>Salas</h3>
                  <div className={styles.facetList}>
                    {result.meta.facets.salas.map((facet) => (
                      <Button key={facet.value} variant={selectedSalaFacet(facet.filterValues) ? 'primary' : 'secondary'} onClick={() => { setShowResultFacets(true); updateRoute((current) => ({ ...current, sala: '', salas: selectedSalaFacet(facet.filterValues) ? [] : facet.filterValues, page: 1 })); }}>
                        {facet.value} ({facet.count.toLocaleString('es-AR')})
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              {result.meta.facets.years.length ? (
                <div>
                  <h3>Años de decisión</h3>
                  <div className={styles.facetList}>
                    {result.meta.facets.years.map((facet) => (
                      <Button key={facet.value} variant={filters.anio === String(facet.value) ? 'primary' : 'secondary'} onClick={() => { setShowResultFacets(true); updateRoute((current) => ({ ...current, anio: current.anio === String(facet.value) ? '' : String(facet.value), page: 1 })); }}>
                        {facet.value} ({facet.count.toLocaleString('es-AR')})
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </Card>
      ) : null}

      {copySearchMessage ? <div role="status">{copySearchMessage}</div> : null}
      {saveMessage ? <StatusMessage variant={saveMessage.variant} title={saveMessage.variant === 'success' ? 'Búsqueda guardada' : 'No se pudo guardar'} message={saveMessage.text} /> : null}
      {favoriteMessage ? <StatusMessage variant="error" title="Favoritos" message={favoriteMessage} /> : null}

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
            canFavorite={canManagePersonalResearch}
            canAddToCollection={Boolean(user)}
            favoriteIds={favoriteOwnerId === user?.id ? favoriteIds : new Set<number>()}
            favoriteReady={favoriteOwnerId === user?.id}
            favoritePendingIds={favoritePendingIds}
            onToggleFavorite={handleToggleFavorite}
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

      {recentlyPublished.length || latestByDecisionDate.length ? (
        <Card>
          <div className={styles.recentList}>
            {recentlyPublished.length ? (
              <details className={styles.latestDetails}>
                <summary>Fallos incorporados recientemente <span>({recentlyPublished.length})</span></summary>
                <ul className={styles.latestList}>
                  {recentlyPublished.slice(0, 4).map((item) => (
                    <li key={item.id}>
                      {item.slugPublico ? <Link href={`/fallos/${item.slugPublico}`}>{item.caratula || item.expediente || 'Fallo publicado'}</Link> : <strong>{item.caratula || item.expediente || 'Fallo publicado'}</strong>}
                      <span> · {item.sala || 'Sin Sala informada'} · {item.fecha ? new Date(item.fecha).toLocaleDateString('es-AR') : 'Fecha no informada'}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {latestByDecisionDate.length ? (
              <details className={styles.latestDetails}>
                <summary>Fallos más recientes por fecha de decisión <span>({latestByDecisionDate.length})</span></summary>
                <p>Ordenados por la fecha del fallo, no por la fecha en que se incorporó al sistema.</p>
                <ul className={styles.latestList}>
                  {latestByDecisionDate.slice(0, 4).map((item) => (
                    <li key={item.id}>
                      {item.slugPublico ? <Link href={`/fallos/${item.slugPublico}`}>{item.caratula || item.expediente || 'Fallo publicado'}</Link> : <strong>{item.caratula || item.expediente || 'Fallo publicado'}</strong>}
                      <span> · {item.sala || 'Sin Sala informada'} · {item.fecha ? new Date(item.fecha).toLocaleDateString('es-AR') : 'Fecha no informada'}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </Card>
      ) : null}

      <p className={styles.scopeNote}>La búsqueda incluye fallos y sumarios publicados.</p>
      {currentQueryExplanation ? (
        <details className={styles.latestDetails}>
          <summary>Cómo se interpreta esta búsqueda</summary>
          <p>{currentQueryExplanation.summary}</p>
          <p>{currentQueryExplanation.notes}</p>
        </details>
      ) : null}
      {!filters.q?.trim() ? (
        <details className={styles.latestDetails}>
          <summary>Cómo se interpreta esta búsqueda</summary>
          <p>No hay texto libre; la consulta se limita a los filtros seleccionados.</p>
          <p>Se ignoran mayúsculas y se toleran tildes. La ñ se mantiene distinta de la n.</p>
        </details>
      ) : null}

      <SelectedResultsBar
        selectedCount={selectedIds.length}
        onPrint={handlePrint}
        onClear={() => setSelectedIds([])}
      />
      <SavePublicSearchDialog
        key={saveDialogOpen ? 'save-dialog-open' : 'save-dialog-closed'}
        open={saveDialogOpen}
        saving={savingSearch}
        onClose={() => setSaveDialogOpen(false)}
        onSave={handleSaveSearch}
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

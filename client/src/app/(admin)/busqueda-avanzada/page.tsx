'use client';

import { useEffect, useState } from 'react';
import styles from '@/components/sentencias/sentencias.module.css';
import { BusquedaJurisprudenciaForm } from '@/components/busqueda/BusquedaJurisprudenciaForm';
import { ResultadosJurisprudencia } from '@/components/busqueda/ResultadosJurisprudencia';
import { Card } from '@/components/ui/Card';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { SuggestionTag } from '@/components/ui/SuggestionTag';
import { useCatalogos } from '@/hooks/use-catalogos';
import { api } from '@/lib/api';
import { limpiarFiltrosBusqueda } from '@/lib/busqueda';
import { trackEvento } from '@/lib/tracking';
import { downloadBlob } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import Link from 'next/link';
import type { PaginatedResponse } from '@/types/common';
import type { BusquedaAvanzadaFilters, BusquedaResultado, FederatedSearchPage } from '@/types/busqueda';

type AdvancedResponse = PaginatedResponse<BusquedaResultado> & {
  federated?: FederatedSearchPage;
};
type CollectionOption = { id: string; name: string; _count?: { memberships: number } };
type TaxonomyOption = { id: string; name: string };

const defaultFilters: BusquedaAvanzadaFilters = {
  q: '',
  digestoCollectionId: '',
  digestoTopicId: '',
  digestoTagId: '',
  fraseExacta: '',
  excluir: '',
  operador: 'AND',
  numeroSentencia: '',
  numeroSumario: '',
  expediente: '',
  caratula: '',
  actor: '',
  demandado: '',
  objeto: '',
  magistrados: '',
  sala: '',
  tipoFallo: '',
  tribunalOrigen: '',
  tema: '',
  fechaDesde: '',
  fechaHasta: '',
  anio: '',
  publicado: '',
  activo: '',
  soloConPdf: '',
  pdf: 'todos',
  soloConResumen: '',
  destacada: '',
  buscarEn: 'todo',
  sortBy: 'relevancia',
  sortOrder: 'desc',
  page: 1,
  pageSize: 10,
};

export default function BusquedaAvanzadaPage() {
  const { user } = useAuth();
  const {
    salas: catalogoSalas,
    tiposFallo: catalogoTiposFallo,
    tribunalesOrigen: catalogoTribunalesOrigen,
  } = useCatalogos();
  const [filters, setFilters] = useState<BusquedaAvanzadaFilters>(defaultFilters);
  const [result, setResult] = useState<AdvancedResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [topics, setTopics] = useState<TaxonomyOption[]>([]);
  const [tags, setTags] = useState<TaxonomyOption[]>([]);
  const canAdministerSearch = ['ADMIN', 'OPERADOR'].includes(user?.rol.nombre ?? '');
  useEffect(() => {
    void api.get<CollectionOption[]>('/corpus/curation/digesto/collections').then(setCollections).catch(() => setCollections([]));
    void api.get<TaxonomyOption[]>('/corpus/curation/digesto/topics').then(setTopics).catch(() => setTopics([]));
    void api.get<TaxonomyOption[]>('/corpus/curation/digesto/tags').then(setTags).catch(() => setTags([]));
  }, []);
  const corpusResults = result?.federated?.results.filter((item) => item.sourceSystem === 'CORPUS') ?? [];
  const corpusOnlySearch = Boolean(filters.digestoCollectionId || filters.digestoTopicId || filters.digestoTagId);
  const displayedTotal = corpusOnlySearch ? (result?.federated?.total ?? 0) : (result?.meta.total ?? 0);
  const displayedTotalExact = corpusOnlySearch ? (result?.federated?.totalExact ?? true) : (result?.meta.totalExact ?? true);
  const displayedHasMore = corpusOnlySearch ? (result?.federated?.hasMore ?? false) : (result?.meta.hasMore ?? false);
  const displayedPageSize = corpusOnlySearch ? (result?.federated?.pageSize ?? filters.pageSize ?? 10) : (result?.meta.pageSize ?? filters.pageSize ?? 10);
  const displayedPageCount = displayedTotalExact
    ? (corpusOnlySearch ? Math.max(1, Math.ceil(displayedTotal / displayedPageSize)) : (result?.meta.pageCount ?? 1))
    : (result?.meta.page ?? 1) + (displayedHasMore ? 1 : 0);

  const load = async (nextFilters = filters) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<AdvancedResponse>('/busqueda/avanzada', {
        query: limpiarFiltrosBusqueda(nextFilters),
      });
      setResult(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudo ejecutar la búsqueda.');
    } finally {
      setIsLoading(false);
    }
  };

  const saveSearch = async () => {
    const nombre = window.prompt('Nombre para guardar esta búsqueda administrativa');
    if (!nombre) return;
    await api.post('/busquedas-guardadas', { nombre, queryJson: filters });
    setFeedback('Búsqueda administrativa guardada.');
  };

  const exportResults = async (format: string) => {
    const blob = await api.download('/busqueda/avanzada/exportar', {
      query: limpiarFiltrosBusqueda({ ...filters, formato: format }),
    });
    downloadBlob(blob, `busqueda-avanzada.${format}`);
    void trackEvento({
      tipoEvento: 'export_results',
      metadata: {
        origen: 'busqueda-avanzada',
        formato: format,
        query: filters.q ?? '',
      },
    });
  };

  return (
    <div className={styles.section}>
      <PageHeader
        title="Búsqueda avanzada"
        description="Herramienta interna de consulta fina para operadores y cargadores."
      />

      {feedback ? <StatusMessage variant="success" title="Operacion realizada" message={feedback} /> : null}
      {error ? <StatusMessage variant="error" title="Error" message={error} /> : null}

      <BusquedaJurisprudenciaForm
        modo="admin"
        valoresIniciales={filters}
        temas={[]}
        salas={catalogoSalas.map((item) => item.nombre)}
        tiposFallo={catalogoTiposFallo.map((item) => item.nombre)}
        tribunalesOrigen={catalogoTribunalesOrigen.map((item) => item.nombre)}
        onBuscar={(values) => {
          const next = { ...filters, ...values, digestoCollectionId: filters.digestoCollectionId || values.digestoCollectionId, page: 1 };
          setFilters(next);
          void load(next);
        }}
        onLimpiar={() => {
          setFilters(defaultFilters);
          setResult(null);
        }}
        onGuardarBusqueda={canAdministerSearch ? () => void saveSearch() : undefined}
        onExportar={canAdministerSearch ? exportResults : undefined}
        mostrarFiltrosInternos
        mostrarExportar={canAdministerSearch}
        mostrarGuardarBusqueda={canAdministerSearch}
      />

      <Card>
        <label htmlFor="digestoCollectionId">Colección Digesto</label>{' '}
        <select id="digestoCollectionId" value={filters.digestoCollectionId ?? ''} onChange={(event) => setFilters((current) => ({ ...current, digestoCollectionId: event.target.value, page: 1 }))}>
          <option value="">Todas las fuentes</option>
          {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}{collection._count ? ` (${collection._count.memberships})` : ''}</option>)}
        </select>
        {' '}<label htmlFor="digestoTopicId">Tema Digesto</label>{' '}
        <select id="digestoTopicId" value={filters.digestoTopicId ?? ''} onChange={(event) => setFilters((current) => ({ ...current, digestoTopicId: event.target.value, page: 1 }))}>
          <option value="">Todos los temas</option>
          {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
        </select>
        {' '}<label htmlFor="digestoTagId">Etiqueta Digesto</label>{' '}
        <select id="digestoTagId" value={filters.digestoTagId ?? ''} onChange={(event) => setFilters((current) => ({ ...current, digestoTagId: event.target.value, page: 1 }))}>
          <option value="">Todas las etiquetas</option>
          {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select>
      </Card>

      {isLoading ? (
        <LoadingSpinner label="Buscando..." />
      ) : result ? (
        <>
          <Card>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryItem}>
                <span>Resultados</span>
                <strong>{displayedTotalExact ? displayedTotal : `≥${displayedTotal}`}</strong>
              </div>
              <div className={styles.summaryItem}>
                <span>Orden aplicado</span>
                <strong>{result.meta.sortUsed ?? filters.sortBy}</strong>
              </div>
              <div className={styles.summaryItem}>
                <span>Página</span>
                <strong>{displayedTotalExact ? `${result.meta.page} / ${displayedPageCount}` : `${result.meta.page}${displayedHasMore ? '+' : ''}`}</strong>
              </div>
              {result.meta.expandedTerms?.length ? (
                <div className={styles.summaryItem}>
                  <span>Términos relacionados</span>
                  <strong style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {result.meta.expandedTerms.map((term) => (
                      <SuggestionTag key={term} label={term} />
                    ))}
                  </strong>
                </div>
              ) : null}
            </div>
          </Card>
          {result.federated?.partial ? (
            <StatusMessage
              variant="error"
              title="Resultados parciales"
              message="Una fuente de búsqueda no respondió. Los resultados visibles no incluyen necesariamente todos los documentos."
            />
          ) : null}
          {!corpusOnlySearch ? <ResultadosJurisprudencia modo="admin" data={result.data} query={filters.q} /> : null}
          {corpusResults.length > 0 ? (
            <section className={styles.section} aria-label="Documentos del Corpus">
              <PageHeader title="Corpus documental" description={`${corpusResults.length} documentos Corpus en esta página de resultados federados.`} />
              {corpusResults.map((item) => (
                <Card key={item.id}>
                  <div className={styles.section}>
                    <div className={styles.inlineActions}>
                      <strong>{item.title ?? 'Documento institucional'}</strong>
                      <span className={styles.badge}>CORPUS · INTERNO</span>
                      {typeof item.metadata.digestoCollections === 'string' && item.metadata.digestoCollections ? <span className={styles.badge}>DIGESTO · {item.metadata.digestoCollections}</span> : null}
                    </div>
                    <span>{[item.metadata.court, item.metadata.chamber, item.date ? new Date(item.date).toLocaleDateString('es-AR') : null].filter(Boolean).join(' · ') || 'Metadatos pendientes de revisión'}</span>
                    {typeof item.metadata.digestoTopics === 'string' && item.metadata.digestoTopics ? <span>Temas Digesto: {item.metadata.digestoTopics}</span> : null}
                    {typeof item.metadata.digestoTags === 'string' && item.metadata.digestoTags ? <span>Etiquetas: {item.metadata.digestoTags}</span> : null}
                    {item.snippet ? <p>{item.snippet}</p> : null}
                    {item.metadata.pageNumber ? <span>Página {item.metadata.pageNumber}</span> : null}
                    <div className={styles.inlineActions}>
                      <Link href={`/corpus/${encodeURIComponent(item.sourceId)}?q=${encodeURIComponent(filters.q ?? '')}${item.metadata.pageNumber ? `&page=${item.metadata.pageNumber}` : ''}`}>Abrir documento</Link>
                    </div>
                  </div>
                </Card>
              ))}
            </section>
          ) : null}
          <Card>
            <Pagination
              page={result.meta.page}
              pageCount={displayedPageCount}
              total={displayedTotal}
              totalExact={displayedTotalExact}
              hasMore={displayedHasMore}
              pageSize={displayedPageSize}
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
        </>
      ) : null}
    </div>
  );
}

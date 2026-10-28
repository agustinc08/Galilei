import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { performance } from 'node:perf_hooks';
import { PrismaService } from '../prisma/prisma.service';
import {
  searchQueryTelemetry,
  type SearchQueryEvent,
} from '../prisma/search-query-telemetry';
import { sentenciaTienePdfReal } from '../archivos/pdf-real.util';
import { InstitutosJuridicosService } from '../institutos-juridicos/institutos-juridicos.service';
import { EventosConsultaService } from '../estadisticas/eventos-consulta.service';
import { RagService } from '../ia/rag.service';
import { BusquedaAvanzadaQueryDto } from './dto/busqueda-avanzada-query.dto';
import { ExportarBusquedaQueryDto } from './dto/exportar-busqueda-query.dto';
import { PublicBusquedaQueryDto } from './dto/public-busqueda-query.dto';
import { buildHighlight, type HighlightItem } from './utils/search-highlights';
import {
  evaluateSearchNode,
  type SearchFieldName,
  type SearchLiteralNode,
  type SearchMatchMode,
  type SearchNode,
} from './utils/search-ast';
import {
  parseSearchQuery,
  SearchQueryParseError,
  type ParsedSearchQuery,
} from './utils/search-parser';
import { explainSearchQuery } from './utils/search-explanation';
import { normalizeSearchText } from './utils/search-normalizer';
import { FederatedSearchService } from './federated-search.service';
import type { SearchContext } from './adapters/search-source.adapter';

type SearchMode = 'internal' | 'public';
type PdfFilter = 'todos' | 'conPdf' | 'sinPdf';

type BuscarJurisprudenciaOptions = {
  publico: boolean;
  incluirNoPublicados?: boolean;
  incluirInternos?: boolean;
};

type SortKey = NonNullable<BusquedaAvanzadaQueryDto['sortBy']>;
type PublicSortKey = NonNullable<PublicBusquedaQueryDto['sortBy']>;

type SearchCandidate = Prisma.SentenciaGetPayload<{
  include: {
    sumarios: true;
    archivosPdf: {
      select: { id: true; rutaArchivo: true };
    };
    referenciasNormativas: {
      select: {
        tipoNorma: true;
        numeroNorma: true;
        articulo: true;
        inciso: true;
        textoReferencia: true;
      };
    };
    referenciasJurisprudenciales: {
      select: { referencia: true; textoOriginal: true };
    };
    referenciasDoctrinarias: {
      select: {
        autor: true;
        titulo: true;
        fuente: true;
        textoReferencia: true;
      };
    };
    _count: {
      select: { sumarios: true; archivosPdf: true };
    };
  };
}>;

type MatchInfo = {
  exactPhraseMatches: number;
  termMatches: number;
  matchedFields: string[];
  directMatches: number;
  synonymMatches: number;
  textualScore?: number;
  semanticScore?: number;
  finalScore?: number;
};

type SearchSuggestion = {
  value: string;
  tipo:
    | 'tema'
    | 'magistrado'
    | 'sala'
    | 'tipoFallo'
    | 'expediente'
    | 'caratula'
    | 'libre';
  total: number;
};

type ResultadoBusqueda = {
  sentencia: {
    id: number;
    legacyCorpus?: boolean;
    extractoFallo?: string | null;
    slugPublico?: string | null;
    caratula?: string | null;
    numeroSentencia: string | null;
    tipoFallo: string | null;
    sala: string | null;
    fecha: Date | null;
    expediente: string | null;
    actor: string | null;
    demandado: string | null;
    objeto: string | null;
    magistrados: string | null;
    tribunalOrigen: string | null;
    publicado: boolean;
    activo: boolean;
    destacada: boolean;
    tienePdf: boolean;
    pdfDisponible: boolean;
    archivoPdfId: number | null;
    resumenPublicado?: boolean;
  };
  cantidadSumarios: number;
  cantidadPdfs: number;
  resumenBreve: string | null;
  relevancia: number;
  score: number;
  criterioPrincipal: string | null;
  fragmentos: string[];
  highlights: HighlightItem[];
  matchInfo: MatchInfo;
  matchedFields: string[];
  sumariosRelevantes: Array<{
    id: number;
    numeroSumario: string | null;
    tema: string | null;
    texto: string;
    resumenBusqueda: string | null;
    publicado: boolean;
    activo: boolean;
    sentenciaId: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

type ScoredResult = ResultadoBusqueda;

type PublicSearchCandidate = Prisma.SumarioGetPayload<{
  include: {
    sentencia: {
      select: {
        id: true;
        slugPublico: true;
        numeroSentencia: true;
        fecha: true;
        sala: true;
        magistrados: true;
        tipoFallo: true;
        anio: true;
        expediente: true;
        caratula: true;
        actor: true;
        demandado: true;
        actorPublico: true;
        demandadoPublico: true;
        anonimizado: true;
        objeto: true;
        tribunalOrigen: true;
        resumenIa: true;
        resumenPublicado: true;
        resena: true;
        resenaPublicada: true;
        tienePdf: true;
        publicado: true;
        activo: true;
        archivosPdf: {
          select: { id: true; rutaArchivo: true };
        };
        referenciasNormativas: {
          select: {
            tipoNorma: true;
            numeroNorma: true;
            articulo: true;
            inciso: true;
            textoReferencia: true;
          };
        };
        referenciasJurisprudenciales: {
          select: { referencia: true; textoOriginal: true };
        };
        referenciasDoctrinarias: {
          select: {
            autor: true;
            titulo: true;
            fuente: true;
            textoReferencia: true;
          };
        };
      };
    };
  };
}>;

type PublicSearchResult = {
  id: number;
  sentenciaId?: number;
  slugPublico: string | null;
  numeroSumario: string | null;
  numeroSentencia: string | null;
  fecha: Date | null;
  sala: string | null;
  magistrados: string | null;
  tipoFallo: string | null;
  expediente: string | null;
  tribunalOrigen: string | null;
  caratula: string | null;
  actor: string | null;
  demandado: string | null;
  tema: string | null;
  textoSumario: string;
  extractoFallo?: string | null;
  esFalloCorpus?: boolean;
  highlights: HighlightItem[];
  tienePdf: boolean;
  pdfDisponible: boolean;
  archivoPdfId: number | null;
  pdfUrl: string | null;
  score: number;
  criterioPrincipal: string | null;
  matchInfo: MatchInfo;
  matchedFields: string[];
};

const SCORE_WEIGHTS = {
  exactNumeroExpediente: 100,
  exactTema: 80,
  exactResumen: 65,
  exactResena: 65,
  exactSumario: 70,
  exactCampoPrincipal: 45,
  termTema: 50,
  termSumario: 35,
  termResumen: 30,
  termResena: 30,
  termObjeto: 25,
  termMagistrados: 25,
  termNumeroExpediente: 100,
  termActorDemandadoCaratula: 20,
  termSecundario: 18,
  fieldFilterMatch: 14,
  publicadaBonus: 10,
  destacadaBonus: 8,
  pdfBonus: 5,
  resenaPublicadaBonus: 5,
  directMatchBonus: 4,
  synonymMatchPenalty: 0.65,
} as const;

type CachedList = {
  data: string[];
  expiresAt: number;
};

const SEARCH_CANDIDATE_MAX_OVERFETCH = 250;

function buildDocumentExcerpt(text: string | null | undefined, query?: string) {
  const value = String(text ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!value) return null;
  const needle = String(query ?? '')
    .trim()
    .toLocaleLowerCase('es');
  const index = needle ? value.toLocaleLowerCase('es').indexOf(needle) : -1;
  const start = index < 0 ? 0 : Math.max(0, index - 100);
  const end = Math.min(value.length, start + 280);
  return `${start > 0 ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`;
}

@Injectable()
export class BusquedaService {
  private readonly listCache = new Map<string, CachedList>();
  private readonly listCacheTtlMs = 60_000;
  private lastAdvancedProfile: Record<string, unknown> | null = null;
  private lastPerformProfile: Record<string, unknown> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventosConsultaService: EventosConsultaService,
    private readonly ragService: RagService,
    private readonly institutosJuridicosService: InstitutosJuridicosService,
    @Optional()
    @Inject(FederatedSearchService)
    private readonly federatedSearchService: FederatedSearchService | null = null,
  ) {}

  async federatedSearch(
    query: string | undefined,
    operador: 'AND' | 'OR' | undefined,
    context: SearchContext,
  ) {
    if (!this.federatedSearchService) return null;
    const parserStartedAt = performance.now();
    const parsed = this.parseQuery(query, operador);
    const parserMs = performance.now() - parserStartedAt;
    const result = await this.federatedSearchService.search(parsed, context);
    return { ...result, parserMs };
  }

  interpretar(query?: string, operador?: 'AND' | 'OR') {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    const parsed = this.parseQuery(query, operador);
    return {
      searchSyntaxVersion: parsed.syntaxVersion,
      originalQuery: parsed.originalQuery,
      normalizedQuery: parsed.normalizedQuery,
      ast: parsed.root,
    };
  }

  interpretarConsultaPublica(query?: string, operador?: 'AND' | 'OR') {
    const parsed = this.parseQuery(query, operador);
    return { data: explainSearchQuery(parsed.root) };
  }

  private parseQuery(query?: string | null, operador?: 'AND' | 'OR') {
    try {
      return parseSearchQuery(query, { defaultOperator: operador ?? 'AND' });
    } catch (error) {
      if (error instanceof SearchQueryParseError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  async avanzada(query: BusquedaAvanzadaQueryDto, usuarioId?: number) {
    const queryEvents: SearchQueryEvent[] = [];
    return searchQueryTelemetry.run(queryEvents, async () => {
      const expansionStarted = performance.now();
      const expanded = await this.expandParsedQuery(
        query.q,
        this.parseQuery(query.q, query.operador),
      );
      const expansionMs = performance.now() - expansionStarted;
      const searchStarted = performance.now();
      const search = await this.buscarJurisprudencia(
        query,
        expanded.parsed,
        expanded.expandedTerms,
        { publico: false, incluirNoPublicados: true, incluirInternos: true },
      );
      const candidateSearchMs = performance.now() - searchStarted;
      const semanticStarted = performance.now();
      const results = await this.applySemanticBonus(search.results, query.q);
      const semanticBonusMs = performance.now() - semanticStarted;
      const sortUsed = search.sortUsed;
      const paginated = this.paginateResults(
        results,
        query.page ?? 1,
        query.pageSize ?? 10,
        sortUsed,
        expanded.expandedTerms,
        search.total,
        search.alreadyPaginated,
        search.totalExact,
        search.hasMore,
      );

      const fingerprints = new Map<
        string,
        { count: number; durationMs: number }
      >();
      for (const event of queryEvents) {
        const current = fingerprints.get(event.fingerprint) ?? {
          count: 0,
          durationMs: 0,
        };
        current.count += 1;
        current.durationMs += event.durationMs;
        fingerprints.set(event.fingerprint, current);
      }
      this.lastAdvancedProfile = {
        expansionMs: roundProfile(expansionMs),
        candidateSearchMs: roundProfile(candidateSearchMs),
        ...(this.lastPerformProfile ?? {}),
        semanticBonusMs: roundProfile(semanticBonusMs),
        prismaQueries: queryEvents.length,
        prismaQueryDurationMs: roundProfile(
          queryEvents.reduce((sum, event) => sum + event.durationMs, 0),
        ),
        queryFingerprints: [...fingerprints.entries()].map(
          ([fingerprint, value]) => ({
            fingerprint,
            ...value,
            durationMs: roundProfile(value.durationMs),
          }),
        ),
      };

      this.eventosConsultaService.trackSafe({
        tipoEvento: 'search_internal',
        usuarioId,
        metadata: {
          query: query.q ?? null,
          cantidadResultados: paginated.meta.total,
          sortUsed,
          filtrosUsados: this.extractUsedFilters(
            query as unknown as Record<string, unknown>,
          ),
          page: paginated.meta.page,
          origen: 'avanzada',
          expandedTerms: expanded.expandedTerms,
        },
      });

      return paginated;
    });
  }

  getLastAdvancedProfile() {
    return this.lastAdvancedProfile;
  }

  trackAdvancedV2(
    query: BusquedaAvanzadaQueryDto,
    usuarioId: number,
    cantidadResultados: number,
  ) {
    this.eventosConsultaService.trackSafe({
      tipoEvento: 'search_internal',
      usuarioId,
      metadata: {
        query: query.q ?? null,
        cantidadResultados,
        sortUsed: query.sortBy ?? 'relevancia',
        filtrosUsados: this.extractUsedFilters(
          query as unknown as Record<string, unknown>,
        ),
        page: query.page ?? 1,
        origen: 'avanzada-v2',
        expandedTerms: [],
      },
    });
  }

  trackCitationV2(
    query: string,
    usuarioId: number,
    cantidadResultados: number,
  ) {
    this.eventosConsultaService.trackSafe({
      tipoEvento: 'search_internal_cita',
      usuarioId,
      metadata: { query, cantidadResultados, origen: 'cita-v2' },
    });
  }

  async simple(query?: string, usuarioId?: number) {
    const expanded = await this.expandParsedQuery(
      query,
      this.parseQuery(query),
    );
    const search = await this.buscarJurisprudencia(
      {
        q: query?.trim(),
        page: 1,
        pageSize: 10,
      },
      expanded.parsed,
      expanded.expandedTerms,
      { publico: false, incluirNoPublicados: true, incluirInternos: true },
    );
    const results = await this.applySemanticBonus(search.results, query);
    const sortUsed = search.sortUsed;
    const paginated = this.paginateResults(
      results,
      1,
      10,
      sortUsed,
      expanded.expandedTerms,
      search.total,
      search.alreadyPaginated,
      search.totalExact,
      search.hasMore,
    );

    this.eventosConsultaService.trackSafe({
      tipoEvento: 'search_internal_simple',
      usuarioId,
      metadata: {
        query: query?.trim() ?? null,
        cantidadResultados: paginated.meta.total,
        sortUsed,
        origen: 'simple',
        expandedTerms: expanded.expandedTerms,
      },
    });

    return paginated;
  }

  async publica(query: PublicBusquedaQueryDto) {
    const startedAt = Date.now();
    const expanded = await this.expandParsedQuery(
      query.q,
      this.parseQuery(query.q, query.operador),
    );
    const search = await this.buscarJurisprudencia(
      query,
      expanded.parsed,
      expanded.expandedTerms,
      { publico: true, incluirNoPublicados: false, incluirInternos: false },
    );
    const results = await this.applySemanticBonus(search.results, query.q);
    const sortUsed = search.sortUsed;
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 300);
    const paginated = this.paginatePublicResults(
      results,
      page,
      pageSize,
      sortUsed,
      expanded.expandedTerms,
      search.total,
      search.alreadyPaginated,
      search.totalExact,
      search.hasMore,
    );

    this.eventosConsultaService.trackSafe({
      tipoEvento: 'search_public',
      metadata: {
        query: query.q ?? null,
        cantidadResultados: paginated.meta.total,
        sortUsed,
        filtrosUsados: this.extractUsedFilters(
          query as unknown as Record<string, unknown>,
        ),
        page: paginated.meta.page,
        origen: 'consulta',
        durationMs: Date.now() - startedAt,
        expandedTerms: expanded.expandedTerms,
      },
    });

    return {
      ...paginated,
      meta: {
        ...paginated.meta,
        tiempoMs: Date.now() - startedAt,
      },
    };
  }

  async exportar(query: ExportarBusquedaQueryDto) {
    const formato = query.formato ?? 'csv';
    const expanded = await this.expandParsedQuery(
      query.q,
      this.parseQuery(query.q, query.operador),
    );
    const { results, sortUsed } = await this.buscarJurisprudencia(
      query,
      expanded.parsed,
      expanded.expandedTerms,
      { publico: false, incluirNoPublicados: true, incluirInternos: true },
    );
    const paginated = this.paginateResults(
      results,
      1,
      Math.max(results.length, 1),
      sortUsed,
      expanded.expandedTerms,
    );

    if (formato === 'json') {
      return paginated;
    }

    if (formato === 'txt') {
      return this.toTxt(paginated.data);
    }

    return this.toCsv(paginated.data);
  }

  async sugerencias(q?: string) {
    const value = q?.trim() ?? '';
    if (value.length < 3) {
      return { data: [] };
    }

    try {
      const [temas, magistrados, salas, tiposFallo, expedientes, caratulas] =
        await Promise.all([
          this.getTemaSuggestions(value),
          this.getSplitFieldSuggestions('magistrados', value, 'magistrado'),
          this.getSimpleFieldSuggestions('sala', value, 'sala'),
          this.getSimpleFieldSuggestions('tipoFallo', value, 'tipoFallo'),
          this.getSimpleFieldSuggestions('expediente', value, 'expediente'),
          this.getSimpleFieldSuggestions('caratula', value, 'caratula'),
        ]);

      return {
        data: [
          ...temas,
          ...magistrados,
          ...salas,
          ...tiposFallo,
          ...expedientes,
          ...caratulas,
        ]
          .sort(
            (left, right) =>
              right.total - left.total || left.value.localeCompare(right.value),
          )
          .slice(0, 15),
      };
    } catch {
      return { data: [] };
    }
  }

  async sugerenciasPublicas(q?: string) {
    const value = q?.trim() ?? '';
    if (value.length < 3) {
      return { data: [] };
    }

    try {
      const [temas, salas, tiposFallo] = await Promise.all([
        this.getTemaSuggestions(value, true),
        this.getSimpleFieldSuggestions('sala', value, 'sala', true),
        this.getSimpleFieldSuggestions('tipoFallo', value, 'tipoFallo', true),
      ]);

      return {
        data: [...temas, ...salas, ...tiposFallo]
          .sort(
            (left, right) =>
              right.total - left.total || left.value.localeCompare(right.value),
          )
          .slice(0, 12),
      };
    } catch {
      return { data: [] };
    }
  }

  async sugerenciasTemas(q?: string, publico = false) {
    return { data: await this.getTemaSuggestions(q, publico) };
  }

  async sugerenciasMagistrados(q?: string) {
    return {
      data: await this.getSplitFieldSuggestions('magistrados', q, 'magistrado'),
    };
  }

  async sugerenciasSalas(q?: string, publico = false) {
    return {
      data: await this.getSimpleFieldSuggestions('sala', q, 'sala', publico),
    };
  }

  async sugerenciasTiposFallo(q?: string, publico = false) {
    return {
      data: await this.getSimpleFieldSuggestions(
        'tipoFallo',
        q,
        'tipoFallo',
        publico,
      ),
    };
  }

  async sugerenciasExpedientes(q?: string) {
    return {
      data: await this.getSimpleFieldSuggestions('expediente', q, 'expediente'),
    };
  }

  async sugerenciasCaratulas(q?: string) {
    return {
      data: await this.getSimpleFieldSuggestions('caratula', q, 'caratula'),
    };
  }

  async temas(publico = false) {
    return this.getCachedList(
      `temas-${publico ? 'publico' : 'interno'}`,
      async () => {
        const rows = publico
          ? await this.prisma.$queryRaw<Array<{ value: string }>>`
              SELECT DISTINCT s."tema" AS value
                FROM "Sumario" s
                JOIN "Sentencia" f ON f."id" = s."sentenciaId"
               WHERE s."tema" IS NOT NULL
                 AND s."publicado" = TRUE
                 AND s."activo" = TRUE
                 AND f."publicado" = TRUE
                 AND f."activo" = TRUE
               ORDER BY value ASC
               LIMIT 100
            `
          : await this.prisma.$queryRaw<Array<{ value: string }>>`
              SELECT DISTINCT s."tema" AS value
                FROM "Sumario" s
               WHERE s."tema" IS NOT NULL
               ORDER BY value ASC
               LIMIT 100
            `;
        return rows.map((item) => item.value).filter(Boolean);
      },
    );
  }

  async salas(publico = false) {
    return this.getCachedList(
      `salas-${publico ? 'publico' : 'interno'}`,
      async () => {
        const rows = publico
          ? await this.prisma.$queryRaw<Array<{ value: string }>>`
              SELECT DISTINCT "sala" AS value
                FROM "Sentencia"
               WHERE "sala" IS NOT NULL AND "publicado" = TRUE AND "activo" = TRUE
               ORDER BY value ASC
               LIMIT 100
            `
          : await this.prisma.$queryRaw<Array<{ value: string }>>`
              SELECT DISTINCT "sala" AS value
                FROM "Sentencia"
               WHERE "sala" IS NOT NULL
               ORDER BY value ASC
               LIMIT 100
            `;
        return rows.map((item) => item.value).filter(Boolean);
      },
    );
  }

  async tiposFallo(publico = false) {
    return this.getCachedList(
      `tipos-fallo-${publico ? 'publico' : 'interno'}`,
      async () => {
        const rows = publico
          ? await this.prisma.$queryRaw<Array<{ value: string }>>`
              SELECT DISTINCT "tipoFallo" AS value
                FROM "Sentencia"
               WHERE "tipoFallo" IS NOT NULL AND "publicado" = TRUE AND "activo" = TRUE
               ORDER BY value ASC
               LIMIT 100
            `
          : await this.prisma.$queryRaw<Array<{ value: string }>>`
              SELECT DISTINCT "tipoFallo" AS value
                FROM "Sentencia"
               WHERE "tipoFallo" IS NOT NULL
               ORDER BY value ASC
               LIMIT 100
            `;
        return rows.map((item) => item.value).filter(Boolean);
      },
    );
  }

  async buscarPorCita(q?: string, usuarioId?: number) {
    const value = q?.trim() ?? '';
    const expanded = await this.expandParsedQuery(
      value,
      this.parseQuery(value),
    );
    const { results } = await this.buscarJurisprudencia(
      {
        q: value,
        page: 1,
        pageSize: 20,
        buscarEn: ['sentencia', 'resumen', 'resena'],
      },
      expanded.parsed,
      expanded.expandedTerms,
      { publico: false, incluirNoPublicados: true, incluirInternos: true },
    );

    this.eventosConsultaService.trackSafe({
      tipoEvento: 'search_internal_cita',
      usuarioId,
      metadata: {
        query: value,
        cantidadResultados: results.length,
        origen: 'cita',
      },
    });

    return { data: results.slice(0, 20) };
  }

  private async getCachedList(key: string, loader: () => Promise<string[]>) {
    const cached = this.listCache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return { data: cached.data };
    }

    const data = await loader();
    this.listCache.set(key, {
      data,
      expiresAt: now + this.listCacheTtlMs,
    });
    return { data };
  }

  private async getTemaSuggestions(q?: string, publico = false) {
    const value = q?.trim() ?? '';
    if (!value) {
      return [];
    }

    const rows = await this.prisma.sumario.findMany({
      where: {
        tema: { not: null, contains: value, mode: 'insensitive' },
        ...(publico && {
          publicado: true,
          activo: true,
          sentencia: { publicado: true, activo: true },
        }),
      },
      select: { tema: true },
      take: 150,
    });

    return this.aggregateSuggestions(
      rows.map((item) => item.tema),
      'tema',
      value,
    );
  }

  private async getSimpleFieldSuggestions(
    field: 'sala' | 'tipoFallo' | 'expediente' | 'caratula',
    q?: string,
    tipo: SearchSuggestion['tipo'] = 'libre',
    publico = false,
  ) {
    const value = q?.trim() ?? '';
    if (!value) {
      return [];
    }

    const rows = await this.prisma.sentencia.findMany({
      where: {
        [field]: { not: null, contains: value, mode: 'insensitive' },
        ...(publico && { publicado: true, activo: true }),
      },
      select: { [field]: true },
      take: 150,
    });

    return this.aggregateSuggestions(
      rows.map((item) => {
        const value = item[field];
        return typeof value === 'string' ? value : '';
      }),
      tipo,
      value,
    );
  }

  private async getSplitFieldSuggestions(
    field: 'magistrados',
    q?: string,
    tipo: SearchSuggestion['tipo'] = 'magistrado',
  ) {
    const value = q?.trim() ?? '';
    if (!value) {
      return [];
    }

    const rows = await this.prisma.sentencia.findMany({
      where: {
        [field]: { not: null, contains: value, mode: 'insensitive' },
      },
      select: { [field]: true },
      take: 150,
    });

    const values = rows.flatMap((item) =>
      String(item[field] ?? '')
        .split(/[;,]/)
        .map((part) => part.trim())
        .filter(Boolean),
    );

    return this.aggregateSuggestions(values, tipo, value);
  }

  private aggregateSuggestions(
    values: Array<string | null | undefined>,
    tipo: SearchSuggestion['tipo'],
    q: string,
  ) {
    const normalizedQuery = normalizeSearchText(q);
    const counter = new Map<string, SearchSuggestion>();

    for (const rawValue of values) {
      const value = rawValue?.trim();
      if (!value) {
        continue;
      }

      const normalized = normalizeSearchText(value);
      if (!normalized || !normalized.includes(normalizedQuery)) {
        continue;
      }

      const current = counter.get(normalized);
      if (current) {
        current.total += 1;
        continue;
      }

      counter.set(normalized, {
        value,
        tipo,
        total: 1,
      });
    }

    return [...counter.values()]
      .sort(
        (left, right) =>
          right.total - left.total || left.value.localeCompare(right.value),
      )
      .slice(0, 15);
  }

  private async expandParsedQuery(
    raw: string | undefined,
    parsed: ParsedSearchQuery,
  ) {
    const baseTerms = [
      ...(raw?.trim() ? [raw.trim()] : []),
      ...parsed.terms,
      ...parsed.exactPhrases,
      ...Object.values(parsed.fieldTerms).flat(),
    ];
    const expandedTerms =
      await this.institutosJuridicosService.expandTerms(baseTerms);

    if (!expandedTerms.length) {
      return { parsed, expandedTerms: [] as string[] };
    }

    return {
      expandedTerms,
      parsed: {
        ...parsed,
        terms: [...parsed.terms, ...expandedTerms],
        include: [...parsed.include, ...expandedTerms],
      },
    };
  }

  private async buscarJurisprudencia(
    query: PublicBusquedaQueryDto,
    parsed: ParsedSearchQuery,
    expandedTerms: string[],
    options: BuscarJurisprudenciaOptions & { publico: true },
  ): Promise<{
    results: PublicSearchResult[];
    sortUsed: PublicSortKey;
    total?: number;
    totalExact?: boolean;
    hasMore?: boolean;
    alreadyPaginated?: boolean;
  }>;
  private async buscarJurisprudencia(
    query: Partial<BusquedaAvanzadaQueryDto>,
    parsed: ParsedSearchQuery,
    expandedTerms: string[],
    options: BuscarJurisprudenciaOptions & { publico: false },
  ): Promise<{
    results: ScoredResult[];
    sortUsed: SortKey;
    total?: number;
    totalExact?: boolean;
    hasMore?: boolean;
    alreadyPaginated?: boolean;
  }>;
  private async buscarJurisprudencia(
    query: PublicBusquedaQueryDto | Partial<BusquedaAvanzadaQueryDto>,
    parsed: ParsedSearchQuery,
    expandedTerms: string[],
    options: BuscarJurisprudenciaOptions,
  ): Promise<{
    results: PublicSearchResult[] | ScoredResult[];
    sortUsed: PublicSortKey | SortKey;
    total?: number;
    totalExact?: boolean;
    hasMore?: boolean;
    alreadyPaginated?: boolean;
  }> {
    if (options.publico) {
      return this.performPublicSearch(query, parsed, expandedTerms);
    }

    return this.performSearch(query, parsed, expandedTerms, 'internal');
  }

  private resolvePdfFilter(
    query: Pick<
      Partial<BusquedaAvanzadaQueryDto>,
      'pdf' | 'soloConPdf' | 'tienePdf'
    >,
  ): PdfFilter {
    if (
      query.pdf === 'conPdf' ||
      query.soloConPdf === true ||
      query.tienePdf === true
    ) {
      return 'conPdf';
    }

    if (query.pdf === 'sinPdf' || query.tienePdf === false) {
      return 'sinPdf';
    }

    return 'todos';
  }

  private buildPdfWhere(pdf: PdfFilter): Prisma.SentenciaWhereInput {
    if (pdf === 'conPdf') {
      return {
        archivosPdf: {
          some: {
            rutaArchivo: { not: '' },
          },
        },
      };
    }

    return {};
  }

  private isSearchDebugEnabled() {
    return process.env.BUSQUEDA_DEBUG === 'true';
  }

  private matchesPdfFilter(
    sentenciaId: number,
    tienePdf: boolean,
    archivosPdf: Array<{ id: number; rutaArchivo: string | null }>,
    pdfFilter: PdfFilter,
  ) {
    const pdfReal = sentenciaTienePdfReal(archivosPdf);

    if (pdfFilter !== 'todos' && this.isSearchDebugEnabled()) {
      console.log(
        `[busqueda:pdf] sentenciaId=${sentenciaId} filtro=${pdfFilter} ` +
          `tienePdf=${tienePdf} archivosPdf=${archivosPdf.length} ` +
          `pdfsValidos=${pdfReal.cantidad} archivoPdfId=${pdfReal.archivoPdfId ?? 'null'}`,
      );
    }

    if (pdfFilter === 'conPdf') {
      return pdfReal.disponible;
    }

    if (pdfFilter === 'sinPdf') {
      return !pdfReal.disponible;
    }

    return true;
  }

  private debugSearchSummary(input: {
    modo: 'PUBLICO' | 'INTERNO';
    query: unknown;
    pdfFilter: PdfFilter;
    candidatos: number;
    resultados: number;
    where: unknown;
    pageSize: number;
    durationMs: number;
    candidateLimit: number;
  }) {
    if (!this.isSearchDebugEnabled()) {
      return;
    }

    console.log(
      `[busqueda:${input.modo}] candidatos=${input.candidatos} resultados=${input.resultados} ` +
        `pageSize=${input.pageSize} limite=${input.candidateLimit} ` +
        `duracionMs=${input.durationMs}`,
    );
  }

  private normalizeQueryParams<
    T extends Partial<BusquedaAvanzadaQueryDto> | PublicBusquedaQueryDto,
  >(query: T): T {
    const cleaned = { ...query } as T & Record<string, unknown>;

    for (const [key, value] of Object.entries(cleaned)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        cleaned[key] =
          trimmed === '' || trimmed === 'todos' ? undefined : trimmed;
      }
    }

    if (cleaned.pdf === undefined && cleaned.soloConPdf === true) {
      cleaned.pdf = 'conPdf';
    }

    if (cleaned.pdf === undefined && cleaned.tienePdf === true) {
      cleaned.pdf = 'conPdf';
    }

    if (cleaned.pdf === undefined && cleaned.tienePdf === false) {
      cleaned.pdf = 'sinPdf';
    }

    return cleaned;
  }

  private normalizedIncludes(
    source: string | null | undefined,
    expected: unknown,
  ) {
    if (expected === undefined || expected === null || expected === '') {
      return true;
    }
    if (
      typeof expected !== 'string' &&
      typeof expected !== 'number' &&
      typeof expected !== 'boolean'
    ) {
      return true;
    }

    return normalizeSearchText(source).includes(
      normalizeSearchText(String(expected)),
    );
  }

  private matchesExplicitSentenciaFilters(
    sentencia: Pick<
      SearchCandidate,
      | 'numeroSentencia'
      | 'expediente'
      | 'caratula'
      | 'actor'
      | 'demandado'
      | 'objeto'
      | 'magistrados'
      | 'sala'
      | 'tipoFallo'
      | 'tribunalOrigen'
      | 'anio'
    >,
    query: Partial<BusquedaAvanzadaQueryDto>,
  ) {
    return (
      this.normalizedIncludes(
        sentencia.numeroSentencia,
        query.numeroSentencia,
      ) &&
      this.normalizedIncludes(sentencia.expediente, query.expediente) &&
      this.normalizedIncludes(sentencia.caratula, query.caratula) &&
      this.normalizedIncludes(sentencia.actor, query.actor) &&
      this.normalizedIncludes(sentencia.demandado, query.demandado) &&
      this.normalizedIncludes(sentencia.objeto, query.objeto) &&
      this.normalizedIncludes(sentencia.magistrados, query.magistrados) &&
      this.normalizedIncludes(sentencia.sala, query.sala) &&
      this.normalizedIncludes(sentencia.tipoFallo, query.tipoFallo) &&
      this.normalizedIncludes(sentencia.tribunalOrigen, query.tribunalOrigen) &&
      (query.anio === undefined || sentencia.anio === Number(query.anio))
    );
  }

  private matchesExplicitSumarioFilters(
    sumarios: Array<{ tema: string | null; numeroSumario: string | null }>,
    query: Partial<BusquedaAvanzadaQueryDto>,
  ) {
    if (
      query.tema &&
      !sumarios.some((sumario) =>
        this.normalizedIncludes(sumario.tema, query.tema),
      )
    ) {
      return false;
    }

    if (
      query.numeroSumario &&
      !sumarios.some((sumario) =>
        this.normalizedIncludes(sumario.numeroSumario, query.numeroSumario),
      )
    ) {
      return false;
    }

    return true;
  }

  private buildReferenceText(sentencia: {
    referenciasNormativas?: Array<{
      tipoNorma: string | null;
      numeroNorma: string | null;
      articulo: string | null;
      inciso: string | null;
      textoReferencia: string | null;
    }>;
    referenciasJurisprudenciales?: Array<{
      referencia: string | null;
      textoOriginal: string | null;
    }>;
    referenciasDoctrinarias?: Array<{
      autor: string | null;
      titulo: string | null;
      fuente: string | null;
      textoReferencia: string | null;
    }>;
  }) {
    return normalizeSearchText(
      ...(sentencia.referenciasNormativas ?? []).flatMap((referencia) => [
        referencia.tipoNorma,
        referencia.numeroNorma,
        referencia.articulo,
        referencia.inciso,
        referencia.textoReferencia,
      ]),
      ...(sentencia.referenciasJurisprudenciales ?? []).flatMap(
        (referencia) => [referencia.referencia, referencia.textoOriginal],
      ),
      ...(sentencia.referenciasDoctrinarias ?? []).flatMap((referencia) => [
        referencia.autor,
        referencia.titulo,
        referencia.fuente,
        referencia.textoReferencia,
      ]),
    );
  }

  private async performPublicSearch(
    query: PublicBusquedaQueryDto,
    parsed: ParsedSearchQuery,
    expandedTerms: string[],
  ) {
    const queryForSearch = this.normalizeQueryParams(query);
    const hasTextSearch = Boolean(
      queryForSearch.q?.trim() || queryForSearch.fraseExacta?.trim(),
    );
    const sortUsed = query.sortBy ?? (hasTextSearch ? 'relevancia' : 'fecha');
    const search = await this.performSearch(
      queryForSearch,
      parsed,
      expandedTerms,
      'public',
    );
    const results = this.toPublicResults(search.results);

    return {
      results: this.sortPublicResults(
        results,
        sortUsed,
        query.sortOrder ?? 'desc',
      ),
      sortUsed,
      total: search.total,
      totalExact: search.totalExact,
      hasMore: search.hasMore,
      alreadyPaginated: search.alreadyPaginated,
    };
  }

  private toPublicResults(results: ScoredResult[]): PublicSearchResult[] {
    return results.flatMap((result) => {
      const sumarios = result.sumariosRelevantes.length
        ? result.sumariosRelevantes
        : [
            {
              id: result.sentencia.id,
              numeroSumario: null,
              tema: null,
              texto: result.sentencia.legacyCorpus
                ? (result.highlights.find(
                    (item) => item.campo === 'extracto del fallo',
                  )?.texto ?? '')
                : (result.resumenBreve ?? ''),
              resumenBusqueda: null,
              publicado: true,
              activo: true,
              sentenciaId: result.sentencia.id,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ];

      return sumarios.map((sumario) => ({
        id: sumario.id,
        sentenciaId: result.sentencia.id,
        slugPublico: result.sentencia.slugPublico ?? null,
        numeroSumario: sumario.numeroSumario,
        numeroSentencia: result.sentencia.numeroSentencia,
        fecha: result.sentencia.fecha,
        sala: result.sentencia.sala,
        magistrados: result.sentencia.magistrados,
        tipoFallo: result.sentencia.tipoFallo,
        expediente: result.sentencia.expediente,
        tribunalOrigen: result.sentencia.tribunalOrigen,
        caratula: result.sentencia.caratula ?? null,
        actor: result.sentencia.actor,
        demandado: result.sentencia.demandado,
        tema: sumario.tema,
        textoSumario: sumario.texto,
        extractoFallo: result.sentencia.extractoFallo,
        esFalloCorpus: Boolean(result.sentencia.legacyCorpus),
        highlights: result.highlights,
        tienePdf: result.sentencia.pdfDisponible,
        pdfDisponible: result.sentencia.pdfDisponible,
        archivoPdfId: result.sentencia.archivoPdfId,
        pdfUrl:
          result.sentencia.slugPublico && result.sentencia.pdfDisponible
            ? `/api/public/sentencias/${result.sentencia.slugPublico}/pdf`
            : null,
        score: result.score,
        criterioPrincipal: result.criterioPrincipal,
        matchInfo: result.matchInfo,
        matchedFields: result.matchedFields,
      }));
    });
  }

  private async performSearch(
    query: Partial<BusquedaAvanzadaQueryDto>,
    parsed: ParsedSearchQuery,
    expandedTerms: string[],
    mode: SearchMode,
  ) {
    const startedAt = Date.now();
    const whereBuildStarted = performance.now();
    const queryForSearch = this.normalizeQueryParams(query);
    const hasTextSearch = Boolean(
      queryForSearch.q || queryForSearch.fraseExacta,
    );
    const where = this.buildCandidateWhere(
      queryForSearch,
      parsed,
      mode,
      !hasTextSearch,
    );
    const whereBuildMs = performance.now() - whereBuildStarted;
    const sortUsed =
      queryForSearch.sortBy ?? (hasTextSearch ? 'relevancia' : 'fecha');
    const page = Math.max(1, Number(queryForSearch.page ?? 1));
    const pageSize = Math.min(
      Math.max(1, Number(queryForSearch.pageSize ?? 10)),
      300,
    );
    const candidateLimit = hasTextSearch
      ? Math.min(
          Math.max(page * pageSize + pageSize * 2, pageSize * 3, 50),
          SEARCH_CANDIDATE_MAX_OVERFETCH,
        )
      : pageSize;
    const candidateGenerationStarted = performance.now();
    const candidateIds = hasTextSearch
      ? await this.findCandidateIds(queryForSearch, parsed, mode)
      : undefined;
    const candidateGenerationMs =
      performance.now() - candidateGenerationStarted;
    const orderBy =
      sortUsed === 'fecha'
        ? [
            { fecha: queryForSearch.sortOrder ?? 'desc' },
            { id: 'desc' as const },
          ]
        : [{ id: 'desc' as const }];
    const sumarioIncludeWhere = this.buildSumarioIncludeWhere(
      queryForSearch,
      parsed,
      mode,
    );

    let totalCandidates = 0;
    let candidates: SearchCandidate[];
    let countMs = 0;
    let candidateIdRows: Array<{ id: number }> = [];
    let hasMore = false;
    const candidateQueryStarted = performance.now();
    if (candidateIds) {
      const selected =
        candidateIds.length === 0
          ? []
          : await this.prisma.sentencia.findMany({
              where: { AND: [where, { id: { in: candidateIds } }] },
              select: { id: true },
              orderBy,
              take: candidateLimit + 1,
            });
      hasMore = selected.length > candidateLimit;
      candidateIdRows = selected.slice(0, candidateLimit);
    }
    const selectedIds = candidateIds
      ? candidateIdRows.map((row) => row.id)
      : undefined;
    const candidateQuery =
      selectedIds?.length === 0
        ? Promise.resolve([] as SearchCandidate[])
        : this.prisma.sentencia.findMany({
            where: selectedIds
              ? { AND: [where, { id: { in: selectedIds } }] }
              : where,
            orderBy,
            skip: hasTextSearch ? undefined : (page - 1) * pageSize,
            take: selectedIds ? selectedIds.length : candidateLimit,
            include: {
              _count: {
                select: { sumarios: true, archivosPdf: true },
              },
              archivosPdf: {
                select: { id: true, rutaArchivo: true },
                orderBy: { createdAt: 'desc' },
              },
              referenciasNormativas: {
                select: {
                  tipoNorma: true,
                  numeroNorma: true,
                  articulo: true,
                  inciso: true,
                  textoReferencia: true,
                },
              },
              referenciasJurisprudenciales: {
                select: { referencia: true, textoOriginal: true },
              },
              referenciasDoctrinarias: {
                select: {
                  autor: true,
                  titulo: true,
                  fuente: true,
                  textoReferencia: true,
                },
              },
              sumarios: {
                where: sumarioIncludeWhere,
                orderBy: { id: 'asc' },
                take: mode === 'public' ? 5 : 20,
              },
            },
          });
    if (hasTextSearch) {
      // Text searches already report the bounded scored-candidate count below;
      // the exact count was unused and duplicated the most expensive predicate.
      candidates = await candidateQuery;
    } else {
      const countStarted = performance.now();
      const [total, rows] = await Promise.all([
        this.prisma.sentencia.count({ where }),
        candidateQuery,
      ]);
      totalCandidates = total;
      countMs = performance.now() - countStarted;
      candidates = rows;
    }
    const candidateQueryMs = performance.now() - candidateQueryStarted;

    const scoringStarted = performance.now();
    const results = candidates
      .map((candidate) =>
        this.scoreCandidate(
          candidate,
          queryForSearch,
          parsed,
          expandedTerms,
          mode,
        ),
      )
      .filter((item): item is ScoredResult => item !== null);
    const sortedResults = this.sortResults(
      results,
      sortUsed,
      queryForSearch.sortOrder,
      hasTextSearch,
    );
    const scoringMs = performance.now() - scoringStarted;

    this.lastPerformProfile = {
      whereBuildMs: roundProfile(whereBuildMs),
      candidateGenerationMs: roundProfile(candidateGenerationMs),
      candidateIdRows: candidateIdRows.length,
      countMs: roundProfile(countMs),
      candidateQueryMs: roundProfile(candidateQueryMs),
      scoringAndSortMs: roundProfile(scoringMs),
      candidateRows: candidates.length,
      returnedRows: sortedResults.length,
      textSearch: hasTextSearch,
    };

    this.debugSearchSummary({
      modo: mode === 'public' ? 'PUBLICO' : 'INTERNO',
      query: queryForSearch,
      pdfFilter: this.resolvePdfFilter(queryForSearch),
      candidatos: candidates.length,
      resultados: results.length,
      where,
      pageSize,
      durationMs: Date.now() - startedAt,
      candidateLimit,
    });

    return {
      results: sortedResults,
      sortUsed,
      total: hasTextSearch ? sortedResults.length : totalCandidates,
      totalExact: !hasTextSearch || candidateIds?.length === 0,
      hasMore,
      alreadyPaginated: !hasTextSearch,
    };
  }

  private extractUsedFilters(query: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(query).filter(
        ([, value]) =>
          value !== undefined &&
          value !== null &&
          value !== '' &&
          (!Array.isArray(value) || value.length > 0),
      ),
    );
  }

  private buildCandidateWhere(
    query: Partial<BusquedaAvanzadaQueryDto>,
    parsed: ParsedSearchQuery,
    mode: SearchMode,
    includeText = true,
  ): Prisma.SentenciaWhereInput {
    const pdfFilter = this.resolvePdfFilter(query);
    const pdfWhere = this.buildPdfWhere(pdfFilter);
    const andClauses: Prisma.SentenciaWhereInput[] = [];

    if (pdfFilter === 'conPdf') {
      andClauses.push(pdfWhere);
    }

    if (includeText && parsed.root) {
      andClauses.push(this.buildSearchNodeWhere(parsed.root, mode));
    }
    if (includeText && query.fraseExacta?.trim()) {
      andClauses.push({
        OR: this.buildTextTermWhere(
          normalizeSearchText(query.fraseExacta),
          mode,
        ),
      });
    }
    for (const excluded of includeText ? (query.excluir ?? []) : []) {
      const normalized = normalizeSearchText(excluded);
      if (normalized)
        andClauses.push({
          NOT: { OR: this.buildTextTermWhere(normalized, mode) },
        });
    }

    return {
      ...(mode === 'public' && { publicado: true, activo: true }),
      ...(query.publicado !== undefined && { publicado: query.publicado }),
      ...(query.activo !== undefined && { activo: query.activo }),
      ...(query.numeroSentencia && {
        numeroSentencia: {
          contains: query.numeroSentencia,
          mode: 'insensitive',
        },
      }),
      ...(query.expediente && {
        expediente: { contains: query.expediente, mode: 'insensitive' },
      }),
      ...(query.caratula && {
        caratula: { contains: query.caratula, mode: 'insensitive' },
      }),
      ...(query.actor && {
        actor: { contains: query.actor, mode: 'insensitive' },
      }),
      ...(query.demandado && {
        demandado: { contains: query.demandado, mode: 'insensitive' },
      }),
      ...(query.objeto && {
        objeto: { contains: query.objeto, mode: 'insensitive' },
      }),
      ...(query.magistrados && {
        magistrados: { contains: query.magistrados, mode: 'insensitive' },
      }),
      ...(query.sala && {
        sala: { contains: query.sala, mode: 'insensitive' },
      }),
      ...(query.tipoFallo && {
        tipoFallo: { contains: query.tipoFallo, mode: 'insensitive' },
      }),
      ...(query.tribunalOrigen && {
        tribunalOrigen: { contains: query.tribunalOrigen, mode: 'insensitive' },
      }),
      ...(query.tema && {
        sumarios: {
          some: {
            tema: { contains: query.tema, mode: 'insensitive' },
            ...(mode === 'public' && { publicado: true, activo: true }),
          },
        },
      }),
      ...(query.numeroSumario && {
        sumarios: {
          some: {
            numeroSumario: {
              contains: query.numeroSumario,
              mode: 'insensitive',
            },
            ...(mode === 'public' && { publicado: true, activo: true }),
          },
        },
      }),
      ...(query.anio !== undefined && { anio: query.anio }),
      ...(query.destacada !== undefined && { destacada: query.destacada }),
      ...(query.soloConResumen && { resumenIa: { not: null } }),
      ...((query.fechaDesde || query.fechaHasta) && {
        fecha: {
          ...(query.fechaDesde && { gte: query.fechaDesde }),
          ...(query.fechaHasta && { lte: query.fechaHasta }),
        },
      }),
      ...(andClauses.length > 0 && { AND: andClauses }),
    };
  }

  private async findCandidateIds(
    query: Partial<BusquedaAvanzadaQueryDto>,
    parsed: ParsedSearchQuery,
    mode: SearchMode,
  ): Promise<number[]> {
    const root = parsed.root;
    const extraNodes: SearchNode[] = [];
    if (query.fraseExacta?.trim()) {
      const value = query.fraseExacta.trim();
      extraNodes.push({
        type: 'phrase',
        value,
        normalizedValue: normalizeSearchText(value),
        sourceText: value,
      });
    }
    for (const value of query.excluir ?? []) {
      const normalizedValue = normalizeSearchText(value);
      if (!normalizedValue) continue;
      extraNodes.push({
        type: 'not',
        operand: {
          type: 'term',
          value,
          normalizedValue,
          matchMode: 'contains',
          sourceText: value,
        },
      });
    }
    const rootNodes = [...(root ? [root] : []), ...extraNodes];
    const candidateRoot: SearchNode | null =
      rootNodes.length === 0
        ? null
        : rootNodes.length === 1
          ? rootNodes[0]
          : { type: 'and', operands: rootNodes };

    const eligibleSentence = (alias: string) => Prisma.sql`
      ${Prisma.raw(`${alias}."activo"`)} = TRUE
      ${mode === 'public' ? Prisma.sql`AND ${Prisma.raw(`${alias}."publicado"`)} = TRUE` : Prisma.empty}
    `;
    const normalizeSql = (expression: string) =>
      `regexp_replace(translate(lower(coalesce(${expression},'')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g')`;
    const escapeLike = (value: string) => value.replace(/[\\%_]/gu, '\\$&');

    const fieldColumns: Partial<Record<SearchFieldName, string>> = {
      sala: 't."sala"',
      tipoFallo: 't."tipoFallo"',
      tribunalOrigen: 't."tribunalOrigen"',
      expediente: 't."expediente"',
      caratula: 't."caratula"',
      actor: 't."actor"',
      demandado: 't."demandado"',
      objeto: 't."objeto"',
      magistrados: 't."magistrados"',
      numeroSentencia: 't."numeroSentencia"',
    };

    const literalCandidates = (literal: SearchLiteralNode): Prisma.Sql => {
      const needle = literal.normalizedValue;
      const rawNeedle =
        literal.type === 'phrase' ? literal.value : literal.value;
      const normalizedPattern = `%${needle}%`;
      const rawPattern =
        literal.type === 'term' && literal.matchMode === 'prefix'
          ? `${escapeLike(rawNeedle)}%`
          : literal.type === 'term' && literal.matchMode === 'suffix'
            ? `%${escapeLike(rawNeedle)}`
            : `%${escapeLike(rawNeedle)}%`;
      const summaryVisibility =
        mode === 'public'
          ? Prisma.sql`AND s."publicado" = TRUE AND s."activo" = TRUE`
          : Prisma.sql`AND s."activo" = TRUE`;

      if (literal.field === 'tema' || literal.field === 'numeroSumario') {
        const column =
          literal.field === 'tema' ? 's."tema"' : 's."numeroSumario"';
        return Prisma.sql`SELECT s."sentenciaId" AS "id"
          FROM "Sumario" s
          WHERE s."activo" = TRUE ${mode === 'public' ? Prisma.sql`AND s."publicado" = TRUE` : Prisma.empty}
            AND ${Prisma.raw(normalizeSql(column))} LIKE ${normalizedPattern}`;
      }

      if (literal.field) {
        const column = fieldColumns[literal.field];
        if (!column)
          return Prisma.sql`SELECT t."id" AS "id" FROM "Sentencia" t WHERE FALSE`;
        const expression =
          literal.field === 'actor' && mode === 'public'
            ? `CASE WHEN t."anonimizado" AND t."actorPublico" IS NOT NULL THEN t."actorPublico" ELSE t."actor" END`
            : literal.field === 'demandado' && mode === 'public'
              ? `CASE WHEN t."anonimizado" AND t."demandadoPublico" IS NOT NULL THEN t."demandadoPublico" ELSE t."demandado" END`
              : column;
        return Prisma.sql`SELECT t."id" AS "id" FROM "Sentencia" t
          WHERE ${eligibleSentence('t')} AND ${Prisma.raw(normalizeSql(expression))} LIKE ${normalizedPattern}`;
      }

      const sentenceExpressions =
        mode === 'public'
          ? [
              't."numeroSentencia"',
              't."expediente"',
              't."caratula"',
              'CASE WHEN t."anonimizado" AND t."actorPublico" IS NOT NULL THEN t."actorPublico" ELSE t."actor" END',
              'CASE WHEN t."anonimizado" AND t."demandadoPublico" IS NOT NULL THEN t."demandadoPublico" ELSE t."demandado" END',
              't."objeto"',
              't."magistrados"',
              't."sala"',
              't."tipoFallo"',
              't."tribunalOrigen"',
              'CASE WHEN t."resumenPublicado" THEN t."resumenIa" ELSE NULL END',
              'CASE WHEN t."resenaPublicada" THEN t."resena" ELSE NULL END',
            ]
          : ['t."textoBusquedaNormalizado"'];
      const sentenceTextPredicate =
        mode === 'public'
          ? sentenceExpressions.map(
              (expression) => Prisma.sql`
            ${Prisma.raw(normalizeSql(expression))} LIKE ${normalizedPattern}
          `,
            )
          : [
              Prisma.sql`t."textoBusquedaNormalizado" LIKE ${normalizedPattern}`,
            ];
      if (mode !== 'public') {
        sentenceTextPredicate.push(
          Prisma.sql`t."textoBusqueda" ILIKE ${rawPattern} ESCAPE E'\\\\'`,
        );
      }
      const sumarioPredicates = Prisma.sql`(
        s."textoBusquedaNormalizado" LIKE ${normalizedPattern}
        OR s."textoBusqueda" ILIKE ${rawPattern} ESCAPE E'\\\\'
        OR s."tema" ILIKE ${rawPattern} ESCAPE E'\\\\'
        OR s."texto" ILIKE ${rawPattern} ESCAPE E'\\\\'
        OR s."numeroSumario" ILIKE ${rawPattern} ESCAPE E'\\\\'
      )`;
      const referenceBranches = Prisma.sql`
        UNION SELECT r."sentenciaId" AS "id" FROM "ReferenciaNormativa" r
          JOIN "Sentencia" t ON t."id" = r."sentenciaId"
         WHERE ${eligibleSentence('t')} AND (
           ${Prisma.raw(normalizeSql('r."tipoNorma"'))} LIKE ${normalizedPattern} OR
           ${Prisma.raw(normalizeSql('r."numeroNorma"'))} LIKE ${normalizedPattern} OR
           ${Prisma.raw(normalizeSql('r."articulo"'))} LIKE ${normalizedPattern} OR
           ${Prisma.raw(normalizeSql('r."inciso"'))} LIKE ${normalizedPattern} OR
           ${Prisma.raw(normalizeSql('r."textoReferencia"'))} LIKE ${normalizedPattern}
         )
        UNION SELECT r."sentenciaId" AS "id" FROM "ReferenciaJurisprudencial" r
          JOIN "Sentencia" t ON t."id" = r."sentenciaId"
         WHERE ${eligibleSentence('t')} AND (
           ${Prisma.raw(normalizeSql('r."referencia"'))} LIKE ${normalizedPattern} OR
           ${Prisma.raw(normalizeSql('r."textoOriginal"'))} LIKE ${normalizedPattern}
         )
        UNION SELECT r."sentenciaId" AS "id" FROM "ReferenciaDoctrinaria" r
          JOIN "Sentencia" t ON t."id" = r."sentenciaId"
         WHERE ${eligibleSentence('t')} AND (
           ${Prisma.raw(normalizeSql('r."autor"'))} LIKE ${normalizedPattern} OR
           ${Prisma.raw(normalizeSql('r."titulo"'))} LIKE ${normalizedPattern} OR
           ${Prisma.raw(normalizeSql('r."fuente"'))} LIKE ${normalizedPattern} OR
           ${Prisma.raw(normalizeSql('r."textoReferencia"'))} LIKE ${normalizedPattern}
         )
      `;
      return Prisma.sql`
        SELECT t."id" AS "id" FROM "Sentencia" t
         WHERE ${eligibleSentence('t')} AND (${Prisma.join(sentenceTextPredicate, ' OR ')})
        UNION
        SELECT s."sentenciaId" AS "id" FROM "Sumario" s
          JOIN "Sentencia" t ON t."id" = s."sentenciaId"
         WHERE ${eligibleSentence('t')} ${summaryVisibility} AND ${sumarioPredicates}
        ${referenceBranches}
      `;
    };

    const universe = () => Prisma.sql`
      SELECT t."id" AS "id" FROM "Sentencia" t WHERE ${eligibleSentence('t')}
    `;
    const combine = (node: SearchNode | null): Prisma.Sql => {
      if (!node) return universe();
      if (node.type === 'term' || node.type === 'phrase')
        return literalCandidates(node);
      if (node.type === 'not') {
        return Prisma.sql`SELECT "id" FROM (${universe()}) AS "visibleUniverse"
          EXCEPT SELECT "id" FROM (${combine(node.operand)}) AS "excludedCandidates"`;
      }
      const operator = node.type === 'and' ? 'INTERSECT' : 'UNION';
      const operands = node.operands.map(
        (operand, index) => Prisma.sql`
        SELECT "id" FROM (${combine(operand)}) AS ${Prisma.raw(`"candidateOperand${index}"`)}
      `,
      );
      if (!operands.length) return universe();
      return Prisma.sql`(${Prisma.join(operands, ` ${operator} `)})`;
    };

    const result = await this.prisma.$queryRaw<Array<{ id: number }>>(
      Prisma.sql`SELECT DISTINCT "id" FROM (${combine(candidateRoot)}) AS "candidateIds" ORDER BY "id" DESC`,
    );
    return result.map((row) => row.id);
  }

  private buildSearchNodeWhere(
    node: SearchNode,
    mode: SearchMode,
  ): Prisma.SentenciaWhereInput {
    switch (node.type) {
      case 'term':
      case 'phrase':
        return this.buildSearchLiteralWhere(node, mode);
      case 'not':
        return { NOT: this.buildSearchNodeWhere(node.operand, mode) };
      case 'and':
        return {
          AND: node.operands.map((operand) =>
            this.buildSearchNodeWhere(operand, mode),
          ),
        };
      case 'or':
        return {
          OR: node.operands.map((operand) =>
            this.buildSearchNodeWhere(operand, mode),
          ),
        };
    }
  }

  private buildSearchLiteralWhere(
    literal: SearchLiteralNode,
    mode: SearchMode,
  ): Prisma.SentenciaWhereInput {
    if (!literal.field) {
      return {
        OR: this.buildTextTermWhere(
          literal.normalizedValue,
          mode,
          literal.type === 'term' ? literal.matchMode : 'contains',
          literal.value,
        ),
      };
    }

    const matchMode = literal.type === 'term' ? literal.matchMode : 'contains';
    const operation =
      matchMode === 'prefix'
        ? 'startsWith'
        : matchMode === 'suffix'
          ? 'endsWith'
          : 'contains';
    const filter = { [operation]: literal.value, mode: 'insensitive' as const };
    switch (literal.field) {
      case 'tema':
        return {
          sumarios: {
            some: {
              tema: filter,
              ...(mode === 'public' && { publicado: true, activo: true }),
            },
          },
        };
      case 'numeroSumario':
        return {
          sumarios: {
            some: {
              numeroSumario: filter,
              ...(mode === 'public' && { publicado: true, activo: true }),
            },
          },
        };
      case 'sala':
        return { sala: filter };
      case 'tipoFallo':
        return { tipoFallo: filter };
      case 'tribunalOrigen':
        return { tribunalOrigen: filter };
      case 'expediente':
        return { expediente: filter };
      case 'caratula':
        return { caratula: filter };
      case 'actor':
        return { actor: filter };
      case 'demandado':
        return { demandado: filter };
      case 'objeto':
        return { objeto: filter };
      case 'magistrados':
        return { magistrados: filter };
      case 'numeroSentencia':
        return { numeroSentencia: filter };
    }
  }

  private buildTextTermWhere(
    term: string,
    mode: SearchMode,
    matchMode: SearchMatchMode = 'contains',
    rawTerm = term,
  ): Prisma.SentenciaWhereInput[] {
    // The normalized text columns keep accent-insensitive search. Raw text is also
    // searched so an existing precomputed value that collapsed ñ cannot decide a match.
    const rawOperation =
      matchMode === 'prefix'
        ? 'startsWith'
        : matchMode === 'suffix'
          ? 'endsWith'
          : 'contains';
    const rawFilter = { [rawOperation]: rawTerm, mode: 'insensitive' as const };
    return [
      { textoBusquedaNormalizado: { contains: term } },
      { textoBusqueda: rawFilter },
      {
        sumarios: {
          some: {
            OR: [
              { textoBusquedaNormalizado: { contains: term } },
              { textoBusqueda: rawFilter },
              { tema: rawFilter },
              { texto: rawFilter },
              { numeroSumario: rawFilter },
            ],
            ...(mode === 'public' && { publicado: true, activo: true }),
          },
        },
      },
      {
        referenciasNormativas: {
          some: {
            OR: [
              { tipoNorma: rawFilter },
              { numeroNorma: rawFilter },
              { articulo: rawFilter },
              { inciso: rawFilter },
              { textoReferencia: rawFilter },
            ],
          },
        },
      },
      {
        referenciasJurisprudenciales: {
          some: {
            OR: [{ referencia: rawFilter }, { textoOriginal: rawFilter }],
          },
        },
      },
      {
        referenciasDoctrinarias: {
          some: {
            OR: [
              { autor: rawFilter },
              { titulo: rawFilter },
              { fuente: rawFilter },
              { textoReferencia: rawFilter },
            ],
          },
        },
      },
    ];
  }

  private buildSumarioIncludeWhere(
    query: Partial<BusquedaAvanzadaQueryDto>,
    parsed: ParsedSearchQuery,
    mode: SearchMode,
  ): Prisma.SumarioWhereInput | undefined {
    const andClauses: Prisma.SumarioWhereInput[] = [];
    const textTerms = [
      ...parsed.terms,
      ...parsed.exactPhrases,
      ...Object.values(parsed.fieldTerms).flat(),
      ...(query.fraseExacta ? [query.fraseExacta] : []),
    ]
      .map((item) => normalizeSearchText(item))
      .filter(Boolean);

    if (mode === 'public') {
      andClauses.push({ publicado: true, activo: true });
    }

    if (query.tema) {
      andClauses.push({ tema: { contains: query.tema, mode: 'insensitive' } });
    }

    if (query.numeroSumario) {
      andClauses.push({
        numeroSumario: { contains: query.numeroSumario, mode: 'insensitive' },
      });
    }

    if (textTerms.length > 0) {
      andClauses.push({
        OR: textTerms.flatMap((term) => [
          { textoBusquedaNormalizado: { contains: term } },
          { textoBusqueda: { contains: term, mode: 'insensitive' as const } },
          { tema: { contains: term, mode: 'insensitive' as const } },
          { numeroSumario: { contains: term, mode: 'insensitive' as const } },
        ]),
      });
    }

    return andClauses.length ? { AND: andClauses } : undefined;
  }

  private applyFieldTerms(
    parsed: ParsedSearchQuery,
    mode: SearchMode,
  ): Prisma.SentenciaWhereInput {
    const clauses: Prisma.SentenciaWhereInput[] = [];

    if (parsed.fieldTerms.sala?.length) {
      clauses.push({
        sala: {
          contains: parsed.fieldTerms.sala.join(' '),
          mode: 'insensitive',
        },
      });
    }
    if (parsed.fieldTerms.tipoFallo?.length) {
      clauses.push({
        tipoFallo: {
          contains: parsed.fieldTerms.tipoFallo.join(' '),
          mode: 'insensitive',
        },
      });
    }
    if (parsed.fieldTerms.expediente?.length) {
      clauses.push({
        expediente: {
          contains: parsed.fieldTerms.expediente.join(' '),
          mode: 'insensitive',
        },
      });
    }
    if (parsed.fieldTerms.actor?.length) {
      clauses.push({
        actor: {
          contains: parsed.fieldTerms.actor.join(' '),
          mode: 'insensitive',
        },
      });
    }
    if (parsed.fieldTerms.demandado?.length) {
      clauses.push({
        demandado: {
          contains: parsed.fieldTerms.demandado.join(' '),
          mode: 'insensitive',
        },
      });
    }
    if (parsed.fieldTerms.numeroSentencia?.length) {
      clauses.push({
        numeroSentencia: {
          contains: parsed.fieldTerms.numeroSentencia.join(' '),
          mode: 'insensitive',
        },
      });
    }
    if (
      parsed.fieldTerms.tema?.length ||
      parsed.fieldTerms.numeroSumario?.length
    ) {
      clauses.push({
        sumarios: {
          some: {
            ...(parsed.fieldTerms.tema?.length && {
              tema: {
                contains: parsed.fieldTerms.tema.join(' '),
                mode: 'insensitive',
              },
            }),
            ...(parsed.fieldTerms.numeroSumario?.length && {
              numeroSumario: {
                contains: parsed.fieldTerms.numeroSumario.join(' '),
                mode: 'insensitive',
              },
            }),
            ...(mode === 'public' && { publicado: true, activo: true }),
          },
        },
      });
    }

    return clauses.length ? { AND: clauses } : {};
  }

  private matchesLiteral(
    value: string | null | undefined,
    literal: SearchLiteralNode,
  ) {
    const source = normalizeSearchText(value);
    const term = literal.normalizedValue;
    if (!source || !term) return false;
    if (literal.type === 'phrase' || literal.matchMode === 'contains')
      return source.includes(term);

    const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    if (literal.matchMode === 'prefix') {
      return new RegExp(
        `(?:^|[^\\p{L}\\p{N}])${escaped}[\\p{L}\\p{N}]*`,
        'u',
      ).test(source);
    }
    return new RegExp(
      `(?:^|[^\\p{L}\\p{N}])[\\p{L}\\p{N}]*${escaped}(?:$|[^\\p{L}\\p{N}])`,
      'u',
    ).test(source);
  }

  private valuesForSearchField(
    field: SearchFieldName,
    sentencia: SearchCandidate,
    sumarios: SearchCandidate['sumarios'],
    mode: SearchMode,
  ): Array<string | null | undefined> {
    const actor =
      mode === 'public' && sentencia.anonimizado && sentencia.actorPublico
        ? sentencia.actorPublico
        : sentencia.actor;
    const demandado =
      mode === 'public' && sentencia.anonimizado && sentencia.demandadoPublico
        ? sentencia.demandadoPublico
        : sentencia.demandado;

    switch (field) {
      case 'tema':
        return sumarios.map((sumario) => sumario.tema);
      case 'numeroSumario':
        return sumarios.map((sumario) => sumario.numeroSumario);
      case 'sala':
        return [sentencia.sala];
      case 'tipoFallo':
        return [sentencia.tipoFallo];
      case 'tribunalOrigen':
        return [sentencia.tribunalOrigen];
      case 'expediente':
        return [sentencia.expediente];
      case 'caratula':
        return [sentencia.caratula, actor, demandado];
      case 'actor':
        return [actor];
      case 'demandado':
        return [demandado];
      case 'objeto':
        return [sentencia.objeto];
      case 'magistrados':
        return [sentencia.magistrados];
      case 'numeroSentencia':
        return [sentencia.numeroSentencia];
    }
  }

  private matchesSearchAst(
    root: SearchNode | null,
    sentencia: SearchCandidate,
    sumarios: SearchCandidate['sumarios'],
    haystack: string,
    mode: SearchMode,
  ) {
    return evaluateSearchNode(root, (literal) => {
      const values = literal.field
        ? this.valuesForSearchField(literal.field, sentencia, sumarios, mode)
        : [haystack];
      return values.some((value) => this.matchesLiteral(value, literal));
    });
  }

  private scoreCandidate(
    sentencia: SearchCandidate,
    query: Partial<BusquedaAvanzadaQueryDto>,
    parsed: ParsedSearchQuery,
    expandedTerms: string[],
    mode: SearchMode,
  ): ScoredResult | null {
    const areas = new Set(query.buscarEn?.length ? query.buscarEn : ['todo']);
    const sumarios = sentencia.sumarios.filter((sumario) =>
      mode === 'public' ? sumario.publicado && sumario.activo : true,
    );

    if (
      !this.matchesExplicitSentenciaFilters(sentencia, query) ||
      !this.matchesExplicitSumarioFilters(sumarios, query)
    ) {
      return null;
    }

    const highlightsTerms = [
      ...this.getHighlightTerms(query, parsed),
      ...this.getExplicitFilterTerms(query),
    ];
    const exactPhrases = [
      ...parsed.exactPhrases,
      ...(query.fraseExacta ? [query.fraseExacta] : []),
    ];
    const searchTerms = parsed.terms.filter(
      (term) => !Object.values(parsed.fieldTerms).flat().includes(term),
    );

    const actorPublico =
      sentencia.anonimizado && sentencia.actorPublico
        ? sentencia.actorPublico
        : sentencia.actor;
    const demandadoPublico =
      sentencia.anonimizado && sentencia.demandadoPublico
        ? sentencia.demandadoPublico
        : sentencia.demandado;
    const safePublicSentenceText = [
      mode === 'public' && sentencia.publicado && sentencia.activo
        ? sentencia.textoBusqueda
        : null,
      sentencia.numeroSentencia,
      sentencia.expediente,
      sentencia.caratula,
      actorPublico,
      demandadoPublico,
      sentencia.objeto,
      sentencia.magistrados,
      sentencia.sala,
      sentencia.tipoFallo,
      sentencia.tribunalOrigen,
      sentencia.resumenPublicado ? sentencia.resumenIa : null,
      sentencia.resenaPublicada ? sentencia.resena : null,
    ]
      .filter(Boolean)
      .join(' ');
    const referenceText = this.buildReferenceText(sentencia);
    const haystack = normalizeSearchText(
      areas.has('sentencia') || areas.has('todo')
        ? mode === 'public'
          ? safePublicSentenceText
          : [sentencia.textoBusquedaNormalizado, sentencia.textoBusqueda]
              .filter(Boolean)
              .join(' ')
        : '',
      areas.has('sumario') || areas.has('todo')
        ? sumarios
            .flatMap((sumario) => [
              sumario.textoBusquedaNormalizado,
              sumario.textoBusqueda,
              sumario.tema,
              sumario.texto,
              sumario.numeroSumario,
            ])
            .join(' ')
        : '',
      areas.has('referencias') || areas.has('todo') ? referenceText : '',
      mode === 'public' && !sentencia.resumenPublicado
        ? ''
        : areas.has('resumen')
          ? sentencia.resumenIa
          : '',
      mode === 'public' && !sentencia.resenaPublicada
        ? ''
        : areas.has('resena') || areas.has('reseña')
          ? sentencia.resena
          : '',
    );

    if (
      !this.matchesSearchAst(parsed.root, sentencia, sumarios, haystack, mode)
    )
      return null;

    for (const excluded of query.excluir ?? []) {
      const normalizedExcluded = normalizeSearchText(excluded);
      if (normalizedExcluded && haystack.includes(normalizedExcluded)) {
        return null;
      }
    }

    let score = 0;
    let exactPhraseMatches = 0;
    let termMatches = 0;
    let directMatches = 0;
    let synonymMatches = 0;
    const matchedFields = new Set<string>();
    const expandedSet = new Set(
      expandedTerms.map((term) => normalizeSearchText(term)),
    );

    const addIfMatch = (
      source: string | null | undefined,
      term: string,
      weight: number,
      field: string,
    ) => {
      const normalizedSource = normalizeSearchText(source);
      const normalizedTerm = normalizeSearchText(term);
      if (!normalizedSource || !normalizedTerm) {
        return false;
      }

      if (normalizedSource.includes(normalizedTerm)) {
        const isExpanded = expandedSet.has(normalizedTerm);
        score += isExpanded
          ? Math.round(weight * SCORE_WEIGHTS.synonymMatchPenalty)
          : weight;
        if (isExpanded) {
          synonymMatches += 1;
        } else {
          directMatches += 1;
          score += SCORE_WEIGHTS.directMatchBonus;
        }
        matchedFields.add(field);
        return true;
      }

      return false;
    };

    for (const phrase of exactPhrases) {
      let matched = false;
      matched =
        addIfMatch(
          sentencia.numeroSentencia,
          phrase,
          SCORE_WEIGHTS.exactNumeroExpediente,
          'numeroSentencia',
        ) ||
        addIfMatch(
          sentencia.expediente,
          phrase,
          SCORE_WEIGHTS.exactNumeroExpediente,
          'expediente',
        ) ||
        sumarios.some((sumario) =>
          addIfMatch(
            sumario.numeroSumario,
            phrase,
            SCORE_WEIGHTS.exactNumeroExpediente,
            'numeroSumario',
          ),
        ) ||
        sumarios.some((sumario) =>
          addIfMatch(sumario.tema, phrase, SCORE_WEIGHTS.exactTema, 'tema'),
        ) ||
        addIfMatch(
          sentencia.resumenIa,
          phrase,
          SCORE_WEIGHTS.exactResumen,
          'resumen',
        ) ||
        addIfMatch(
          sentencia.resena,
          phrase,
          SCORE_WEIGHTS.exactResena,
          'resena',
        ) ||
        sumarios.some((sumario) =>
          addIfMatch(
            sumario.textoBusqueda,
            phrase,
            SCORE_WEIGHTS.exactSumario,
            'sumario',
          ),
        ) ||
        addIfMatch(
          sentencia.caratula,
          phrase,
          SCORE_WEIGHTS.exactCampoPrincipal,
          'caratula',
        ) ||
        addIfMatch(
          sentencia.actor,
          phrase,
          SCORE_WEIGHTS.exactCampoPrincipal,
          'actor',
        ) ||
        addIfMatch(
          sentencia.demandado,
          phrase,
          SCORE_WEIGHTS.exactCampoPrincipal,
          'demandado',
        ) ||
        addIfMatch(
          sentencia.objeto,
          phrase,
          SCORE_WEIGHTS.exactCampoPrincipal,
          'objeto',
        ) ||
        addIfMatch(
          sentencia.magistrados,
          phrase,
          SCORE_WEIGHTS.exactCampoPrincipal,
          'magistrados',
        ) ||
        addIfMatch(
          sentencia.sala,
          phrase,
          SCORE_WEIGHTS.termSecundario,
          'sala',
        ) ||
        addIfMatch(
          sentencia.tipoFallo,
          phrase,
          SCORE_WEIGHTS.termSecundario,
          'tipoFallo',
        ) ||
        addIfMatch(
          sentencia.tribunalOrigen,
          phrase,
          SCORE_WEIGHTS.termSecundario,
          'tribunalOrigen',
        ) ||
        (mode === 'public' && sentencia.publicado && sentencia.activo
          ? addIfMatch(
              sentencia.textoBusqueda,
              phrase,
              SCORE_WEIGHTS.exactSumario,
              'fallo',
            )
          : false) ||
        addIfMatch(
          referenceText,
          phrase,
          SCORE_WEIGHTS.termSecundario,
          'referencias',
        );

      if (matched) exactPhraseMatches += 1;
    }

    if (searchTerms.length > 0) {
      const matchedTerms = searchTerms.filter((term) => {
        const termMatched =
          addIfMatch(
            sentencia.numeroSentencia,
            term,
            SCORE_WEIGHTS.termNumeroExpediente,
            'numeroSentencia',
          ) ||
          addIfMatch(
            sentencia.expediente,
            term,
            SCORE_WEIGHTS.termNumeroExpediente,
            'expediente',
          ) ||
          sumarios.some((sumario) =>
            addIfMatch(
              sumario.numeroSumario,
              term,
              SCORE_WEIGHTS.termNumeroExpediente,
              'numeroSumario',
            ),
          ) ||
          sumarios.some((sumario) =>
            addIfMatch(sumario.tema, term, SCORE_WEIGHTS.termTema, 'tema'),
          ) ||
          addIfMatch(
            sentencia.resumenIa,
            term,
            SCORE_WEIGHTS.termResumen,
            'resumen',
          ) ||
          addIfMatch(
            sentencia.resena,
            term,
            SCORE_WEIGHTS.termResena,
            'resena',
          ) ||
          sumarios.some((sumario) =>
            addIfMatch(
              sumario.textoBusqueda,
              term,
              SCORE_WEIGHTS.termSumario,
              'sumario',
            ),
          ) ||
          addIfMatch(
            sentencia.actor,
            term,
            SCORE_WEIGHTS.termActorDemandadoCaratula,
            'actor',
          ) ||
          addIfMatch(
            sentencia.demandado,
            term,
            SCORE_WEIGHTS.termActorDemandadoCaratula,
            'demandado',
          ) ||
          addIfMatch(
            sentencia.objeto,
            term,
            SCORE_WEIGHTS.termObjeto,
            'objeto',
          ) ||
          addIfMatch(
            sentencia.magistrados,
            term,
            SCORE_WEIGHTS.termMagistrados,
            'magistrados',
          ) ||
          addIfMatch(
            sentencia.caratula,
            term,
            SCORE_WEIGHTS.termActorDemandadoCaratula,
            'caratula',
          ) ||
          addIfMatch(
            sentencia.sala,
            term,
            SCORE_WEIGHTS.termSecundario,
            'sala',
          ) ||
          addIfMatch(
            sentencia.tipoFallo,
            term,
            SCORE_WEIGHTS.termSecundario,
            'tipoFallo',
          ) ||
          addIfMatch(
            sentencia.tribunalOrigen,
            term,
            SCORE_WEIGHTS.termSecundario,
            'tribunalOrigen',
          ) ||
          (mode === 'public' && sentencia.publicado && sentencia.activo
            ? addIfMatch(
                sentencia.textoBusqueda,
                term,
                SCORE_WEIGHTS.termSumario,
                'fallo',
              )
            : false) ||
          addIfMatch(
            referenceText,
            term,
            SCORE_WEIGHTS.termSecundario,
            'referencias',
          );

        return termMatched;
      });
      termMatches = matchedTerms.length;
    }

    if (parsed.fieldTerms.tema?.length) {
      score += SCORE_WEIGHTS.fieldFilterMatch;
      matchedFields.add('tema');
    }
    if (parsed.fieldTerms.numeroSumario?.length) {
      score += SCORE_WEIGHTS.fieldFilterMatch;
      matchedFields.add('numeroSumario');
    }

    const addFilterMatch = (active: unknown, field: string) => {
      if (active !== undefined && active !== null && active !== '') {
        score += SCORE_WEIGHTS.fieldFilterMatch;
        matchedFields.add(field);
      }
    };

    addFilterMatch(query.numeroSentencia, 'numeroSentencia');
    addFilterMatch(query.numeroSumario, 'numeroSumario');
    addFilterMatch(query.expediente, 'expediente');
    addFilterMatch(query.caratula, 'caratula');
    addFilterMatch(query.actor, 'actor');
    addFilterMatch(query.demandado, 'demandado');
    addFilterMatch(query.objeto, 'objeto');
    addFilterMatch(query.magistrados, 'magistrados');
    addFilterMatch(query.sala, 'sala');
    addFilterMatch(query.tipoFallo, 'tipoFallo');
    addFilterMatch(query.tribunalOrigen, 'tribunalOrigen');
    addFilterMatch(query.tema, 'tema');
    addFilterMatch(query.anio, 'anio');
    addFilterMatch(query.fechaDesde || query.fechaHasta, 'fecha');
    addFilterMatch(query.publicado, 'publicado');
    addFilterMatch(query.activo, 'estado');
    addFilterMatch(query.destacada, 'destacada');
    addFilterMatch(query.soloConResumen, 'resumen');
    if (this.resolvePdfFilter(query) !== 'todos') {
      addFilterMatch(true, 'pdf');
    }

    if (sentencia.destacada) {
      score += SCORE_WEIGHTS.destacadaBonus;
    }
    const pdfFilter = this.resolvePdfFilter(query);
    if (
      !this.matchesPdfFilter(
        sentencia.id,
        sentencia.tienePdf,
        sentencia.archivosPdf,
        pdfFilter,
      )
    ) {
      return null;
    }
    const pdfReal = sentenciaTienePdfReal(sentencia.archivosPdf);

    if (pdfReal.disponible && pdfFilter !== 'todos') {
      score += SCORE_WEIGHTS.pdfBonus;
    }
    if (sentencia.resenaPublicada) {
      score += SCORE_WEIGHTS.resenaPublicadaBonus;
    }
    if (mode === 'public' && sentencia.publicado) {
      score += SCORE_WEIGHTS.publicadaBonus;
    }

    if (!query.q && !query.fraseExacta && matchedFields.size === 0) {
      score = 0;
    }

    const highlights = this.buildHighlights(
      sentencia,
      sumarios,
      highlightsTerms,
    );
    const resumenBreve =
      sentencia.resumenIa?.slice(0, 260) ??
      sentencia.resena?.slice(0, 260) ??
      null;
    const criterioPrincipal = this.resolveCriterioPrincipal(matchedFields);
    const publicParts = [actorPublico, demandadoPublico]
      .filter(Boolean)
      .join(' c/ ');
    const caratulaPublica =
      mode === 'public' && sentencia.anonimizado
        ? publicParts || sentencia.caratula
        : sentencia.caratula;

    return {
      sentencia: {
        id: sentencia.id,
        legacyCorpus: Boolean(
          mode === 'public' &&
          sentencia.publicado &&
          sumarios.length === 0 &&
          sentencia.textoBusqueda,
        ),
        slugPublico: sentencia.slugPublico,
        caratula: caratulaPublica,
        numeroSentencia: sentencia.numeroSentencia,
        tipoFallo: sentencia.tipoFallo,
        sala: sentencia.sala,
        fecha: sentencia.fecha,
        expediente: sentencia.expediente,
        actor: mode === 'public' ? actorPublico : sentencia.actor,
        demandado: mode === 'public' ? demandadoPublico : sentencia.demandado,
        objeto: sentencia.objeto,
        magistrados: sentencia.magistrados,
        tribunalOrigen: sentencia.tribunalOrigen,
        publicado: sentencia.publicado,
        activo: sentencia.activo,
        destacada: sentencia.destacada,
        tienePdf: pdfReal.disponible,
        pdfDisponible: pdfReal.disponible,
        archivoPdfId: pdfReal.archivoPdfId,
        resumenPublicado: sentencia.resumenPublicado,
        extractoFallo:
          mode === 'public' &&
          sentencia.publicado &&
          sentencia.activo &&
          sumarios.length === 0
            ? buildDocumentExcerpt(sentencia.textoBusqueda, highlightsTerms[0])
            : null,
      },
      cantidadSumarios: sentencia._count.sumarios,
      cantidadPdfs: pdfReal.cantidad,
      resumenBreve,
      relevancia: score,
      score,
      criterioPrincipal,
      fragmentos: highlights.map((item) => item.texto),
      highlights,
      matchedFields: [...matchedFields],
      matchInfo: {
        exactPhraseMatches,
        termMatches,
        matchedFields: [...matchedFields],
        directMatches,
        synonymMatches,
      },
      sumariosRelevantes: sumarios.slice(0, mode === 'public' ? 3 : 10),
    };
  }

  private getHighlightTerms(
    query: Partial<BusquedaAvanzadaQueryDto>,
    parsed: ParsedSearchQuery,
  ) {
    return [
      ...parsed.exactPhrases,
      ...(query.fraseExacta ? [query.fraseExacta] : []),
      ...(query.q && !parsed.exactPhrases.includes(query.q) ? [query.q] : []),
      ...parsed.terms,
      ...Object.values(parsed.fieldTerms).flat(),
    ].filter(Boolean);
  }

  private getExplicitFilterTerms(
    query: Partial<BusquedaAvanzadaQueryDto> | PublicBusquedaQueryDto,
  ) {
    return [
      query.tema,
      query.sala,
      query.tipoFallo,
      query.tribunalOrigen,
      query.numeroSentencia,
      query.numeroSumario,
      query.expediente,
      query.caratula,
      'actor' in query ? query.actor : undefined,
      'demandado' in query ? query.demandado : undefined,
      'objeto' in query ? query.objeto : undefined,
      query.magistrados,
      query.anio !== undefined ? String(query.anio) : undefined,
    ].filter((item): item is string => Boolean(item));
  }

  private scorePublicCandidate(
    candidate: PublicSearchCandidate,
    query: PublicBusquedaQueryDto,
    parsed: ParsedSearchQuery,
    expandedTerms: string[],
  ): PublicSearchResult | null {
    const sentencia = candidate.sentencia;
    const searchTerms = [
      ...this.getHighlightTerms({ q: query.q }, parsed),
      ...this.getExplicitFilterTerms(query),
    ];
    const exactPhrases = parsed.exactPhrases;
    const excludedTerms = [...parsed.excludedTerms, ...parsed.excludedPhrases];
    const actorPublico =
      sentencia.anonimizado && sentencia.actorPublico
        ? sentencia.actorPublico
        : sentencia.actor;
    const demandadoPublico =
      sentencia.anonimizado && sentencia.demandadoPublico
        ? sentencia.demandadoPublico
        : sentencia.demandado;

    if (
      !this.matchesExplicitSentenciaFilters(sentencia, query) ||
      !this.matchesExplicitSumarioFilters([candidate], query)
    ) {
      return null;
    }
    const haystack = normalizeSearchText(
      candidate.tema,
      candidate.texto,
      candidate.numeroSumario,
      sentencia.numeroSentencia,
      sentencia.expediente,
      sentencia.caratula,
      sentencia.resumenPublicado ? sentencia.resumenIa : '',
      sentencia.resenaPublicada ? sentencia.resena : '',
      actorPublico,
      demandadoPublico,
      sentencia.magistrados,
      sentencia.sala,
      sentencia.tipoFallo,
      sentencia.tribunalOrigen,
      this.buildReferenceText(sentencia),
    );

    for (const excluded of excludedTerms) {
      const normalizedExcluded = normalizeSearchText(excluded);
      if (normalizedExcluded && haystack.includes(normalizedExcluded)) {
        return null;
      }
    }

    let score = 0;
    let directMatches = 0;
    let synonymMatches = 0;
    let termMatches = 0;
    let exactPhraseMatches = 0;
    const matchedFields = new Set<string>();
    const expandedSet = new Set(
      expandedTerms.map((term) => normalizeSearchText(term)),
    );

    const addIfMatch = (
      source: string | null | undefined,
      term: string,
      weight: number,
      field: string,
    ) => {
      const normalizedSource = normalizeSearchText(source);
      const normalizedTerm = normalizeSearchText(term);
      if (!normalizedSource || !normalizedTerm) {
        return false;
      }

      if (normalizedSource.includes(normalizedTerm)) {
        const isExpanded = expandedSet.has(normalizedTerm);
        score += isExpanded
          ? Math.round(weight * SCORE_WEIGHTS.synonymMatchPenalty)
          : weight;
        if (isExpanded) {
          synonymMatches += 1;
        } else {
          directMatches += 1;
          score += SCORE_WEIGHTS.directMatchBonus;
        }
        matchedFields.add(field);
        return true;
      }

      return false;
    };

    for (const phrase of exactPhrases) {
      const matched =
        addIfMatch(
          sentencia.numeroSentencia,
          phrase,
          SCORE_WEIGHTS.exactNumeroExpediente,
          'numeroSentencia',
        ) ||
        addIfMatch(
          sentencia.expediente,
          phrase,
          SCORE_WEIGHTS.exactNumeroExpediente,
          'expediente',
        ) ||
        addIfMatch(
          candidate.numeroSumario,
          phrase,
          SCORE_WEIGHTS.exactNumeroExpediente,
          'numeroSumario',
        ) ||
        addIfMatch(candidate.tema, phrase, SCORE_WEIGHTS.exactTema, 'tema') ||
        addIfMatch(
          sentencia.caratula,
          phrase,
          SCORE_WEIGHTS.exactCampoPrincipal,
          'caratula',
        ) ||
        addIfMatch(
          sentencia.resumenPublicado ? sentencia.resumenIa : '',
          phrase,
          SCORE_WEIGHTS.exactResumen,
          'resumen',
        ) ||
        addIfMatch(
          sentencia.resenaPublicada ? sentencia.resena : '',
          phrase,
          SCORE_WEIGHTS.exactResena,
          'resena',
        ) ||
        addIfMatch(
          candidate.texto,
          phrase,
          SCORE_WEIGHTS.exactSumario,
          'sumario',
        ) ||
        addIfMatch(
          sentencia.magistrados,
          phrase,
          SCORE_WEIGHTS.exactCampoPrincipal,
          'magistrados',
        ) ||
        addIfMatch(
          sentencia.sala,
          phrase,
          SCORE_WEIGHTS.termSecundario,
          'sala',
        ) ||
        addIfMatch(
          sentencia.tipoFallo,
          phrase,
          SCORE_WEIGHTS.termSecundario,
          'tipoFallo',
        ) ||
        addIfMatch(
          sentencia.tribunalOrigen,
          phrase,
          SCORE_WEIGHTS.termSecundario,
          'tribunalOrigen',
        ) ||
        addIfMatch(
          this.buildReferenceText(sentencia),
          phrase,
          SCORE_WEIGHTS.termSecundario,
          'referencias',
        );

      if (!matched) {
        return null;
      }
      exactPhraseMatches += 1;
    }

    for (const term of parsed.terms) {
      const matched =
        addIfMatch(
          sentencia.numeroSentencia,
          term,
          SCORE_WEIGHTS.termNumeroExpediente,
          'numeroSentencia',
        ) ||
        addIfMatch(
          sentencia.expediente,
          term,
          SCORE_WEIGHTS.termNumeroExpediente,
          'expediente',
        ) ||
        addIfMatch(
          candidate.numeroSumario,
          term,
          SCORE_WEIGHTS.termNumeroExpediente,
          'numeroSumario',
        ) ||
        addIfMatch(candidate.tema, term, SCORE_WEIGHTS.termTema, 'tema') ||
        addIfMatch(
          sentencia.resumenPublicado ? sentencia.resumenIa : '',
          term,
          SCORE_WEIGHTS.termResumen,
          'resumen',
        ) ||
        addIfMatch(
          sentencia.resenaPublicada ? sentencia.resena : '',
          term,
          SCORE_WEIGHTS.termResena,
          'resena',
        ) ||
        addIfMatch(
          candidate.texto,
          term,
          SCORE_WEIGHTS.termSumario,
          'sumario',
        ) ||
        addIfMatch(
          actorPublico,
          term,
          SCORE_WEIGHTS.termActorDemandadoCaratula,
          'actor',
        ) ||
        addIfMatch(
          demandadoPublico,
          term,
          SCORE_WEIGHTS.termActorDemandadoCaratula,
          'demandado',
        ) ||
        addIfMatch(
          sentencia.magistrados,
          term,
          SCORE_WEIGHTS.termMagistrados,
          'magistrados',
        ) ||
        addIfMatch(
          sentencia.caratula,
          term,
          SCORE_WEIGHTS.termActorDemandadoCaratula,
          'caratula',
        ) ||
        addIfMatch(
          sentencia.sala,
          term,
          SCORE_WEIGHTS.termSecundario,
          'sala',
        ) ||
        addIfMatch(
          sentencia.tipoFallo,
          term,
          SCORE_WEIGHTS.termSecundario,
          'tipoFallo',
        ) ||
        addIfMatch(
          sentencia.tribunalOrigen,
          term,
          SCORE_WEIGHTS.termSecundario,
          'tribunalOrigen',
        ) ||
        addIfMatch(
          this.buildReferenceText(sentencia),
          term,
          SCORE_WEIGHTS.termSecundario,
          'referencias',
        );

      if (matched) {
        termMatches += 1;
      }
    }

    if (query.tema) {
      score += SCORE_WEIGHTS.fieldFilterMatch;
      matchedFields.add('tema');
    }
    if (query.numeroSumario) {
      score += SCORE_WEIGHTS.fieldFilterMatch;
      matchedFields.add('numeroSumario');
    }
    if (query.numeroSentencia) {
      score += SCORE_WEIGHTS.fieldFilterMatch;
      matchedFields.add('numeroSentencia');
    }
    if (query.expediente) {
      score += SCORE_WEIGHTS.fieldFilterMatch;
      matchedFields.add('expediente');
    }
    if (query.magistrados) {
      score += SCORE_WEIGHTS.fieldFilterMatch;
      matchedFields.add('magistrados');
    }
    if (query.caratula) {
      score += SCORE_WEIGHTS.fieldFilterMatch;
      matchedFields.add('caratula');
    }
    if (query.sala) {
      score += SCORE_WEIGHTS.fieldFilterMatch;
      matchedFields.add('sala');
    }
    if (query.tipoFallo) {
      score += SCORE_WEIGHTS.fieldFilterMatch;
      matchedFields.add('tipoFallo');
    }
    if (query.tribunalOrigen) {
      score += SCORE_WEIGHTS.fieldFilterMatch;
      matchedFields.add('tribunalOrigen');
    }
    if (query.anio) {
      score += SCORE_WEIGHTS.fieldFilterMatch;
      matchedFields.add('anio');
    }
    if (query.fechaDesde || query.fechaHasta) {
      score += SCORE_WEIGHTS.fieldFilterMatch;
      matchedFields.add('fecha');
    }
    if (this.resolvePdfFilter(query) !== 'todos') {
      score += SCORE_WEIGHTS.fieldFilterMatch;
      matchedFields.add('pdf');
    }

    const pdfFilter = this.resolvePdfFilter(query);
    if (
      !this.matchesPdfFilter(
        sentencia.id,
        sentencia.tienePdf,
        sentencia.archivosPdf,
        pdfFilter,
      )
    ) {
      return null;
    }
    const pdfReal = sentenciaTienePdfReal(sentencia.archivosPdf);

    if (sentencia.publicado) score += SCORE_WEIGHTS.publicadaBonus;
    if (pdfReal.disponible && pdfFilter !== 'todos')
      score += SCORE_WEIGHTS.pdfBonus;
    if (sentencia.resenaPublicada) score += SCORE_WEIGHTS.resenaPublicadaBonus;
    if ((candidate.sentencia as { destacada?: boolean }).destacada)
      score += SCORE_WEIGHTS.destacadaBonus;

    const highlights = this.buildPublicHighlights(candidate, searchTerms);
    const criterioPrincipal = this.resolveCriterioPrincipal(matchedFields);

    return {
      id: candidate.id,
      sentenciaId: sentencia.id,
      slugPublico: sentencia.slugPublico,
      numeroSumario: candidate.numeroSumario,
      numeroSentencia: sentencia.numeroSentencia,
      fecha: sentencia.fecha,
      sala: sentencia.sala,
      magistrados: sentencia.magistrados,
      tipoFallo: sentencia.tipoFallo,
      expediente: sentencia.expediente,
      tribunalOrigen: sentencia.tribunalOrigen,
      caratula: sentencia.caratula,
      actor: actorPublico,
      demandado: demandadoPublico,
      tema: candidate.tema,
      textoSumario: candidate.texto,
      highlights,
      tienePdf: pdfReal.disponible,
      pdfDisponible: pdfReal.disponible,
      archivoPdfId: pdfReal.archivoPdfId,
      pdfUrl:
        sentencia.slugPublico && pdfReal.disponible
          ? `/api/public/sentencias/${sentencia.slugPublico}/pdf`
          : null,
      score,
      criterioPrincipal,
      matchedFields: [...matchedFields],
      matchInfo: {
        exactPhraseMatches,
        termMatches,
        matchedFields: [...matchedFields],
        directMatches,
        synonymMatches,
      },
    };
  }

  private async applySemanticBonus<
    T extends { score: number; matchInfo: MatchInfo },
  >(results: T[], q?: string): Promise<T[]> {
    const query = q?.trim();
    if (!query || !results.length) {
      return results.map((result) => ({
        ...result,
        matchInfo: {
          ...result.matchInfo,
          textualScore: result.score,
          semanticScore: 0,
          finalScore: result.score,
        },
      }));
    }

    const similares = await Promise.race([
      this.ragService.buscarFallosSimilares(query, 30),
      new Promise<[]>((resolve) => setTimeout(() => resolve([]), 2500)),
    ]).catch(() => []);

    if (!similares.length) {
      return results.map((result) => ({
        ...result,
        matchInfo: {
          ...result.matchInfo,
          textualScore: result.score,
          semanticScore: 0,
          finalScore: result.score,
        },
      }));
    }

    const scoreBySentencia = new Map<number, number>();
    for (const item of similares) {
      scoreBySentencia.set(item.id, Math.max(0, item.scoreSimilitud));
    }

    return results.map((result) => {
      const sentenciaId =
        'sentencia' in result
          ? (result as T & { sentencia: { id: number } }).sentencia.id
          : (result as T & { sentenciaId?: number }).sentenciaId;
      const semanticScore = sentenciaId
        ? (scoreBySentencia.get(sentenciaId) ?? 0)
        : 0;
      const bonus = Math.round(semanticScore * 25);
      const finalScore = result.score + bonus;

      return {
        ...result,
        score: finalScore,
        relevancia: 'relevancia' in result ? finalScore : undefined,
        matchInfo: {
          ...result.matchInfo,
          textualScore: result.score,
          semanticScore,
          finalScore,
        },
      };
    });
  }

  private buildPublicHighlights(
    candidate: PublicSearchCandidate,
    searchTerms: string[],
  ) {
    const highlights: HighlightItem[] = [];
    const pushHighlight = (item: HighlightItem | null) => {
      if (!item) {
        return;
      }
      if (
        highlights.some(
          (existing) =>
            existing.campo === item.campo && existing.texto === item.texto,
        )
      ) {
        return;
      }
      highlights.push(item);
    };

    pushHighlight(buildHighlight('tema', candidate.tema, searchTerms));
    pushHighlight(buildHighlight('sumario', candidate.texto, searchTerms));
    pushHighlight(
      buildHighlight(
        'numeroSentencia',
        candidate.sentencia.numeroSentencia,
        searchTerms,
      ),
    );
    pushHighlight(
      buildHighlight('expediente', candidate.sentencia.expediente, searchTerms),
    );
    pushHighlight(
      buildHighlight(
        'magistrados',
        candidate.sentencia.magistrados,
        searchTerms,
      ),
    );
    pushHighlight(
      buildHighlight('sala', candidate.sentencia.sala, searchTerms),
    );
    pushHighlight(
      buildHighlight('tipoFallo', candidate.sentencia.tipoFallo, searchTerms),
    );
    pushHighlight(
      buildHighlight(
        'tribunalOrigen',
        candidate.sentencia.tribunalOrigen,
        searchTerms,
      ),
    );
    pushHighlight(
      buildHighlight(
        'resumen',
        candidate.sentencia.resumenPublicado
          ? candidate.sentencia.resumenIa
          : '',
        searchTerms,
      ),
    );
    pushHighlight(
      buildHighlight(
        'resena',
        candidate.sentencia.resenaPublicada ? candidate.sentencia.resena : '',
        searchTerms,
      ),
    );
    pushHighlight(
      buildHighlight('caratula', candidate.sentencia.caratula, searchTerms),
    );

    return highlights.slice(0, 3);
  }

  private buildHighlights(
    sentencia: SearchCandidate,
    sumarios: SearchCandidate['sumarios'],
    searchTerms: string[],
  ) {
    const highlights: HighlightItem[] = [];
    const pushHighlight = (item: HighlightItem | null) => {
      if (!item) {
        return;
      }
      if (
        highlights.some(
          (existing) =>
            existing.campo === item.campo && existing.texto === item.texto,
        )
      ) {
        return;
      }
      highlights.push(item);
    };

    pushHighlight(buildHighlight('resumen', sentencia.resumenIa, searchTerms));
    pushHighlight(buildHighlight('resena', sentencia.resena, searchTerms));
    pushHighlight(
      buildHighlight('numeroSentencia', sentencia.numeroSentencia, searchTerms),
    );
    pushHighlight(
      buildHighlight('expediente', sentencia.expediente, searchTerms),
    );
    pushHighlight(buildHighlight('caratula', sentencia.caratula, searchTerms));
    pushHighlight(buildHighlight('objeto', sentencia.objeto, searchTerms));
    pushHighlight(buildHighlight('actor', sentencia.actor, searchTerms));
    pushHighlight(
      buildHighlight('demandado', sentencia.demandado, searchTerms),
    );
    pushHighlight(
      buildHighlight('magistrados', sentencia.magistrados, searchTerms),
    );
    pushHighlight(buildHighlight('sala', sentencia.sala, searchTerms));
    pushHighlight(
      buildHighlight('tipoFallo', sentencia.tipoFallo, searchTerms),
    );
    pushHighlight(
      buildHighlight('tribunalOrigen', sentencia.tribunalOrigen, searchTerms),
    );

    for (const sumario of sumarios) {
      if (highlights.length >= 4) {
        break;
      }
      pushHighlight(buildHighlight('tema', sumario.tema, searchTerms));
      pushHighlight(buildHighlight('sumario', sumario.texto, searchTerms));
    }

    return highlights.slice(0, 3);
  }

  private resolveCriterioPrincipal(matchedFields: Set<string>) {
    const priority = [
      'numeroSentencia',
      'numeroSumario',
      'expediente',
      'tema',
      'resumen',
      'resena',
      'sumario',
      'actor',
      'demandado',
      'objeto',
      'referencias',
      'magistrados',
      'caratula',
      'sala',
      'tipoFallo',
      'tribunalOrigen',
      'fecha',
      'anio',
      'pdf',
      'publicado',
      'estado',
      'destacada',
    ];

    return priority.find((item) => matchedFields.has(item)) ?? null;
  }

  private sortResults(
    results: ScoredResult[],
    sortBy: SortKey,
    sortOrder: Partial<BusquedaAvanzadaQueryDto>['sortOrder'],
    hasTextSearch: boolean,
  ) {
    const effectiveSort = sortBy ?? (hasTextSearch ? 'relevancia' : 'fecha');
    const direction = sortOrder === 'asc' ? 1 : -1;

    return [...results].sort((left, right) => {
      if (effectiveSort === 'relevancia') {
        if (left.score !== right.score) {
          return (left.score - right.score) * -1 * direction;
        }
        const leftDate = left.sentencia.fecha
          ? new Date(left.sentencia.fecha).getTime()
          : 0;
        const rightDate = right.sentencia.fecha
          ? new Date(right.sentencia.fecha).getTime()
          : 0;
        return (leftDate - rightDate) * -1;
      }
      if (effectiveSort === 'sala') {
        return (
          (left.sentencia.sala ?? '').localeCompare(
            right.sentencia.sala ?? '',
          ) * direction
        );
      }
      if (effectiveSort === 'numeroSentencia') {
        return (
          (left.sentencia.numeroSentencia ?? '').localeCompare(
            right.sentencia.numeroSentencia ?? '',
          ) * direction
        );
      }

      const leftDate = left.sentencia.fecha
        ? new Date(left.sentencia.fecha).getTime()
        : 0;
      const rightDate = right.sentencia.fecha
        ? new Date(right.sentencia.fecha).getTime()
        : 0;

      return (leftDate - rightDate) * direction;
    });
  }

  private sortPublicResults(
    results: PublicSearchResult[],
    sortBy: PublicSortKey,
    sortOrder: NonNullable<PublicBusquedaQueryDto['sortOrder']>,
  ) {
    const direction = sortOrder === 'asc' ? 1 : -1;

    return [...results].sort((left, right) => {
      if (sortBy === 'relevancia') {
        if (left.score !== right.score) {
          return (left.score - right.score) * -1 * direction;
        }
        const leftDate = left.fecha ? new Date(left.fecha).getTime() : 0;
        const rightDate = right.fecha ? new Date(right.fecha).getTime() : 0;
        return (leftDate - rightDate) * -1;
      }
      if (sortBy === 'sala') {
        return (left.sala ?? '').localeCompare(right.sala ?? '') * direction;
      }
      if (sortBy === 'numeroSentencia') {
        return (
          (left.numeroSentencia ?? '').localeCompare(
            right.numeroSentencia ?? '',
          ) * direction
        );
      }

      const leftDate = left.fecha ? new Date(left.fecha).getTime() : 0;
      const rightDate = right.fecha ? new Date(right.fecha).getTime() : 0;
      return (leftDate - rightDate) * direction;
    });
  }

  private paginateResults(
    data: ScoredResult[],
    page: number,
    pageSize: number,
    sortUsed: SortKey,
    expandedTerms: string[],
    totalOverride?: number,
    alreadyPaginated = false,
    totalExact = true,
    hasMore = false,
  ) {
    const total = totalOverride ?? data.length;
    const slice = alreadyPaginated
      ? data
      : data.slice((page - 1) * pageSize, page * pageSize);

    return {
      data: slice,
      meta: {
        total,
        page,
        pageSize,
        pageCount: Math.ceil(total / pageSize),
        totalExact,
        hasMore,
        sortUsed,
        expandedTerms,
      },
    };
  }

  private paginatePublicResults(
    data: PublicSearchResult[],
    page: number,
    pageSize: number,
    sortUsed: PublicSortKey,
    expandedTerms: string[],
    totalOverride?: number,
    alreadyPaginated = false,
    totalExact = true,
    hasMore = false,
  ) {
    const total = totalOverride ?? data.length;
    const slice = alreadyPaginated
      ? data.slice(0, pageSize)
      : data.slice((page - 1) * pageSize, page * pageSize);

    return {
      data: slice,
      meta: {
        total,
        page,
        pageSize,
        pageCount: Math.ceil(total / pageSize),
        totalExact,
        hasMore,
        sortUsed,
        expandedTerms,
      },
    };
  }

  private toCsv(results: ScoredResult[]) {
    const header = [
      'id',
      'caratula',
      'numeroSentencia',
      'sala',
      'tipoFallo',
      'fecha',
      'expediente',
      'resumenBreve',
      'score',
      'cantidadSumarios',
      'cantidadPdfs',
    ];

    const lines = results.map((result) =>
      [
        result.sentencia.id,
        result.sentencia.caratula ?? '',
        result.sentencia.numeroSentencia ?? '',
        result.sentencia.sala ?? '',
        result.sentencia.tipoFallo ?? '',
        result.sentencia.fecha?.toISOString() ?? '',
        result.sentencia.expediente ?? '',
        result.resumenBreve ?? '',
        result.score,
        result.cantidadSumarios,
        result.cantidadPdfs,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(','),
    );

    return [header.join(','), ...lines].join('\n');
  }

  private toTxt(results: ScoredResult[]) {
    return results
      .map((result) =>
        [
          `Sentencia #${result.sentencia.id}`,
          `${result.sentencia.caratula ?? 'Sin caratula'}`,
          `Sala: ${result.sentencia.sala ?? '-'}`,
          `Fecha: ${result.sentencia.fecha?.toISOString() ?? '-'}`,
          `Expediente: ${result.sentencia.expediente ?? '-'}`,
          `Score: ${result.score}`,
          `Resumen: ${result.resumenBreve ?? '-'}`,
        ].join('\n'),
      )
      .join('\n\n');
  }
}

function roundProfile(value: number) {
  return Math.round(value * 100) / 100;
}

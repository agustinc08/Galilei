import {
  Controller,
  Get,
  Query,
  PayloadTooLargeException,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ROLES } from '../auth/constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { BusquedaService } from './busqueda.service';
import { BusquedaAvanzadaQueryDto } from './dto/busqueda-avanzada-query.dto';
import { ExportarBusquedaQueryDto } from './dto/exportar-busqueda-query.dto';
import { PublicBusquedaQueryDto } from './dto/public-busqueda-query.dto';
import { SugerenciasQueryDto } from './dto/sugerencias-query.dto';
import type { SearchResult } from './adapters/search-source.adapter';

@ApiTags('busqueda')
@ApiBearerAuth()
@Roles(
  ROLES.ADMIN,
  ROLES.OPERADOR,
  ROLES.LECTOR,
  ROLES.REVISOR,
  ROLES.JURISPRUDENCIA,
  ROLES.DIGESTO,
)
@Controller('busqueda')
export class BusquedaController {
  constructor(private readonly busquedaService: BusquedaService) {}

  @Get('avanzada')
  @ApiOperation({ summary: 'Búsqueda avanzada interna' })
  async avanzada(
    @Query() query: BusquedaAvanzadaQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const startedAt = performance.now();
    const corpusOnlyFilter = Boolean(
      query.digestoCollectionId || query.digestoTopicId || query.digestoTagId,
    );
    const federatedStartedAt = performance.now();
    const federated = await this.busquedaService.federatedSearch(
      query.q,
      query.operador,
      {
        visibility: user.rol.nombre === ROLES.ADMIN ? 'ADMIN' : 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'legacy-active-only',
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 10,
        filters: searchFilters(query),
        sort: {
          field: query.sortBy ?? (query.q?.trim() ? 'relevancia' : 'fecha'),
          order: query.sortOrder ?? 'desc',
        },
        ...(corpusOnlyFilter
          ? { sourceSystems: ['CORPUS'] as Array<'CORPUS'> }
          : {
              sourceSystems: ['JURISPRUDENCIA'] as Array<'JURISPRUDENCIA'>,
              documentKinds: ['SENTENCIA'] as Array<'SENTENCIA'>,
            }),
      },
    );
    if (!federated) throw new ServiceUnavailableException();
    const federatedMs = performance.now() - federatedStartedAt;
    const page = corpusOnlyFilter
      ? emptyLegacyPage(query)
      : toV2CompatibilityPage(federated);
    this.busquedaService.trackAdvancedV2(query, user.id, page.meta.total);
    const response = { ...page, federated };
    if (
      process.env.BJC_SEARCH_PROFILE === 'true' &&
      process.env.NODE_ENV !== 'production'
    ) {
      return {
        ...response,
        performance: {
          engine: 'opensearch',
          enginesBySource: Object.fromEntries(
            (federated.sources ?? []).map((source) => [
              source.source,
              'opensearch',
            ]),
          ),
          legacyMs: 0,
          federatedMs,
          totalMs: performance.now() - startedAt,
          adapters: federated.sources ?? [],
          adapterProfiles: federated.adapterProfiles ?? {},
          poolDiagnostics: federated.poolDiagnostics ?? {},
          parserMs: federated.parserMs ?? null,
          mergeAndRankingMs: Math.max(
            0,
            federated.durationMs -
              Math.max(
                0,
                ...federated.sources.map((source) => source.latencyMs),
              ),
          ),
        },
      };
    }
    return response;
  }

  @Get('interpretar')
  @ApiOperation({
    summary: 'Explica la gramática de búsqueda en entornos no productivos',
  })
  interpretar(
    @Query('q') query: string,
    @Query('operador') operador: 'AND' | 'OR',
  ) {
    return this.busquedaService.interpretar(query, operador);
  }

  @Get('avanzada/exportar')
  @Roles(ROLES.ADMIN, ROLES.OPERADOR)
  @ApiOperation({ summary: 'Exporta resultados de la busqueda administrativa' })
  async exportar(
    @Query() query: ExportarBusquedaQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const formato = query.formato ?? 'csv';
    const corpusOnlyFilter = Boolean(
      query.digestoCollectionId || query.digestoTopicId || query.digestoTagId,
    );
    const pageSize = 500;
    const maxExportRows = 30000;
    const results: SearchResult[] = [];
    let expectedTotal: number | undefined;
    for (let page = 1; ; page += 1) {
      const federated = await this.busquedaService.federatedSearch(
        query.q,
        query.operador,
        {
          visibility: user.rol.nombre === ROLES.ADMIN ? 'ADMIN' : 'INTERNAL',
          dialect: 'modern',
          publicationPolicy: 'legacy-active-only',
          page,
          pageSize,
          filters: searchFilters(query),
          sort: {
            field: query.sortBy ?? (query.q?.trim() ? 'relevancia' : 'fecha'),
            order: query.sortOrder ?? 'desc',
          },
          sourceSystems: corpusOnlyFilter ? ['CORPUS'] : ['JURISPRUDENCIA'],
          ...(!corpusOnlyFilter
            ? { documentKinds: ['SENTENCIA'] as Array<'SENTENCIA'> }
            : {}),
        },
      );
      if (!federated) throw new ServiceUnavailableException();
      if (expectedTotal === undefined) expectedTotal = federated.total;
      if (federated.total !== expectedTotal || federated.partial)
        throw new ServiceUnavailableException(
          'El resultado cambió durante la exportación. Reintentá la búsqueda.',
        );
      if (expectedTotal > maxExportRows)
        throw new PayloadTooLargeException(
          `La exportación excede el límite seguro de ${maxExportRows} resultados.`,
        );
      results.push(...federated.results);
      if (results.length >= expectedTotal) break;
      if (!federated.hasMore || federated.results.length === 0)
        throw new ServiceUnavailableException(
          'No se pudo completar la exportación de todos los resultados.',
        );
    }
    const data = corpusOnlyFilter
      ? results
      : toV2CompatibilityPage({
          page: 1,
          pageSize: Math.max(expectedTotal ?? 0, 1),
          total: expectedTotal ?? 0,
          hasMore: false,
          partial: false,
          deduplicated: 0,
          truncated: false,
          totalExact: true,
          sources: [],
          durationMs: 0,
          parserMs: 0,
          results,
        }).data;
    const exportPage = {
      data,
      meta: {
        total: expectedTotal ?? 0,
        page: 1,
        pageSize: Math.max(expectedTotal ?? 0, 1),
        pageCount: expectedTotal ? 1 : 0,
        totalExact: true,
        hasMore: false,
        sortUsed: query.sortBy ?? 'relevancia',
        expandedTerms: [],
      },
    };

    if (formato === 'json') {
      return exportPage;
    }

    response.setHeader(
      'Content-Type',
      formato === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'text/plain; charset=utf-8',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="busqueda-avanzada.${formato}"`,
    );

    return formato === 'csv' ? toExportCsv(data) : toExportTxt(data);
  }

  @Get('simple')
  @ApiOperation({ summary: 'Busqueda simple interna' })
  async simple(
    @Query('query') query: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const federated = await this.busquedaService.federatedSearch(
      query,
      undefined,
      {
        visibility: user.rol.nombre === ROLES.ADMIN ? 'ADMIN' : 'INTERNAL',
        dialect: 'modern',
        publicationPolicy: 'legacy-active-only',
        page: 1,
        pageSize: 10,
        sourceSystems: ['JURISPRUDENCIA'],
        documentKinds: ['SENTENCIA'],
      },
    );
    if (!federated) throw new ServiceUnavailableException();
    return toV2CompatibilityPage(federated);
  }

  @Get('sugerencias')
  @ApiOperation({ summary: 'Sugerencias de búsqueda' })
  sugerencias(@Query() query: SugerenciasQueryDto) {
    return this.busquedaService.sugerencias(query.q);
  }

  @Get('sugerencias/temas')
  @ApiOperation({ summary: 'Sugerencias de temas' })
  sugerenciasTemas(@Query() query: SugerenciasQueryDto) {
    return this.busquedaService.sugerenciasTemas(query.q);
  }

  @Get('sugerencias/magistrados')
  @ApiOperation({ summary: 'Sugerencias de magistrados' })
  sugerenciasMagistrados(@Query() query: SugerenciasQueryDto) {
    return this.busquedaService.sugerenciasMagistrados(query.q);
  }

  @Get('sugerencias/salas')
  @ApiOperation({ summary: 'Sugerencias de salas' })
  sugerenciasSalas(@Query() query: SugerenciasQueryDto) {
    return this.busquedaService.sugerenciasSalas(query.q);
  }

  @Get('sugerencias/tipos-fallo')
  @ApiOperation({ summary: 'Sugerencias de tipos de fallo' })
  sugerenciasTipos(@Query() query: SugerenciasQueryDto) {
    return this.busquedaService.sugerenciasTiposFallo(query.q);
  }

  @Get('sugerencias/expedientes')
  @ApiOperation({ summary: 'Sugerencias de expedientes' })
  sugerenciasExpedientes(@Query() query: SugerenciasQueryDto) {
    return this.busquedaService.sugerenciasExpedientes(query.q);
  }

  @Get('sugerencias/caratulas')
  @ApiOperation({ summary: 'Sugerencias de caratulas' })
  sugerenciasCaratulas(@Query() query: SugerenciasQueryDto) {
    return this.busquedaService.sugerenciasCaratulas(query.q);
  }

  @Get('temas')
  @ApiOperation({ summary: 'Temas disponibles para filtros' })
  temas() {
    return this.busquedaService.temas();
  }

  @Get('salas')
  @ApiOperation({ summary: 'Salas disponibles para filtros' })
  salas() {
    return this.busquedaService.salas();
  }

  @Get('tipos-fallo')
  @ApiOperation({ summary: 'Tipos de fallo disponibles para filtros' })
  tiposFallo() {
    return this.busquedaService.tiposFallo();
  }

  @Get('cita')
  @ApiOperation({ summary: 'Búsqueda por cita o referencia' })
  async cita(@Query('q') q: string, @CurrentUser() user: AuthenticatedUser) {
    const federated = await this.busquedaService.federatedSearch(q, undefined, {
      visibility: user.rol.nombre === ROLES.ADMIN ? 'ADMIN' : 'INTERNAL',
      dialect: 'modern',
      publicationPolicy: 'legacy-active-only',
      page: 1,
      pageSize: 20,
      sourceSystems: ['JURISPRUDENCIA'],
      documentKinds: ['SENTENCIA'],
    });
    if (!federated) throw new ServiceUnavailableException();
    this.busquedaService.trackCitationV2(
      q?.trim() ?? '',
      user.id,
      federated.results.length,
    );
    return { data: toV2CompatibilityPage(federated).data.slice(0, 20) };
  }
}

@ApiTags('public-busqueda')
@Public()
@Controller('public')
export class PublicBusquedaController {
  constructor(private readonly busquedaService: BusquedaService) {}

  @Get('busqueda')
  @ApiOperation({ summary: 'Búsqueda pública simple' })
  async publica(@Query() query: PublicBusquedaQueryDto) {
    const sortUsed = query.sortBy ?? (query.q?.trim() ? 'relevancia' : 'fecha');
    const federated = await this.busquedaService.federatedSearch(
      query.q,
      query.operador,
      {
        visibility: 'PUBLIC',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        page: query.page ?? 1,
        pageSize: Math.min(query.pageSize ?? 25, 100),
        filters: searchFilters(query),
        sort: {
          field: sortUsed,
          order: query.sortOrder ?? 'desc',
        },
        sourceSystems: ['JURISPRUDENCIA'],
        documentKinds: ['SENTENCIA'],
      },
    );
    if (!federated) throw new ServiceUnavailableException();
    return {
      ...toPublicConsultaPage(federated, sortUsed),
      federated,
    };
  }

  @Get('busqueda/sugerencias')
  @ApiOperation({ summary: 'Sugerencias públicas' })
  sugerencias(@Query() query: SugerenciasQueryDto) {
    return this.busquedaService.sugerenciasPublicas(query.q);
  }

  @Get('busqueda/temas')
  @ApiOperation({ summary: 'Temas publicados para filtros públicos' })
  temas() {
    return this.busquedaService.temas(true);
  }

  @Get('busqueda/salas')
  @ApiOperation({ summary: 'Salas publicadas para filtros públicos' })
  salas() {
    return this.busquedaService.salas(true);
  }

  @Get('busqueda/tipos-fallo')
  @ApiOperation({ summary: 'Tipos de fallo publicados para filtros públicos' })
  tiposFallo() {
    return this.busquedaService.tiposFallo(true);
  }
}

function asDateString(value?: Date) {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString().slice(0, 10)
    : undefined;
}
function dayAfter(value?: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    return undefined;
  const end = new Date(value);
  end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString().slice(0, 10);
}
function searchFilters(query: {
  sala?: string;
  fechaDesde?: Date;
  fechaHasta?: Date;
  fraseExacta?: string;
  excluir?: string[];
  expediente?: string;
  numeroSentencia?: string;
  numeroSumario?: string;
  caratula?: string;
  actor?: string;
  demandado?: string;
  objeto?: string;
  magistrados?: string;
  tribunalOrigen?: string;
  tipoFallo?: string;
  tema?: string;
  anio?: number;
  publicado?: boolean;
  activo?: boolean;
  digestoCollectionId?: string;
  digestoTopicId?: string;
  digestoTagId?: string;
  soloConPdf?: boolean;
  pdf?: 'todos' | 'conPdf' | 'sinPdf';
  tienePdf?: boolean;
  soloConResumen?: boolean;
  destacada?: boolean;
  buscarEn?: string[];
}) {
  return {
    exactPhrase: query.fraseExacta,
    excludeTerms: query.excluir,
    sala: query.sala,
    fechaDesde: asDateString(query.fechaDesde),
    fechaHastaExclusive: dayAfter(query.fechaHasta),
    expediente: query.expediente,
    numeroSentencia: query.numeroSentencia,
    numeroSumario: query.numeroSumario,
    caratula: query.caratula,
    actor: query.actor,
    demandado: query.demandado,
    objeto: query.objeto,
    magistrados: query.magistrados,
    tribunalOrigen: query.tribunalOrigen,
    tipoFallo: query.tipoFallo,
    tema: query.tema,
    anio: query.anio,
    publicado: query.publicado,
    activo: query.activo,
    digestoCollectionId: query.digestoCollectionId,
    digestoTopicId: query.digestoTopicId,
    digestoTagId: query.digestoTagId,
    soloConPdf: query.soloConPdf,
    pdf: query.pdf,
    tienePdf: query.tienePdf,
    soloConResumen: query.soloConResumen,
    destacada: query.destacada,
    buscarEn: query.buscarEn,
  };
}

function emptyLegacyPage(query: BusquedaAvanzadaQueryDto) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 10;
  return {
    data: [],
    meta: {
      total: 0,
      page,
      pageSize,
      pageCount: 0,
      sortUsed: query.sortBy ?? 'relevancia',
      expandedTerms: [],
    },
  };
}

function toV2CompatibilityPage(
  page: NonNullable<Awaited<ReturnType<BusquedaService['federatedSearch']>>>,
) {
  const seenSentencias = new Set<number>();
  const data = (page?.results ?? [])
    .filter((result) => {
      if (result.sourceSystem !== 'JURISPRUDENCIA') return false;
      const sentenciaId = Number(
        result.metadata.sentenciaId ?? result.sourceId,
      );
      if (!Number.isSafeInteger(sentenciaId) || seenSentencias.has(sentenciaId))
        return false;
      seenSentencias.add(sentenciaId);
      return true;
    })
    .map((result) => {
      const metadata = result.metadata;
      const sentenciaId = Number(metadata.sentenciaId ?? result.sourceId);
      const stringField = (key: string) =>
        typeof metadata[key] === 'string' ? metadata[key] : undefined;
      const snippet = result.snippet ?? '';
      return {
        sentencia: {
          id: sentenciaId,
          caratula: stringField('caratula') ?? result.title ?? undefined,
          numeroSentencia: stringField('numeroSentencia'),
          tipoFallo: stringField('tipoFallo'),
          sala: stringField('sala'),
          fecha: result.date ?? undefined,
          expediente: stringField('expediente'),
          actor: stringField('actor'),
          demandado: stringField('demandado'),
          objeto: stringField('objeto'),
          magistrados: stringField('magistrados'),
          publicado: metadata.publicado === true,
          activo: metadata.activo === true,
          destacada: false,
          tienePdf: false,
        },
        cantidadSumarios: Number(metadata.cantidadSumarios ?? 0),
        cantidadPdfs: 0,
        resumenBreve: snippet || null,
        relevancia: result.score,
        score: result.score,
        criterioPrincipal: result.matchedFields.join(', ') || null,
        fragmentos: snippet ? [snippet] : [],
        highlights: [],
        matchInfo: {
          exactPhraseMatches: 0,
          termMatches: result.matchedFields.length,
          matchedFields: result.matchedFields,
          directMatches: result.matchedFields.length,
          synonymMatches: 0,
        },
        matchedFields: result.matchedFields,
        sumariosRelevantes: [],
      };
    });
  const pageSize = page?.pageSize ?? 10;
  const total = page?.total ?? 0;
  const totalExact = page?.totalExact ?? true;
  const hasMore = page?.hasMore ?? false;
  return {
    data,
    meta: {
      total,
      page: page?.page ?? 1,
      pageSize,
      pageCount: totalExact
        ? Math.ceil(total / pageSize)
        : (page?.page ?? 1) + (hasMore ? 1 : 0),
      sortUsed: 'relevancia',
      expandedTerms: [],
      totalExact,
      hasMore,
    },
  };
}

function toPublicConsultaPage(
  page: NonNullable<Awaited<ReturnType<BusquedaService['federatedSearch']>>>,
  sortUsed: string,
) {
  const data = page.results.map((result) => {
    if (
      result.sourceSystem !== 'JURISPRUDENCIA' ||
      result.sourceType !== 'SENTENCIA'
    )
      throw new ServiceUnavailableException();

    const metadata = result.metadata;
    const sentenciaId = Number(metadata.sentenciaId ?? result.sourceId);
    if (!Number.isSafeInteger(sentenciaId) || sentenciaId <= 0)
      throw new ServiceUnavailableException();
    const stringField = (key: string) =>
      typeof metadata[key] === 'string' ? metadata[key] : null;
    const booleanField = (key: string) => metadata[key] === true;
    const pdfDisponible = booleanField('pdfDisponible');
    const archivoPdfId = Number(metadata.archivoPdfId);

    return {
      id: sentenciaId,
      sentenciaId,
      slugPublico: stringField('slugPublico'),
      numeroSumario: stringField('numeroSumario'),
      numeroSentencia: stringField('numeroSentencia'),
      fecha: result.date,
      sala: stringField('sala'),
      magistrados: stringField('magistrados'),
      tipoFallo: stringField('tipoFallo'),
      expediente: stringField('expediente'),
      tribunalOrigen: stringField('tribunalOrigen'),
      caratula: stringField('caratula') ?? result.title,
      actor: stringField('actor'),
      demandado: stringField('demandado'),
      tema: stringField('tema'),
      textoSumario: result.snippet ?? '',
      extractoFallo: stringField('extractoFallo'),
      esFalloCorpus: booleanField('legacyCorpus'),
      highlights: [],
      tienePdf: pdfDisponible,
      pdfDisponible,
      archivoPdfId:
        Number.isSafeInteger(archivoPdfId) && archivoPdfId > 0
          ? archivoPdfId
          : null,
      pdfUrl:
        stringField('slugPublico') && pdfDisponible
          ? `/api/public/sentencias/${stringField('slugPublico')}/pdf`
          : null,
      score: result.score,
      criterioPrincipal: result.matchedFields.join(', ') || null,
      matchInfo: {
        exactPhraseMatches: 0,
        termMatches: result.matchedFields.length,
        matchedFields: result.matchedFields,
        directMatches: result.matchedFields.length,
        synonymMatches: 0,
      },
      matchedFields: result.matchedFields,
    };
  });
  return {
    data,
    meta: {
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      pageCount: Math.ceil(page.total / page.pageSize),
      totalExact: page.totalExact,
      hasMore: page.hasMore,
      sortUsed,
      expandedTerms: [],
    },
  };
}

function toExportCsv(rows: unknown[]) {
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
  const lines = rows.map((value) => {
    const row = value as ExportableSearchResult;
    const sentencia = row.sentencia ?? {};
    const metadata = row.metadata ?? {};
    const date = sentencia.fecha ?? row.date;
    const fields = [
      displayValue(sentencia.id ?? row.sourceId ?? row.id),
      displayValue(sentencia.caratula ?? row.title),
      displayValue(
        sentencia.numeroSentencia ?? metadata.numeroSentencia ?? row.subtitle,
      ),
      displayValue(sentencia.sala ?? metadata.sala ?? row.chamber),
      displayValue(
        sentencia.tipoFallo ?? metadata.tipoFallo ?? row.documentType,
      ),
      date instanceof Date ? date.toISOString() : displayValue(date),
      displayValue(
        sentencia.expediente ?? metadata.expediente ?? row.caseNumber,
      ),
      displayValue(row.resumenBreve ?? row.snippet),
      displayValue(row.score ?? row.relevancia),
      displayValue(row.cantidadSumarios ?? metadata.cantidadSumarios, '0'),
      displayValue(row.cantidadPdfs, '0'),
    ];
    return fields.map((field) => `"${field.replace(/"/g, '""')}"`).join(',');
  });
  return [header.join(','), ...lines].join('\n');
}

function toExportTxt(rows: unknown[]) {
  return rows
    .map((value) => {
      const row = value as ExportableSearchResult;
      const sentencia = row.sentencia ?? {};
      const metadata = row.metadata ?? {};
      const date = sentencia.fecha ?? row.date;
      const fecha =
        date instanceof Date ? date.toISOString() : displayValue(date, '-');
      return [
        `Sentencia #${displayValue(sentencia.id ?? row.sourceId ?? row.id, '-')}`,
        displayValue(sentencia.caratula ?? row.title, 'Sin caratula'),
        `Sala: ${displayValue(sentencia.sala ?? metadata.sala ?? row.chamber, '-')}`,
        `Fecha: ${fecha}`,
        `Expediente: ${displayValue(sentencia.expediente ?? metadata.expediente ?? row.caseNumber, '-')}`,
        `Score: ${displayValue(row.score ?? row.relevancia, '-')}`,
        `Resumen: ${displayValue(row.resumenBreve ?? row.snippet, '-')}`,
      ].join('\n');
    })
    .join('\n\n');
}

type ExportableSearchResult = {
  id?: string | number;
  sourceId?: string;
  title?: string | null;
  subtitle?: string | null;
  chamber?: string | null;
  documentType?: string;
  caseNumber?: string | null;
  date?: string | null;
  snippet?: string | null;
  score?: number;
  relevancia?: number;
  resumenBreve?: string | null;
  cantidadSumarios?: number;
  cantidadPdfs?: number;
  sentencia?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

function displayValue(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value) ?? fallback;
}

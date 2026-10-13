import { Controller, Get, Query, Res } from '@nestjs/common';
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

@ApiTags('busqueda')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERADOR, ROLES.LECTOR, ROLES.REVISOR, ROLES.JURISPRUDENCIA, ROLES.DIGESTO)
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
    const legacyStartedAt = performance.now();
    // A collection filter is explicitly Corpus-only in the federated source
    // list, and the UI uses only `federated` results for that view. Avoid
    // running the unrelated, much more expensive legacy Jurisprudencia query.
    const corpusOnlyFilter = Boolean(query.digestoCollectionId || query.digestoTopicId || query.digestoTagId);
    const useV2HotPath = corpusOnlyFilter || supportsV2AdvancedQuery(query);
    const legacyPromise = corpusOnlyFilter
      ? Promise.resolve({ result: emptyLegacyPage(query), elapsedMs: 0 })
      : useV2HotPath
        ? Promise.resolve({ result: null, elapsedMs: 0 })
        : this.busquedaService.avanzada(query, user.id).then((result) => ({
          result,
          elapsedMs: performance.now() - legacyStartedAt,
        }));
    const federatedStartedAt = performance.now();
    const federatedPromise = this.busquedaService.federatedSearch(query.q, query.operador, {
        visibility: user.rol.nombre === ROLES.ADMIN ? 'ADMIN' : 'INTERNAL', dialect: 'modern', publicationPolicy: 'legacy-active-only',
        page: query.page ?? 1, pageSize: query.pageSize ?? 10,
        filters: searchFilters(query),
        ...(corpusOnlyFilter ? { sourceSystems: ['CORPUS'] as Array<'CORPUS'> } : {}),
      }).then((result) => ({ result, elapsedMs: performance.now() - federatedStartedAt }));
    const [{ result: legacy, elapsedMs: legacyMs }, { result: federated, elapsedMs: federatedMs }] = await Promise.all([legacyPromise, federatedPromise]);
    const v2Page = useV2HotPath && federated ? toV2CompatibilityPage(federated) : null;
    if (v2Page) this.busquedaService.trackAdvancedV2(query, user.id, v2Page.meta.total);
    const response = { ...(v2Page ?? legacy), federated };
    if (process.env.BJC_SEARCH_PROFILE === 'true' && process.env.NODE_ENV !== 'production') {
      const engine = useV2HotPath ? 'v2' : 'hybrid';
      return {
        ...response,
        performance: {
          engine,
          enginesBySource: Object.fromEntries((federated?.sources ?? []).map((source) => [source.source, useV2HotPath ? 'v2' : 'legacy+v2'])),
          legacyMs,
          federatedMs,
          totalMs: performance.now() - startedAt,
          adapters: federated?.sources ?? [],
          adapterProfiles: federated?.adapterProfiles ?? {},
          poolDiagnostics: federated?.poolDiagnostics ?? {},
          parserMs: federated?.parserMs ?? null,
          legacyProfile: corpusOnlyFilter ? null : this.busquedaService.getLastAdvancedProfile(),
          mergeAndRankingMs: federated
            ? Math.max(0, federated.durationMs - Math.max(0, ...federated.sources.map((source) => source.latencyMs)))
            : null,
        },
      };
    }
    return response;
  }

  @Get('interpretar')
  @ApiOperation({ summary: 'Explica la gramática de búsqueda en entornos no productivos' })
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
    @Res({ passthrough: true }) response: Response,
  ) {
    const formato = query.formato ?? 'csv';
    const data = await this.busquedaService.exportar(query);

    if (formato === 'json') {
      return data;
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

    return data;
  }

  @Get('simple')
  @ApiOperation({ summary: 'Busqueda simple interna' })
  async simple(
    @Query('query') query: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const [legacy, federated] = await Promise.all([
      this.busquedaService.simple(query, user.id),
      this.busquedaService.federatedSearch(query, undefined, {
        visibility: user.rol.nombre === ROLES.ADMIN ? 'ADMIN' : 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only', page: 1, pageSize: 10,
      }),
    ]);
    return { ...legacy, federated };
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
  cita(@Query('q') q: string, @CurrentUser() user: AuthenticatedUser) {
    return this.busquedaService.buscarPorCita(q, user.id);
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
    const [legacy, federated] = await Promise.all([
      this.busquedaService.publica(query),
      this.busquedaService.federatedSearch(query.q, query.operador, {
        visibility: 'PUBLIC', dialect: 'modern', publicationPolicy: 'published-active-only',
        page: query.page ?? 1, pageSize: Math.min(query.pageSize ?? 25, 100),
        filters: searchFilters(query),
      }),
    ]);
    return { ...legacy, federated };
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

function asDateString(value?: Date) { return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : undefined; }
function dayAfter(value?: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;
  const end = new Date(value);
  end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString().slice(0, 10);
}
function searchFilters(query: {
  sala?: string; fechaDesde?: Date; fechaHasta?: Date; expediente?: string; numeroSentencia?: string;
  caratula?: string; tribunalOrigen?: string; tipoFallo?: string; digestoCollectionId?: string; digestoTopicId?: string; digestoTagId?: string;
}) {
  return {
    sala: query.sala, fechaDesde: asDateString(query.fechaDesde), fechaHastaExclusive: dayAfter(query.fechaHasta),
    expediente: query.expediente, numeroSentencia: query.numeroSentencia, caratula: query.caratula,
    tribunalOrigen: query.tribunalOrigen, tipoFallo: query.tipoFallo,
    digestoCollectionId: query.digestoCollectionId,
    digestoTopicId: query.digestoTopicId,
    digestoTagId: query.digestoTagId,
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

function supportsV2AdvancedQuery(query: BusquedaAvanzadaQueryDto) {
  const unsupportedValues = [
    query.fraseExacta, query.excluir?.length, query.numeroSumario, query.actor,
    query.demandado, query.objeto, query.magistrados, query.tema, query.anio,
    query.publicado, query.activo, query.soloConPdf, query.pdf, query.tienePdf,
    query.soloConResumen, query.destacada,
  ];
  const unsupportedSearchFields = query.buscarEn?.length &&
    !(query.buscarEn.length === 1 && query.buscarEn[0] === 'todo');
  return Boolean(query.q?.trim()) &&
    !unsupportedValues.some((value) => value !== undefined && value !== 'todos') &&
    !unsupportedSearchFields &&
    (!query.sortBy || query.sortBy === 'relevancia') &&
    (!query.sortOrder || query.sortOrder === 'desc');
}

function toV2CompatibilityPage(page: NonNullable<Awaited<ReturnType<BusquedaService['federatedSearch']>>>) {
  const seenSentencias = new Set<number>();
  const data = (page?.results ?? []).filter((result) => {
    if (result.sourceSystem !== 'JURISPRUDENCIA') return false;
    const sentenciaId = Number(result.metadata.sentenciaId ?? result.sourceId);
    if (!Number.isSafeInteger(sentenciaId) || seenSentencias.has(sentenciaId)) return false;
    seenSentencias.add(sentenciaId);
    return true;
  }).map((result) => {
    const metadata = result.metadata;
    const sentenciaId = Number(metadata.sentenciaId ?? result.sourceId);
    const stringField = (key: string) => typeof metadata[key] === 'string' ? metadata[key] as string : undefined;
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
      cantidadSumarios: 1,
      cantidadPdfs: 0,
      resumenBreve: snippet || null,
      relevancia: result.score,
      score: result.score,
      criterioPrincipal: result.matchedFields.join(', ') || null,
      fragmentos: snippet ? [snippet] : [],
      highlights: [],
      matchInfo: { exactPhraseMatches: 0, termMatches: result.matchedFields.length, matchedFields: result.matchedFields, directMatches: result.matchedFields.length, synonymMatches: 0 },
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
      pageCount: totalExact ? Math.ceil(total / pageSize) : (page?.page ?? 1) + (hasMore ? 1 : 0),
      sortUsed: 'relevancia',
      expandedTerms: [],
      totalExact,
      hasMore,
    },
  };
}

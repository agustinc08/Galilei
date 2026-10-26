import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BusquedaService } from '../busqueda/busqueda.service';
import { CreateBusquedaGuardadaDto } from './dto/create-busqueda-guardada.dto';
import { UpdateBusquedaGuardadaDto } from './dto/update-busqueda-guardada.dto';
import { SavedSearchNoveltiesQueryDto } from './dto/saved-search-novelties-query.dto';
import { MarkNoveltiesViewedDto } from './dto/mark-novelties-viewed.dto';

const MAX_NOVELTY_CANDIDATES = 50_000;
const SUMMARY_CONCURRENCY = 4;

type RecordValue = Record<string, unknown>;
type StoredSearch = {
  id: number;
  usuarioId: number;
  queryJson: Prisma.JsonValue;
  lastViewedAt: Date | null;
  lastEvaluatedAt: Date | null;
  lastNewCount: number;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function savedSearchState(value: Prisma.JsonValue): RecordValue {
  if (!isRecord(value)) return {};
  if (value.kind === 'consulta-publica' && isRecord(value.state))
    return value.state;
  return value;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

function numberValue(value: unknown, minimum: number, maximum: number) {
  const result = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(result) && result >= minimum && result <= maximum
    ? result
    : undefined;
}

function listValue(value: unknown) {
  if (Array.isArray(value))
    return value
      .filter((item): item is string => typeof item === 'string')
      .flatMap((item) => item.split(','))
      .map((item) => item.trim())
      .filter(Boolean);
  return typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
}

function dateValue(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

function dayAfter(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function parseSavedSearch(value: Prisma.JsonValue) {
  const state = savedSearchState(value);
  const q = stringValue(state.q);
  if (q && q.length > 5000) throw new Error('SAVED_SEARCH_QUERY_TOO_LONG');
  const sortBy = ['fecha', 'relevancia', 'sala', 'numeroSentencia'].includes(
    String(state.sortBy),
  )
    ? (state.sortBy as 'fecha' | 'relevancia' | 'sala' | 'numeroSentencia')
    : q
      ? 'relevancia'
      : 'fecha';
  const sortOrder: 'asc' | 'desc' = state.sortOrder === 'asc' ? 'asc' : 'desc';
  const buscarEn = listValue(state.buscarEn);
  const filters = {
    exactPhrase: stringValue(state.fraseExacta),
    excludeTerms: listValue(state.excluir),
    sala: stringValue(state.sala),
    salas: listValue(state.salas),
    fechaDesde: dateValue(state.fechaDesde),
    fechaHastaExclusive: dayAfter(dateValue(state.fechaHasta)),
    expediente: stringValue(state.expediente),
    numeroSentencia: stringValue(state.numeroSentencia),
    numeroSumario: stringValue(state.numeroSumario),
    caratula: stringValue(state.caratula),
    actor: stringValue(state.actor),
    demandado: stringValue(state.demandado),
    objeto: stringValue(state.objeto),
    magistrados: stringValue(state.magistrados),
    tribunalOrigen: stringValue(state.tribunalOrigen),
    tipoFallo: stringValue(state.tipoFallo),
    tema: stringValue(state.tema),
    anio: numberValue(state.anio, 1900, 2100),
    publicado: booleanValue(state.publicado),
    activo: booleanValue(state.activo),
    soloConPdf: booleanValue(state.soloConPdf),
    pdf: ['todos', 'conPdf', 'sinPdf'].includes(String(state.pdf))
      ? (state.pdf as 'todos' | 'conPdf' | 'sinPdf')
      : undefined,
    tienePdf: booleanValue(state.tienePdf),
    soloConResumen: booleanValue(state.soloConResumen),
    destacada: booleanValue(state.destacada),
    buscarEn:
      buscarEn?.length === 1 && buscarEn[0] === 'todo' ? undefined : buscarEn,
  };
  return {
    query: q,
    operador: state.operador === 'OR' ? ('OR' as const) : ('AND' as const),
    filters,
    sort: { field: sortBy, order: sortOrder },
  };
}

function sentenceIdFromResult(result: {
  sourceId: string;
  metadata: Record<string, string | number | boolean | null>;
}) {
  const id = Number(
    result.metadata.sentenciaId ?? result.sourceId.match(/(\d+)$/u)?.[1],
  );
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

@Injectable()
export class BusquedasGuardadasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly busquedaService: BusquedaService,
  ) {}

  async findAll(usuarioId: number) {
    const searches = await this.prisma.busquedaGuardada.findMany({
      where: { usuarioId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    const data = await this.withConcurrency(
      searches,
      SUMMARY_CONCURRENCY,
      (item) => this.refreshNoveltySummary(usuarioId, item as StoredSearch),
    );
    return { data };
  }

  async findOne(usuarioId: number, id: number) {
    const busqueda = await this.prisma.busquedaGuardada.findFirst({
      where: { id, usuarioId },
    });

    if (!busqueda) {
      throw new NotFoundException('Busqueda guardada no encontrada');
    }

    return { data: busqueda };
  }

  async create(usuarioId: number, dto: CreateBusquedaGuardadaDto) {
    const baseline = new Date();
    const data = await this.prisma.busquedaGuardada.create({
      data: {
        usuarioId,
        nombre: dto.nombre,
        queryJson: dto.queryJson as Prisma.InputJsonValue,
        lastViewedAt: baseline,
        lastEvaluatedAt: baseline,
        lastNewCount: 0,
      },
    });

    return { data };
  }

  async update(usuarioId: number, id: number, dto: UpdateBusquedaGuardadaDto) {
    await this.findOne(usuarioId, id);
    const resetsBaseline = dto.queryJson !== undefined;
    const baseline = resetsBaseline ? new Date() : undefined;

    const data = await this.prisma.busquedaGuardada.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre }),
        ...(dto.queryJson !== undefined && {
          queryJson: dto.queryJson as Prisma.InputJsonValue,
        }),
        ...(resetsBaseline
          ? {
              lastViewedAt: baseline,
              lastEvaluatedAt: baseline,
              lastNewCount: 0,
            }
          : {}),
      },
    });

    return { data };
  }

  async findNovelties(
    usuarioId: number,
    id: number,
    query: SavedSearchNoveltiesQueryDto,
  ) {
    const search = (await this.findOne(usuarioId, id)).data as StoredSearch;
    if (!search.lastViewedAt) {
      const baseline = new Date();
      await this.prisma.busquedaGuardada.updateMany({
        where: { id, usuarioId, lastViewedAt: null },
        data: {
          lastViewedAt: baseline,
          lastEvaluatedAt: baseline,
          lastNewCount: 0,
        },
      });
      return {
        data: [],
        meta: {
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
          pageCount: 0,
          baselineEstablished: true,
          lastViewedAt: baseline,
          evaluatedAt: baseline,
        },
      };
    }

    const evaluatedAt = query.evaluatedAt ?? new Date();
    if (
      Number.isNaN(evaluatedAt.getTime()) ||
      evaluatedAt > new Date() ||
      evaluatedAt <= search.lastViewedAt
    ) {
      throw new BadRequestException(
        'El corte temporal de novedades no es válido.',
      );
    }
    const result = await this.searchNovelties(search, query, evaluatedAt);
    const updated = await this.prisma.busquedaGuardada.updateMany({
      where: { id, usuarioId, lastViewedAt: search.lastViewedAt },
      data: { lastEvaluatedAt: evaluatedAt, lastNewCount: result.total },
    });
    if (!updated.count)
      throw new ConflictException(
        'La búsqueda cambió mientras se consultaban las novedades.',
      );
    return {
      data: result.data,
      meta: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        pageCount: Math.ceil(result.total / result.pageSize),
        hasMore: result.hasMore,
        baselineEstablished: false,
        lastViewedAt: search.lastViewedAt,
        evaluatedAt,
      },
    };
  }

  async markNoveltiesViewed(
    usuarioId: number,
    id: number,
    dto: MarkNoveltiesViewedDto,
  ) {
    const search = (await this.findOne(usuarioId, id)).data as StoredSearch;
    const viewedThrough = new Date(dto.viewedThrough);
    if (
      !search.lastViewedAt ||
      !search.lastEvaluatedAt ||
      Number.isNaN(viewedThrough.getTime()) ||
      viewedThrough > new Date() ||
      viewedThrough < search.lastViewedAt ||
      viewedThrough > search.lastEvaluatedAt
    ) {
      throw new BadRequestException('El corte de novedades ya no es válido.');
    }
    const result = await this.prisma.busquedaGuardada.updateMany({
      where: {
        id,
        usuarioId,
        lastViewedAt: search.lastViewedAt,
        lastEvaluatedAt: search.lastEvaluatedAt,
      },
      data: {
        lastViewedAt: viewedThrough,
        lastEvaluatedAt: viewedThrough,
        lastNewCount: 0,
      },
    });
    if (!result.count)
      throw new ConflictException(
        'La búsqueda cambió mientras revisabas las novedades.',
      );
    return { data: { viewed: true, lastViewedAt: viewedThrough, newCount: 0 } };
  }

  async remove(usuarioId: number, id: number) {
    await this.findOne(usuarioId, id);

    await this.prisma.busquedaGuardada.delete({
      where: { id },
    });

    return { data: { deleted: true } };
  }

  private async refreshNoveltySummary(usuarioId: number, search: StoredSearch) {
    if (!search.lastViewedAt) {
      const baseline = new Date();
      await this.prisma.busquedaGuardada.updateMany({
        where: { id: search.id, usuarioId, lastViewedAt: null },
        data: {
          lastViewedAt: baseline,
          lastEvaluatedAt: baseline,
          lastNewCount: 0,
        },
      });
      return {
        ...search,
        lastViewedAt: baseline,
        lastEvaluatedAt: baseline,
        lastNewCount: 0,
        noveltyAvailable: true,
      };
    }

    try {
      const evaluatedAt = new Date();
      const result = await this.searchNovelties(
        search,
        { page: 1, pageSize: 1 },
        evaluatedAt,
      );
      const updated = await this.prisma.busquedaGuardada.updateMany({
        where: {
          id: search.id,
          usuarioId,
          lastViewedAt: search.lastViewedAt,
        },
        data: { lastEvaluatedAt: evaluatedAt, lastNewCount: result.total },
      });
      if (!updated.count)
        return {
          ...search,
          noveltyAvailable: false,
          noveltyError:
            'La búsqueda cambió mientras se consultaban las novedades.',
        };
      return {
        ...search,
        lastEvaluatedAt: evaluatedAt,
        lastNewCount: result.total,
        noveltyAvailable: true,
      };
    } catch {
      return {
        ...search,
        noveltyAvailable: false,
        noveltyError: 'No fue posible consultar las novedades en este momento.',
      };
    }
  }

  private async searchNovelties(
    search: StoredSearch,
    query: SavedSearchNoveltiesQueryDto,
    evaluatedAt: Date,
  ) {
    if (!search.lastViewedAt) throw new Error('SAVED_SEARCH_BASELINE_MISSING');
    const candidateRows = await this.prisma.sentencia.findMany({
      where: {
        publicado: true,
        activo: true,
        publishedAt: { gt: search.lastViewedAt, lte: evaluatedAt },
      },
      select: { id: true },
      orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
      take: MAX_NOVELTY_CANDIDATES + 1,
    });
    if (candidateRows.length > MAX_NOVELTY_CANDIDATES)
      throw new ServiceUnavailableException(
        'Hay demasiadas novedades para evaluarlas de forma segura. El estado no se avanzó.',
      );
    if (!candidateRows.length) {
      return {
        total: 0,
        page: query.page,
        pageSize: query.pageSize,
        hasMore: false,
        data: [],
      };
    }

    const saved = parseSavedSearch(search.queryJson);
    const federated = await this.busquedaService.federatedSearch(
      saved.query,
      saved.operador,
      {
        visibility: 'PUBLIC',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        page: query.page,
        pageSize: query.pageSize,
        filters: {
          ...saved.filters,
          sentenceIds: candidateRows.map((row) => row.id),
        },
        sort: saved.sort,
        sourceSystems: ['JURISPRUDENCIA'],
        documentKinds: ['SENTENCIA'],
      },
    );
    if (!federated || federated.partial || federated.totalExact === false)
      throw new ServiceUnavailableException(
        'La búsqueda de novedades no se completó. El estado no se avanzó.',
      );

    const ids = federated.results
      .map(sentenceIdFromResult)
      .filter((id): id is number => id !== null);
    const publicSentences = ids.length
      ? await this.prisma.sentencia.findMany({
          where: { id: { in: ids }, publicado: true, activo: true },
          select: {
            id: true,
            slugPublico: true,
            caratula: true,
            numeroSentencia: true,
            sala: true,
            fecha: true,
            expediente: true,
            tipoFallo: true,
          },
        })
      : [];
    const byId = new Map(
      publicSentences.map((sentence) => [sentence.id, sentence]),
    );
    const data = ids
      .map((sentenceId) => byId.get(sentenceId))
      .filter((sentence): sentence is NonNullable<typeof sentence> =>
        Boolean(sentence),
      );
    return {
      total: federated.total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore:
        federated.hasMore ?? query.page * query.pageSize < federated.total,
      data,
    };
  }

  private async withConcurrency<T, U>(
    values: T[],
    concurrency: number,
    mapper: (value: T) => Promise<U>,
  ): Promise<U[]> {
    const output = new Array<U>(values.length);
    let nextIndex = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, values.length) }, async () => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= values.length) return;
          output[index] = await mapper(values[index]);
        }
      }),
    );
    return output;
  }
}

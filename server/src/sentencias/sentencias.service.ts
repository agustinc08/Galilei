import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ArchivoPdf,
  CitaFallo,
  Prisma,
  Sentencia,
  Sumario,
} from '../generated/prisma/client';
import { obtenerPdfsReales } from '../archivos/pdf-real.util';
import {
  buildSentenciaSearchData,
  buildSumarioSearchData,
  normalizeSearchText,
} from '../busqueda/utils/search-normalizer';
import { CatalogosService } from '../catalogos/catalogos.service';
import { EventosConsultaService } from '../estadisticas/eventos-consulta.service';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSentenciaDto } from './dto/create-sentencia.dto';
import { CrearSentenciaCompletaDto } from './dto/crear-sentencia-completa.dto';
import { CrearSumariosLoteDto } from './dto/crear-sumarios-lote.dto';
import { QuerySentenciasDto } from './dto/query-sentencias.dto';
import { UpdateResenaDto } from './dto/update-resena.dto';
import { UpdateResumenDto } from './dto/update-resumen.dto';
import { UpdateSentenciaDto } from './dto/update-sentencia.dto';
import { formatCitation } from './utils/citation-formatter';

type CitaData = {
  citaBreve: string;
  citaCompleta: string;
  citaCopiable: string;
};

type PublicationReviewQueueItem = {
  documentId: string;
  title: string;
  caseNumber: string | null;
  chamber: string | null;
  decisionDate: Date | null;
  published: boolean;
  reason:
    | 'Identidad jurídica ambigua'
    | 'Representación documental requiere revisión';
};

type FalloRelacionadoResumen = {
  id: number;
  numeroSentencia: string | null;
  expediente: string | null;
  sala: string | null;
  fecha: Date | null;
  slugPublico: string | null;
};

type ReferenciaNormativaData = {
  id: number;
  sentenciaId: number;
  tipoNorma: string;
  numeroNorma: string | null;
  articulo: string | null;
  inciso: string | null;
  textoReferencia: string | null;
  url: string | null;
  createdAt: Date;
};

type ReferenciaJurisprudencialData = {
  id: number;
  sentenciaId: number;
  referencia: string;
  falloRelacionadoId: number | null;
  textoOriginal: string | null;
  createdAt: Date;
  falloRelacionado?: FalloRelacionadoResumen | null;
};

type ReferenciaDoctrinariaData = {
  id: number;
  sentenciaId: number;
  autor: string | null;
  titulo: string | null;
  fuente: string | null;
  anio: number | null;
  textoReferencia: string | null;
  url: string | null;
  createdAt: Date;
};

type FichaData = {
  sentencia: Sentencia;
  resumen: { texto: string | null; fuente: string | null; publicado: boolean };
  resena: string | null;
  cita: CitaData;
  sumarios: Sumario[];
  citasFallo: CitaFallo[];
  referenciasNormativas: ReferenciaNormativaData[];
  referenciasJurisprudenciales: ReferenciaJurisprudencialData[];
  referenciasDoctrinarias: ReferenciaDoctrinariaData[];
  archivosPdf: ArchivoPdf[];
  generatedAt: string;
};

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function initials(value?: string | null) {
  if (!value?.trim()) {
    return null;
  }

  const words = value.trim().split(/\s+/).filter(Boolean);

  if (!words.length) {
    return null;
  }

  return words.map((word) => `${word.charAt(0).toUpperCase()}.`).join(' ');
}

function toPublicParticipants(sentencia: {
  actor?: string | null;
  demandado?: string | null;
  anonimizado?: boolean | null;
  actorPublico?: string | null;
  demandadoPublico?: string | null;
}) {
  return {
    actor:
      sentencia.anonimizado && sentencia.actorPublico
        ? sentencia.actorPublico
        : sentencia.actor,
    demandado:
      sentencia.anonimizado && sentencia.demandadoPublico
        ? sentencia.demandadoPublico
        : sentencia.demandado,
  };
}

function publicizeCuratorialReferences<
  T extends {
    falloRelacionadoId: number | null;
    falloRelacionado: {
      id: number;
      publicado: boolean;
      activo: boolean;
      numeroSentencia: string | null;
      expediente: string | null;
      sala: string | null;
      fecha: Date | null;
      slugPublico: string | null;
    } | null;
  },
>(references: T[]) {
  return references.map((reference) => {
    const target = reference.falloRelacionado;
    const targetIsPublic = target?.publicado === true && target.activo === true;
    return {
      ...reference,
      falloRelacionadoId: targetIsPublic ? target.id : null,
      falloRelacionado:
        targetIsPublic && target
          ? {
              id: target.id,
              numeroSentencia: target.numeroSentencia,
              expediente: target.expediente,
              sala: target.sala,
              fecha: target.fecha,
              slugPublico: target.slugPublico,
            }
          : null,
    };
  });
}

@Injectable()
export class SentenciasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogosService: CatalogosService,
    private readonly eventosConsultaService: EventosConsultaService,
    private readonly logsService: LogsService,
  ) {}

  async getPublicationReviewQueue() {
    const items = await this.prisma.$queryRaw<
      PublicationReviewQueueItem[]
    >(Prisma.sql`
      WITH review_candidates AS (
        SELECT DISTINCT c.id AS "documentId", c.title,
          c."caseNumber" AS "caseNumber", c.chamber,
          c."decisionDate" AS "decisionDate",
          'Identidad jurídica ambigua'::text AS reason
        FROM "CorpusDocument" c
        INNER JOIN "CorpusDocumentLink" l
          ON l."documentId" = c.id
         AND l."targetDomain" = 'JURISPRUDENCIA'
         AND l."targetType" = 'SENTENCIA'
        WHERE l.metadata->>'publicationStatus' = 'REQUIRES_REVIEW_LEGAL_KEY_COLLISION'
          AND NOT EXISTS (
            SELECT 1 FROM "Sentencia" s
            WHERE s."legacyId" = 'CORPUS:' || c.id
              AND s.publicado = TRUE AND s.activo = TRUE
          )

        UNION

        SELECT DISTINCT c.id AS "documentId", c.title,
          c."caseNumber" AS "caseNumber", c.chamber,
          c."decisionDate" AS "decisionDate",
          'Representación documental requiere revisión'::text AS reason
        FROM "CorpusDocument" c
        INNER JOIN "CorpusIngestionRecord" i ON i."documentId" = c.id
        INNER JOIN "CorpusSourceSystem" source ON source.id = i."sourceSystemId"
        INNER JOIN "CorpusDocumentFile" f ON f.id = i."fileId"
        WHERE source.code = 'CIVIL_CUANTIFICACION_DANOS'
          AND f."mimeType" = 'text/plain'
          AND NOT EXISTS (
            SELECT 1 FROM "Sentencia" s
            WHERE s."legacyId" = 'CORPUS:' || c.id
              AND s.publicado = TRUE AND s.activo = TRUE
          )
      )
      SELECT "documentId", title, "caseNumber", chamber, "decisionDate", reason,
        FALSE AS published
      FROM review_candidates
      ORDER BY "decisionDate" DESC NULLS LAST, title, "documentId"
    `);

    return {
      data: items,
      meta: {
        total: items.length,
        definition:
          'Estado persistido de colisión jurídica o archivo text/plain de la fuente civil cuantificada.',
      },
    };
  }

  private async resolveCatalogFields(input: {
    salaId?: number | null;
    tipoFalloId?: number | null;
    tribunalOrigenId?: number | null;
    sala?: string | null;
    tipoFallo?: string | null;
    tribunalOrigen?: string | null;
  }) {
    const rawCatalogValues: unknown =
      await this.catalogosService.getCatalogValueIds({
        salaId: input.salaId,
        tipoFalloId: input.tipoFalloId,
        tribunalOrigenId: input.tribunalOrigenId,
      });
    const catalogValues = rawCatalogValues as {
      sala?: { nombre?: string | null } | null;
      tipoFallo?: { nombre?: string | null } | null;
      tribunalOrigen?: { nombre?: string | null } | null;
    };
    const { sala, tipoFallo, tribunalOrigen } = catalogValues;

    return {
      ...(input.salaId !== undefined && {
        salaId: input.salaId,
        sala: sala?.nombre ?? input.sala ?? null,
      }),
      ...(input.tipoFalloId !== undefined && {
        tipoFalloId: input.tipoFalloId,
        tipoFallo: tipoFallo?.nombre ?? input.tipoFallo ?? null,
      }),
      ...(input.tribunalOrigenId !== undefined && {
        tribunalOrigenId: input.tribunalOrigenId,
        tribunalOrigen: tribunalOrigen?.nombre ?? input.tribunalOrigen ?? null,
      }),
    };
  }

  async findAll(query: QuerySentenciasDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    let where = this.buildWhere(query);
    if (query.excluirRevision) {
      const reviewQueue = await this.getPublicationReviewQueue();
      where = {
        ...where,
        legacyId: {
          notIn: reviewQueue.data.map((item) => `CORPUS:${item.documentId}`),
        },
      };
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.sentencia.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        include: {
          archivosPdf: {
            orderBy: { createdAt: 'desc' },
          },
          _count: {
            select: { sumarios: true, archivosPdf: true, favoritos: true },
          },
        },
      }),
      this.prisma.sentencia.count({ where }),
    ]);

    return {
      data: data.map((sentencia) => this.normalizePdfState(sentencia)),
      meta: {
        page,
        pageSize,
        total,
        pageCount: Math.ceil(total / pageSize),
      },
    };
  }

  async buscar(query?: string) {
    if (!query?.trim()) {
      throw new BadRequestException('El parametro query es requerido');
    }

    const search = query.trim();
    const normalizedSearch = normalizeSearchText(search);

    const data = await this.prisma.sentencia.findMany({
      where: {
        OR: [
          { textoBusquedaNormalizado: { contains: normalizedSearch } },
          { numeroSentencia: { contains: search, mode: 'insensitive' } },
          { expediente: { contains: search, mode: 'insensitive' } },
          { actor: { contains: search, mode: 'insensitive' } },
          { demandado: { contains: search, mode: 'insensitive' } },
          { objeto: { contains: search, mode: 'insensitive' } },
          { magistrados: { contains: search, mode: 'insensitive' } },
          { resumenIa: { contains: search, mode: 'insensitive' } },
          { resena: { contains: search, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      take: 50,
    });

    return { data };
  }

  async findOne(id: number, usuarioId?: number) {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id },
      include: {
        sumarios: true,
        archivosPdf: true,
        _count: {
          select: { favoritos: true, sumarios: true, archivosPdf: true },
        },
      },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia no encontrada');
    }

    this.eventosConsultaService.trackSafe({
      tipoEvento: 'view_sentencia',
      usuarioId,
      sentenciaId: sentencia.id,
      metadata: { scope: 'internal-detail' },
    });

    return { data: this.normalizePdfState(sentencia) };
  }

  async findCompleta(id: number, usuarioId?: number) {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id },
      include: {
        citasFallo: {
          orderBy: [{ confirmada: 'desc' }, { createdAt: 'desc' }],
        },
        referenciasNormativas: {
          orderBy: { createdAt: 'asc' },
        },
        referenciasJurisprudenciales: {
          orderBy: { createdAt: 'asc' },
          include: {
            falloRelacionado: {
              select: {
                id: true,
                numeroSentencia: true,
                expediente: true,
                sala: true,
                fecha: true,
                slugPublico: true,
              },
            },
          },
        },
        referenciasDoctrinarias: {
          orderBy: { createdAt: 'asc' },
        },
        sumarios: {
          where: { activo: true },
          orderBy: { id: 'asc' },
        },
        archivosPdf: {
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { favoritos: true, sumarios: true, archivosPdf: true },
        },
      },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia no encontrada');
    }

    this.eventosConsultaService.trackSafe({
      tipoEvento: 'view_sentencia',
      usuarioId,
      sentenciaId: sentencia.id,
      metadata: { scope: 'internal-full' },
    });

    const data = this.normalizePdfState(sentencia);

    return {
      data: {
        ...data,
        cita: this.buildCita(sentencia),
      },
    };
  }

  async findByNumero(numeroSentencia: string, usuarioId?: number) {
    const sentencia = await this.prisma.sentencia.findFirst({
      where: {
        numeroSentencia: {
          equals: numeroSentencia.trim(),
          mode: 'insensitive',
        },
      },
      include: {
        sumarios: {
          where: { activo: true },
          orderBy: { id: 'asc' },
        },
        archivosPdf: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!sentencia) {
      throw new NotFoundException('No existe una sentencia con ese número');
    }

    this.eventosConsultaService.trackSafe({
      tipoEvento: 'view_sentencia',
      usuarioId,
      sentenciaId: sentencia.id,
      metadata: { scope: 'internal-quick-search' },
    });

    return { data: this.normalizePdfState(sentencia) };
  }

  async cargaRapida(
    dto: {
      sentencia: CreateSentenciaDto;
      sumario: {
        id?: number;
        numeroSumario?: string;
        tema?: string;
        texto: string;
        publicado?: boolean;
        activo?: boolean;
      };
    },
    usuarioId?: number,
  ) {
    const numeroSentencia = dto.sentencia.numeroSentencia?.trim();
    if (!numeroSentencia) {
      throw new BadRequestException(
        'El número de sentencia es obligatorio para la carga rápida',
      );
    }

    const catalogFields = await this.resolveCatalogFields(dto.sentencia);

    const result = await this.prisma.$transaction(async (tx) => {
      const existente = await tx.sentencia.findFirst({
        where: {
          numeroSentencia: {
            equals: numeroSentencia,
            mode: 'insensitive',
          },
        },
      });

      const payloadSentencia = {
        ...dto.sentencia,
        ...catalogFields,
      };

      const sentencia = existente
        ? await tx.sentencia.update({
            where: { id: existente.id },
            data: {
              ...payloadSentencia,
              ...buildSentenciaSearchData({
                ...existente,
                ...payloadSentencia,
              }),
            },
          })
        : await tx.sentencia.create({
            data: {
              ...payloadSentencia,
              estadoCarga: dto.sentencia.estadoCarga ?? 'COMPLETA',
              ...buildSentenciaSearchData(payloadSentencia),
            },
          });

      if (dto.sumario.id) {
        const existingSumario = await tx.sumario.findUnique({
          where: { id: dto.sumario.id },
          select: { id: true, sentenciaId: true },
        });

        if (!existingSumario) {
          throw new NotFoundException(
            'Sumario no encontrado para carga rápida',
          );
        }
      }

      const sumario = dto.sumario.id
        ? await tx.sumario.update({
            where: { id: dto.sumario.id },
            data: {
              sentenciaId: sentencia.id,
              numeroSumario: dto.sumario.numeroSumario,
              tema: dto.sumario.tema,
              texto: dto.sumario.texto,
              publicado: dto.sumario.publicado ?? false,
              activo: dto.sumario.activo ?? true,
              ...buildSumarioSearchData(dto.sumario),
            },
          })
        : await tx.sumario.create({
            data: {
              sentenciaId: sentencia.id,
              numeroSumario: dto.sumario.numeroSumario,
              tema: dto.sumario.tema,
              texto: dto.sumario.texto,
              publicado: dto.sumario.publicado ?? false,
              activo: dto.sumario.activo ?? true,
              ...buildSumarioSearchData(dto.sumario),
            },
          });

      return {
        sentencia,
        sumario,
        createdSentencia: !existente,
        updatedSumario: Boolean(dto.sumario.id),
      };
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'SENTENCIA',
        entidadId: result.sentencia.id,
        accion: result.createdSentencia ? 'CREATE' : 'UPDATE',
        descripcion: result.createdSentencia
          ? 'Creó sentencia desde carga rápida'
          : 'Actualizó sentencia desde carga rápida',
        datosDespues: result.sentencia,
      });
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'SUMARIO',
        entidadId: result.sumario.id,
        accion: result.updatedSumario ? 'UPDATE' : 'CREATE',
        descripcion: result.updatedSumario
          ? 'Actualizó sumario desde carga rápida'
          : 'Creó sumario desde carga rápida',
        datosDespues: result.sumario,
      });
    }

    return { data: result };
  }

  async create(createSentenciaDto: CreateSentenciaDto, usuarioId?: number) {
    const catalogFields = await this.resolveCatalogFields(createSentenciaDto);
    const sentencia = await this.prisma.sentencia.create({
      data: {
        ...createSentenciaDto,
        ...catalogFields,
        ...buildSentenciaSearchData({
          ...createSentenciaDto,
          ...catalogFields,
        }),
      },
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'SENTENCIA',
        entidadId: sentencia.id,
        accion: 'CREATE',
        descripcion: 'Creó sentencia',
        datosDespues: sentencia,
      });
    }

    return { data: sentencia };
  }

  async crearCompleta(dto: CrearSentenciaCompletaDto, usuarioId?: number) {
    const catalogFields = await this.resolveCatalogFields(dto.sentencia);
    const opciones = dto.opcionesPublicacion;
    const publicarSentencia =
      opciones?.publicarSentencia ?? dto.sentencia.publicado ?? false;
    const publicarSumarios = opciones?.publicarSumarios ?? false;
    const publicarResena = opciones?.publicarResena ?? false;
    const anonimizar = opciones?.anonimizar ?? false;
    const destacada = opciones?.destacada ?? dto.sentencia.destacada ?? false;
    const estadoCarga =
      opciones?.estadoCarga ??
      dto.sentencia.estadoCarga ??
      (publicarSentencia ? 'PUBLICADA' : 'COMPLETA');

    const sentencia = await this.prisma.$transaction(async (tx) => {
      const actorOriginal = anonimizar ? (dto.sentencia.actor ?? null) : null;
      const demandadoOriginal = anonimizar
        ? (dto.sentencia.demandado ?? null)
        : null;
      const actorPublico = anonimizar ? initials(actorOriginal) : null;
      const demandadoPublico = anonimizar ? initials(demandadoOriginal) : null;

      const creada = await tx.sentencia.create({
        data: {
          ...dto.sentencia,
          ...catalogFields,
          resena: dto.resena ?? dto.sentencia.resena,
          resenaPublicada: publicarResena,
          resenaPublicadaAt: publicarResena ? new Date() : null,
          resenaPublicadaById: publicarResena ? (usuarioId ?? null) : null,
          resenaUpdatedAt: dto.resena ? new Date() : null,
          resenaUpdatedById: dto.resena ? (usuarioId ?? null) : null,
          destacada,
          publicado: publicarSentencia,
          estadoCarga,
          actorOriginal,
          demandadoOriginal,
          actorPublico,
          demandadoPublico,
          anonimizado: anonimizar,
          ...buildSentenciaSearchData({
            ...dto.sentencia,
            ...catalogFields,
            resena: dto.resena ?? dto.sentencia.resena,
          }),
        },
      });

      if (dto.sumarios?.length) {
        await tx.sumario.createMany({
          data: dto.sumarios.map((sumario) => ({
            ...sumario,
            publicado: publicarSumarios ? true : (sumario.publicado ?? false),
            sentenciaId: creada.id,
            ...buildSumarioSearchData(sumario),
          })),
        });
      }

      if (dto.referenciasNormativas?.length) {
        await tx.referenciaNormativa.createMany({
          data: dto.referenciasNormativas.map((referencia) => ({
            ...referencia,
            sentenciaId: creada.id,
          })),
        });
      }

      if (dto.referenciasJurisprudenciales?.length) {
        await tx.referenciaJurisprudencial.createMany({
          data: dto.referenciasJurisprudenciales.map((referencia) => ({
            ...referencia,
            sentenciaId: creada.id,
          })),
        });
      }

      if (dto.referenciasDoctrinarias?.length) {
        await tx.referenciaDoctrinaria.createMany({
          data: dto.referenciasDoctrinarias.map((referencia) => ({
            ...referencia,
            sentenciaId: creada.id,
          })),
        });
      }

      return tx.sentencia.findUniqueOrThrow({
        where: { id: creada.id },
        include: {
          sumarios: { orderBy: { id: 'asc' } },
          archivosPdf: true,
        },
      });
    });

    if (publicarSentencia && opciones?.generarSlugPublico) {
      await this.generarSlug(sentencia.id);
    }

    return { data: sentencia };
  }

  async agregarSumariosLote(
    id: number,
    dto: CrearSumariosLoteDto,
    usuarioId?: number,
  ) {
    await this.ensureExists(id);

    const sumarios = await this.prisma.$transaction(async (tx) => {
      await tx.sumario.createMany({
        data: dto.sumarios.map((sumario) => ({
          ...sumario,
          sentenciaId: id,
          ...buildSumarioSearchData(sumario),
        })),
      });

      return tx.sumario.findMany({
        where: { sentenciaId: id },
        orderBy: { id: 'asc' },
      });
    });

    if (usuarioId && dto.sumarios.length > 0) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'SUMARIO',
        entidadId: id,
        accion: 'CREATE',
        descripcion: `Agregó ${dto.sumarios.length} sumario(s) en lote`,
        datosDespues: dto.sumarios,
      });
    }

    return { data: sumarios };
  }

  async update(
    id: number,
    updateSentenciaDto: UpdateSentenciaDto,
    usuarioId?: number,
  ) {
    await this.ensureExists(id);
    const before = await this.prisma.sentencia.findUniqueOrThrow({
      where: { id },
    });
    const catalogFields = await this.resolveCatalogFields({
      salaId: updateSentenciaDto.salaId,
      tipoFalloId: updateSentenciaDto.tipoFalloId,
      tribunalOrigenId: updateSentenciaDto.tribunalOrigenId,
      sala: updateSentenciaDto.sala,
      tipoFallo: updateSentenciaDto.tipoFallo,
      tribunalOrigen: updateSentenciaDto.tribunalOrigen,
    });

    const sentencia = await this.prisma.sentencia.update({
      where: { id },
      data: {
        ...updateSentenciaDto,
        ...catalogFields,
        ...buildSentenciaSearchData({
          ...before,
          ...updateSentenciaDto,
          ...catalogFields,
        }),
      },
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'SENTENCIA',
        entidadId: id,
        accion: 'UPDATE',
        descripcion: 'Editó sentencia',
        datosAntes: before,
        datosDespues: sentencia,
      });
    }

    return { data: sentencia };
  }

  async anonimizar(id: number, usuarioId?: number) {
    const actual = await this.prisma.sentencia.findUnique({
      where: { id },
      select: {
        id: true,
        actor: true,
        demandado: true,
        actorOriginal: true,
        demandadoOriginal: true,
      },
    });

    if (!actual) {
      throw new NotFoundException('Sentencia no encontrada');
    }

    const actorBase = actual.actorOriginal ?? actual.actor;
    const demandadoBase = actual.demandadoOriginal ?? actual.demandado;

    const sentencia = await this.prisma.sentencia.update({
      where: { id },
      data: {
        actorOriginal: actual.actorOriginal ?? actual.actor ?? null,
        demandadoOriginal: actual.demandadoOriginal ?? actual.demandado ?? null,
        actorPublico: initials(actorBase),
        demandadoPublico: initials(demandadoBase),
        anonimizado: true,
      },
      select: {
        id: true,
        actor: true,
        demandado: true,
        actorOriginal: true,
        demandadoOriginal: true,
        actorPublico: true,
        demandadoPublico: true,
        anonimizado: true,
      },
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'SENTENCIA',
        entidadId: id,
        accion: 'ANONIMIZAR',
        descripcion: 'Anonimizó fallo',
        datosAntes: actual,
        datosDespues: sentencia,
      });
    }

    return { data: sentencia };
  }

  async desanonimizar(id: number, usuarioId?: number) {
    const actual = await this.prisma.sentencia.findUnique({
      where: { id },
      select: {
        id: true,
        actorOriginal: true,
        demandadoOriginal: true,
      },
    });

    if (!actual) {
      throw new NotFoundException('Sentencia no encontrada');
    }

    const sentencia = await this.prisma.sentencia.update({
      where: { id },
      data: {
        actor: actual.actorOriginal ?? undefined,
        demandado: actual.demandadoOriginal ?? undefined,
        anonimizado: false,
      },
      select: {
        id: true,
        actor: true,
        demandado: true,
        actorOriginal: true,
        demandadoOriginal: true,
        actorPublico: true,
        demandadoPublico: true,
        anonimizado: true,
      },
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'SENTENCIA',
        entidadId: id,
        accion: 'DESANONIMIZAR',
        descripcion: 'Desanonimizó fallo',
        datosAntes: actual,
        datosDespues: sentencia,
      });
    }

    return { data: sentencia };
  }

  async getResumen(id: number) {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id },
      select: {
        id: true,
        resumenIa: true,
        resumenFuente: true,
        resumenPublicado: true,
        updatedAt: true,
      },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia no encontrada');
    }

    return { data: sentencia };
  }

  async updateResumen(id: number, dto: UpdateResumenDto) {
    await this.ensureExists(id);

    const sentencia = await this.prisma.sentencia.update({
      where: { id },
      data: {
        ...(dto.resumenIa !== undefined && { resumenIa: dto.resumenIa }),
        ...(dto.resumenFuente !== undefined && {
          resumenFuente: dto.resumenFuente,
        }),
        ...(dto.resumenPublicado !== undefined && {
          resumenPublicado: dto.resumenPublicado,
        }),
        ...buildSentenciaSearchData({
          ...(await this.prisma.sentencia.findUniqueOrThrow({ where: { id } })),
          resumenIa: dto.resumenIa,
        }),
      },
      select: {
        id: true,
        resumenIa: true,
        resumenFuente: true,
        resumenPublicado: true,
        updatedAt: true,
      },
    });

    return { data: sentencia };
  }

  async updateResena(id: number, dto: UpdateResenaDto, usuarioId?: number) {
    await this.ensureExists(id);
    const before = await this.prisma.sentencia.findUnique({
      where: { id },
      select: {
        id: true,
        resena: true,
        resenaPublicada: true,
        resenaUpdatedAt: true,
      },
    });

    const sentencia = await this.prisma.sentencia.update({
      where: { id },
      data: {
        resena: dto.resena ?? null,
        resenaUpdatedAt: new Date(),
        resenaUpdatedById: usuarioId ?? null,
        ...buildSentenciaSearchData({
          ...(await this.prisma.sentencia.findUniqueOrThrow({ where: { id } })),
          resena: dto.resena ?? null,
        }),
      },
      select: {
        id: true,
        resena: true,
        resenaPublicada: true,
        resenaUpdatedAt: true,
        updatedAt: true,
      },
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'RESEÑA',
        entidadId: id,
        accion: 'UPDATE',
        descripcion: 'Editó reseña',
        datosAntes: before,
        datosDespues: sentencia,
      });
    }

    return { data: sentencia };
  }

  async getResena(id: number) {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id },
      select: {
        id: true,
        resena: true,
        resenaPublicada: true,
        resenaUpdatedAt: true,
        resenaPublicadaAt: true,
        resenaUpdatedById: true,
        resenaPublicadaById: true,
      },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia no encontrada');
    }

    return { data: sentencia };
  }

  async setResenaPublicada(
    id: number,
    resenaPublicada: boolean,
    usuarioId?: number,
  ) {
    await this.ensureExists(id);

    const actual = await this.prisma.sentencia.findUnique({
      where: { id },
      select: {
        id: true,
        resena: true,
        resenaPublicada: true,
        resenaPublicadaAt: true,
      },
    });

    if (!actual) {
      throw new NotFoundException('Sentencia no encontrada');
    }

    if (resenaPublicada && !actual.resena?.trim()) {
      throw new BadRequestException('No se puede publicar una reseña vacía');
    }

    const sentencia = await this.prisma.sentencia.update({
      where: { id },
      data: {
        resenaPublicada,
        resenaPublicadaAt: resenaPublicada ? new Date() : null,
        resenaPublicadaById: resenaPublicada ? (usuarioId ?? null) : null,
      },
      select: {
        id: true,
        resena: true,
        resenaPublicada: true,
        resenaUpdatedAt: true,
        resenaPublicadaAt: true,
        resenaUpdatedById: true,
        resenaPublicadaById: true,
      },
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'RESEÑA',
        entidadId: id,
        accion: resenaPublicada ? 'PUBLICAR' : 'DESPUBLICAR',
        descripcion: resenaPublicada ? 'Publicó reseña' : 'Despublicó reseña',
        datosAntes: actual,
        datosDespues: sentencia,
      });
    }

    return { data: sentencia };
  }

  async getCita(id: number) {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia no encontrada');
    }

    return { data: this.buildCita(sentencia) };
  }

  async generarCita(id: number) {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia no encontrada');
    }

    const cita = this.buildCita(sentencia);

    await this.prisma.sentencia.update({
      where: { id },
      data: {
        citaPersonalizada: cita.citaCompleta,
        ...buildSentenciaSearchData({
          ...sentencia,
          citaPersonalizada: cita.citaCompleta,
        }),
      },
    });

    return { data: cita };
  }

  async getFicha(id: number) {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id },
      include: {
        citasFallo: {
          orderBy: [
            { confirmada: 'desc' },
            { creadaManual: 'desc' },
            { createdAt: 'desc' },
          ],
        },
        referenciasNormativas: {
          orderBy: { createdAt: 'asc' },
        },
        referenciasJurisprudenciales: {
          orderBy: { createdAt: 'asc' },
          include: {
            falloRelacionado: {
              select: {
                id: true,
                numeroSentencia: true,
                expediente: true,
                sala: true,
                fecha: true,
                slugPublico: true,
              },
            },
          },
        },
        referenciasDoctrinarias: {
          orderBy: { createdAt: 'asc' },
        },
        sumarios: {
          where: { activo: true },
          orderBy: { id: 'asc' },
        },
        archivosPdf: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia no encontrada');
    }
    const archivosPdf = this.filterValidPdfs(sentencia.archivosPdf);

    return {
      data: {
        sentencia,
        resumen: {
          texto: sentencia.resumenIa,
          fuente: sentencia.resumenFuente,
          publicado: sentencia.resumenPublicado,
        },
        resena: sentencia.resena,
        cita: this.buildCita(sentencia),
        sumarios: sentencia.sumarios,
        citasFallo: sentencia.citasFallo,
        referenciasNormativas: sentencia.referenciasNormativas,
        referenciasJurisprudenciales: sentencia.referenciasJurisprudenciales,
        referenciasDoctrinarias: sentencia.referenciasDoctrinarias,
        archivosPdf,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  async getDocumento(id: number, usuarioId?: number) {
    const documento = await this.getFicha(id);

    this.eventosConsultaService.trackSafe({
      tipoEvento: 'view_documento',
      usuarioId,
      sentenciaId: documento.data.sentencia.id,
      metadata: { scope: 'internal-document' },
    });

    return documento;
  }

  async exportFicha(id: number, formato: 'html' | 'txt' | 'json' = 'json') {
    const ficha = await this.getFicha(id);

    if (formato === 'json') {
      return ficha;
    }

    if (formato === 'txt') {
      return this.buildFichaTxt(ficha.data);
    }

    return this.buildFichaHtml(ficha.data);
  }

  async setPublicado(id: number, publicado: boolean, usuarioId?: number) {
    await this.ensureExists(id);
    const before = await this.prisma.sentencia.findUniqueOrThrow({
      where: { id },
    });
    if (publicado && !before.activo) {
      throw new BadRequestException('No se puede publicar un fallo archivado.');
    }

    const publishedAt = publicado ? new Date() : null;
    const sentenciaActualizada = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.sentencia.update({
        where: { id },
        data: {
          publicado,
          publishedAt,
          estadoCarga: publicado ? 'PUBLICADA' : 'BORRADOR',
        },
      });
      const links = await tx.corpusDocumentLink.findMany({
        where: {
          targetDomain: 'JURISPRUDENCIA',
          targetType: 'SENTENCIA',
          targetId: String(id),
          relationship: 'ASSOCIATED_WITH',
        },
        select: { documentId: true },
      });
      if (links.length) {
        await tx.corpusDocument.updateMany({
          where: {
            id: { in: links.map((link) => link.documentId) },
            documentScope: 'GENERAL',
          },
          data: { visibility: publicado ? 'PUBLIC' : 'INTERNAL' },
        });
      }
      return updated;
    });

    const sentencia =
      publicado && !sentenciaActualizada.slugPublico
        ? (await this.generarSlug(id, sentenciaActualizada)).data
        : sentenciaActualizada;

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'SENTENCIA',
        entidadId: id,
        accion: publicado ? 'PUBLICAR' : 'DESPUBLICAR',
        descripcion: publicado ? 'Publicó sentencia' : 'Despublicó sentencia',
        datosAntes: before,
        datosDespues: sentencia,
      });
    }

    return { data: sentencia };
  }

  async archive(id: number, usuarioId?: number) {
    await this.ensureExists(id);
    const before = await this.prisma.sentencia.findUniqueOrThrow({
      where: { id },
    });
    const sentencia = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.sentencia.update({
        where: { id },
        data: {
          publicado: false,
          publishedAt: null,
          activo: false,
          estadoCarga: 'ARCHIVADA',
        },
      });
      const links = await tx.corpusDocumentLink.findMany({
        where: {
          targetDomain: 'JURISPRUDENCIA',
          targetType: 'SENTENCIA',
          targetId: String(id),
          relationship: 'ASSOCIATED_WITH',
        },
        select: { documentId: true },
      });
      if (links.length)
        await tx.corpusDocument.updateMany({
          where: {
            id: { in: links.map((link) => link.documentId) },
            documentScope: 'GENERAL',
          },
          data: { visibility: 'INTERNAL' },
        });
      return updated;
    });
    if (usuarioId)
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'SENTENCIA',
        entidadId: id,
        accion: 'ARCHIVAR',
        descripcion: 'Archivó sentencia y la retiró de la consulta pública',
        datosAntes: before,
        datosDespues: sentencia,
      });
    return { data: sentencia };
  }

  async findRecentPublished(limit = 10) {
    const data = await this.prisma.sentencia.findMany({
      where: { publicado: true, activo: true },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 20),
      include: {
        sumarios: {
          where: { activo: true, publicado: true },
          orderBy: { id: 'asc' },
          take: 3,
        },
      },
    });
    return { data };
  }

  async findLatestByDecisionDate(limit = 10) {
    const data = await this.prisma.sentencia.findMany({
      where: { publicado: true, activo: true, fecha: { not: null } },
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 20),
      select: {
        id: true,
        slugPublico: true,
        caratula: true,
        expediente: true,
        sala: true,
        fecha: true,
        numeroSentencia: true,
      },
    });
    return { data };
  }

  async findPotentialDuplicates(id: number) {
    const current = await this.prisma.sentencia.findUnique({
      where: { id },
      select: {
        id: true,
        expediente: true,
        sala: true,
        fecha: true,
        numeroSentencia: true,
        caratula: true,
      },
    });
    if (!current) throw new NotFoundException('Sentencia no encontrada');
    const identity = current.expediente?.trim();
    if (!identity && !current.numeroSentencia?.trim()) return { data: [] };
    const matches = await this.prisma.sentencia.findMany({
      where: {
        id: { not: id },
        activo: true,
        OR: [
          ...(identity
            ? [
                {
                  expediente: {
                    equals: identity,
                    mode: 'insensitive' as const,
                  },
                  ...(current.sala
                    ? {
                        sala: {
                          equals: current.sala,
                          mode: 'insensitive' as const,
                        },
                      }
                    : {}),
                  ...(current.fecha ? { fecha: current.fecha } : {}),
                },
              ]
            : []),
          ...(current.numeroSentencia
            ? [
                {
                  numeroSentencia: {
                    equals: current.numeroSentencia,
                    mode: 'insensitive' as const,
                  },
                },
              ]
            : []),
        ],
      },
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      take: 5,
      select: {
        id: true,
        expediente: true,
        sala: true,
        fecha: true,
        numeroSentencia: true,
        caratula: true,
        publicado: true,
      },
    });
    return { data: matches };
  }

  async setDestacada(id: number, destacada: boolean, usuarioId?: number) {
    await this.ensureExists(id);
    const before = await this.prisma.sentencia.findUniqueOrThrow({
      where: { id },
    });

    const sentencia = await this.prisma.sentencia.update({
      where: { id },
      data: { destacada },
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'SENTENCIA',
        entidadId: id,
        accion: destacada ? 'DESTACAR' : 'QUITAR_DESTACADA',
        descripcion: destacada
          ? 'Marcó sentencia como destacada'
          : 'Quitó sentencia de destacadas',
        datosAntes: before,
        datosDespues: sentencia,
      });
    }

    return { data: sentencia };
  }

  async getDestacadas() {
    const data = await this.prisma.sentencia.findMany({
      where: { destacada: true, activo: true },
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      take: 12,
      include: {
        _count: {
          select: { sumarios: true, archivosPdf: true, favoritos: true },
        },
      },
    });

    return { data };
  }

  async generarSlug(id: number, publishedSnapshot?: Sentencia) {
    const sentencia =
      publishedSnapshot ??
      (await this.prisma.sentencia.findUnique({
        where: { id },
      }));

    if (!sentencia) {
      throw new NotFoundException('Sentencia no encontrada');
    }

    if (!sentencia.publicado) {
      throw new BadRequestException(
        'Solo se puede generar slug para sentencias publicadas',
      );
    }

    const temaPrincipal = publishedSnapshot
      ? null
      : await this.getTemaPrincipalPublico(sentencia.id);
    const anio = sentencia.fecha?.getFullYear();
    const slugBase = slugify(
      [
        sentencia.sala,
        temaPrincipal ?? sentencia.objeto,
        anio ?? sentencia.numeroSentencia,
      ]
        .filter(Boolean)
        .join(' '),
    );

    const slugPublico = slugBase || `sentencia-${sentencia.id}`;

    try {
      const data = await this.prisma.sentencia.update({
        where: { id },
        data: { slugPublico },
        select: { id: true, slugPublico: true, publicado: true },
      });

      return { data };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const data = await this.prisma.sentencia.update({
          where: { id },
          data: { slugPublico: `${slugPublico}-${id}` },
          select: { id: true, slugPublico: true, publicado: true },
        });

        return { data };
      }

      throw error;
    }
  }

  async getPublicIdentity(identifier: string) {
    const where = this.publicIdentifierWhere(identifier);
    const sentencia = await this.prisma.sentencia.findFirst({
      where,
      select: { id: true, slugPublico: true },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia pública no encontrada');
    }

    return sentencia;
  }

  async getPublicBySlug(slug: string) {
    const sentencia = await this.prisma.sentencia.findFirst({
      where: this.publicIdentifierWhere(slug),
      include: {
        citasFallo: {
          where: { confirmada: true },
          orderBy: { createdAt: 'desc' },
        },
        referenciasNormativas: {
          orderBy: { createdAt: 'asc' },
        },
        referenciasJurisprudenciales: {
          orderBy: { createdAt: 'asc' },
          include: {
            falloRelacionado: {
              select: {
                id: true,
                publicado: true,
                activo: true,
                numeroSentencia: true,
                expediente: true,
                sala: true,
                fecha: true,
                slugPublico: true,
              },
            },
          },
        },
        referenciasDoctrinarias: {
          orderBy: { createdAt: 'asc' },
        },
        sumarios: {
          where: { publicado: true, activo: true },
          orderBy: { id: 'asc' },
        },
        archivosPdf: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia pública no encontrada');
    }
    const archivosPdf = this.filterValidPdfs(sentencia.archivosPdf);

    this.eventosConsultaService.trackSafe({
      tipoEvento: 'view_sentencia',
      sentenciaId: sentencia.id,
      metadata: { scope: 'public-slug' },
    });

    const publicParticipants = toPublicParticipants(sentencia);

    return {
      data: {
        id: sentencia.id,
        slugPublico: sentencia.slugPublico,
        numeroSentencia: sentencia.numeroSentencia,
        tipoFallo: sentencia.tipoFallo,
        sala: sentencia.sala,
        fecha: sentencia.fecha,
        expediente: sentencia.expediente,
        tribunalOrigen: sentencia.tribunalOrigen,
        caratula: sentencia.caratula,
        actor: publicParticipants.actor ?? null,
        demandado: publicParticipants.demandado ?? null,
        objeto: sentencia.objeto,
        magistrados: sentencia.magistrados,
        juez: sentencia.juez,
        resumen: sentencia.resumenPublicado ? sentencia.resumenIa : null,
        resena: sentencia.resenaPublicada ? sentencia.resena : null,
        cita: this.buildCita({
          ...sentencia,
          actor: publicParticipants.actor ?? null,
          demandado: publicParticipants.demandado ?? null,
        }),
        citasFallo: sentencia.citasFallo,
        referenciasNormativas: sentencia.referenciasNormativas,
        referenciasJurisprudenciales: publicizeCuratorialReferences(
          sentencia.referenciasJurisprudenciales,
        ),
        referenciasDoctrinarias: sentencia.referenciasDoctrinarias,
        sumarios: sentencia.sumarios,
        archivosPdf,
      },
    };
  }

  async getPublicCitasBySlug(slug: string) {
    const sentencia = await this.prisma.sentencia.findFirst({
      where: this.publicIdentifierWhere(slug),
      select: {
        id: true,
        citasFallo: {
          where: { confirmada: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia pública no encontrada');
    }

    return { data: sentencia.citasFallo };
  }

  async getPublicFichaBySlug(slug: string) {
    const sentencia = await this.prisma.sentencia.findFirst({
      where: this.publicIdentifierWhere(slug),
      include: {
        citasFallo: {
          where: { confirmada: true },
          orderBy: [{ creadaManual: 'desc' }, { createdAt: 'desc' }],
        },
        referenciasNormativas: {
          orderBy: { createdAt: 'asc' },
        },
        referenciasJurisprudenciales: {
          orderBy: { createdAt: 'asc' },
          include: {
            falloRelacionado: {
              select: {
                id: true,
                publicado: true,
                activo: true,
                numeroSentencia: true,
                expediente: true,
                sala: true,
                fecha: true,
                slugPublico: true,
              },
            },
          },
        },
        referenciasDoctrinarias: {
          orderBy: { createdAt: 'asc' },
        },
        sumarios: {
          where: { publicado: true, activo: true },
          orderBy: { id: 'asc' },
        },
        archivosPdf: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia pública no encontrada');
    }
    const archivosPdf = this.filterValidPdfs(sentencia.archivosPdf);

    const publicParticipants = toPublicParticipants(sentencia);

    return {
      data: {
        sentencia: {
          id: sentencia.id,
          slugPublico: sentencia.slugPublico,
          numeroSentencia: sentencia.numeroSentencia,
          tipoFallo: sentencia.tipoFallo,
          sala: sentencia.sala,
          fecha: sentencia.fecha,
          expediente: sentencia.expediente,
          tribunalOrigen: sentencia.tribunalOrigen,
          caratula: sentencia.caratula,
          actor: publicParticipants.actor ?? null,
          demandado: publicParticipants.demandado ?? null,
          objeto: sentencia.objeto,
          magistrados: sentencia.magistrados,
          juez: sentencia.juez,
        },
        resumen: {
          texto: sentencia.resumenPublicado ? sentencia.resumenIa : null,
          fuente: sentencia.resumenPublicado ? sentencia.resumenFuente : null,
          publicado: sentencia.resumenPublicado,
        },
        resena: sentencia.resenaPublicada ? sentencia.resena : null,
        cita: this.buildCita({
          ...sentencia,
          actor: publicParticipants.actor ?? null,
          demandado: publicParticipants.demandado ?? null,
        }),
        sumarios: sentencia.sumarios,
        citasFallo: sentencia.citasFallo,
        referenciasNormativas: sentencia.referenciasNormativas,
        referenciasJurisprudenciales: publicizeCuratorialReferences(
          sentencia.referenciasJurisprudenciales,
        ),
        referenciasDoctrinarias: sentencia.referenciasDoctrinarias,
        archivosPdf,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  async getPublicDocumentoBySlug(slug: string) {
    const documento = await this.getPublicFichaBySlug(slug);

    this.eventosConsultaService.trackSafe({
      tipoEvento: 'view_documento',
      sentenciaId: documento.data.sentencia.id,
      metadata: { scope: 'public-document' },
    });

    return documento;
  }

  async getTimeline(id: number, order: 'asc' | 'desc' = 'desc') {
    await this.ensureExists(id);
    return this.logsService.findTimelineBySentencia(id, order);
  }

  async remove(id: number, usuarioId?: number) {
    await this.ensureExists(id);
    const before = await this.prisma.sentencia.findUniqueOrThrow({
      where: { id },
    });

    const sentencia = await this.prisma.sentencia.update({
      where: { id },
      data: { activo: false },
    });

    if (usuarioId) {
      await this.logsService.registrarAccion({
        usuarioId,
        entidad: 'SENTENCIA',
        entidadId: id,
        accion: 'DELETE',
        descripcion: 'Eliminó lógicamente sentencia',
        datosAntes: before,
        datosDespues: sentencia,
      });
    }

    return { data: sentencia };
  }

  private publicIdentifierWhere(identifier: string) {
    const numericId = Number(identifier);
    return {
      publicado: true,
      activo: true,
      OR: [
        { slugPublico: identifier },
        ...(Number.isInteger(numericId) && numericId > 0
          ? [{ id: numericId }]
          : []),
      ],
    };
  }

  private filterValidPdfs<T extends Pick<ArchivoPdf, 'rutaArchivo'>>(
    archivos: T[],
  ): T[] {
    return obtenerPdfsReales(archivos as Array<T & { id: number }>);
  }

  private normalizePdfState<
    T extends {
      archivosPdf?: Array<ArchivoPdf>;
      tienePdf?: boolean;
      _count?: { archivosPdf?: number };
    },
  >(sentencia: T): T {
    if (!sentencia.archivosPdf) {
      return sentencia;
    }

    const archivosPdf = this.filterValidPdfs(sentencia.archivosPdf);

    return {
      ...sentencia,
      archivosPdf,
      tienePdf: archivosPdf.length > 0,
      _count: sentencia._count
        ? { ...sentencia._count, archivosPdf: archivosPdf.length }
        : sentencia._count,
    };
  }

  private async getTemaPrincipalPublico(sentenciaId: number) {
    const sumario = await this.prisma.sumario.findFirst({
      where: {
        sentenciaId,
        activo: true,
        publicado: true,
        tema: { not: null },
      },
      orderBy: { id: 'asc' },
      select: { tema: true },
    });

    return sumario?.tema ?? null;
  }

  private async ensureExists(id: number) {
    const sentencia = await this.prisma.sentencia.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!sentencia) {
      throw new NotFoundException('Sentencia no encontrada');
    }
  }

  private buildWhere(query: QuerySentenciasDto): Prisma.SentenciaWhereInput {
    return {
      ...(query.sala && {
        sala: { contains: query.sala, mode: 'insensitive' },
      }),
      ...(query.tipoFallo && {
        tipoFallo: { contains: query.tipoFallo, mode: 'insensitive' },
      }),
      ...(query.publicado !== undefined && { publicado: query.publicado }),
      ...(query.activo !== undefined && { activo: query.activo }),
      ...(query.expediente && {
        expediente: { contains: query.expediente, mode: 'insensitive' },
      }),
      ...(query.numeroSentencia && {
        numeroSentencia: {
          contains: query.numeroSentencia,
          mode: 'insensitive',
        },
      }),
      ...(query.actor && {
        actor: { contains: query.actor, mode: 'insensitive' },
      }),
      ...(query.demandado && {
        demandado: { contains: query.demandado, mode: 'insensitive' },
      }),
      ...((query.fechaDesde || query.fechaHasta) && {
        fecha: {
          ...(query.fechaDesde && { gte: query.fechaDesde }),
          ...(query.fechaHasta && { lte: query.fechaHasta }),
        },
      }),
    };
  }

  private buildCita(sentencia: Sentencia): CitaData {
    return formatCitation(sentencia);
  }

  private buildFichaTxt(data: FichaData) {
    const sumarios = data.sumarios
      .map(
        (sumario) =>
          `- ${sumario.numeroSumario ?? `#${sumario.id}`} | ${sumario.tema ?? 'Sin tema'}\n${sumario.texto}`,
      )
      .join('\n\n');
    const archivos = data.archivosPdf
      .map((archivo) => `- ${archivo.nombreOriginal ?? archivo.nombreArchivo}`)
      .join('\n');
    const citasFallo = data.citasFallo
      .map((cita) => `- [${cita.tipo}] ${cita.referencia}`)
      .join('\n');

    return [
      `Ficha de sentencia #${data.sentencia.id}`,
      `Generada: ${data.generatedAt}`,
      `Cita: ${data.cita.citaCompleta}`,
      `Resumen: ${data.resumen.texto ?? 'Sin resumen'}`,
      `Reseña: ${data.resena ?? 'Sin reseña'}`,
      `Sumarios:\n${sumarios || 'Sin sumarios'}`,
      `Este fallo cita a:\n${citasFallo || 'Sin citas registradas'}`,
      `Normas relacionadas:\n${
        data.referenciasNormativas.length
          ? data.referenciasNormativas
              .map(
                (item) =>
                  `- ${item.tipoNorma}${item.numeroNorma ? ` ${item.numeroNorma}` : ''}${
                    item.articulo ? ` art. ${item.articulo}` : ''
                  }${item.inciso ? ` inc. ${item.inciso}` : ''}`,
              )
              .join('\n')
          : 'Sin referencias normativas'
      }`,
      `Jurisprudencia relacionada:\n${
        data.referenciasJurisprudenciales.length
          ? data.referenciasJurisprudenciales
              .map((item) => `- ${item.referencia}`)
              .join('\n')
          : 'Sin referencias jurisprudenciales'
      }`,
      `Doctrina:\n${
        data.referenciasDoctrinarias.length
          ? data.referenciasDoctrinarias
              .map(
                (item) =>
                  `- ${[item.autor, item.titulo, item.fuente].filter(Boolean).join(', ')}`,
              )
              .join('\n')
          : 'Sin referencias doctrinarias'
      }`,
      `Archivos:\n${archivos || 'Sin PDFs'}`,
    ].join('\n\n');
  }

  private buildFichaHtml(data: FichaData) {
    const sumarios = data.sumarios.length
      ? `<ul>${data.sumarios
          .map(
            (sumario) =>
              `<li><strong>${sumario.numeroSumario ?? `#${sumario.id}`}</strong> - ${sumario.tema ?? 'Sin tema'}<br/>${sumario.texto}</li>`,
          )
          .join('')}</ul>`
      : '<p>Sin sumarios.</p>';
    const archivos = data.archivosPdf.length
      ? `<ul>${data.archivosPdf
          .map(
            (archivo) =>
              `<li>${archivo.nombreOriginal ?? archivo.nombreArchivo}</li>`,
          )
          .join('')}</ul>`
      : '<p>Sin PDFs.</p>';
    const citasFallo = data.citasFallo.length
      ? `<ul>${data.citasFallo
          .map(
            (cita) =>
              `<li><strong>${cita.tipo}</strong> - ${cita.referencia}${
                cita.contexto ? `<br/>${cita.contexto}` : ''
              }</li>`,
          )
          .join('')}</ul>`
      : '<p>Sin citas registradas.</p>';
    const referenciasNormativas = data.referenciasNormativas.length
      ? `<ul>${data.referenciasNormativas
          .map(
            (item) =>
              `<li>${item.tipoNorma}${item.numeroNorma ? ` ${item.numeroNorma}` : ''}${
                item.articulo ? ` art. ${item.articulo}` : ''
              }${item.inciso ? ` inc. ${item.inciso}` : ''}${
                item.textoReferencia ? `<br/>${item.textoReferencia}` : ''
              }</li>`,
          )
          .join('')}</ul>`
      : '<p>Sin referencias normativas.</p>';
    const referenciasJurisprudenciales = data.referenciasJurisprudenciales
      .length
      ? `<ul>${data.referenciasJurisprudenciales
          .map(
            (item) =>
              `<li>${item.referencia}${
                item.textoOriginal ? `<br/>${item.textoOriginal}` : ''
              }</li>`,
          )
          .join('')}</ul>`
      : '<p>Sin referencias jurisprudenciales.</p>';
    const referenciasDoctrinarias = data.referenciasDoctrinarias.length
      ? `<ul>${data.referenciasDoctrinarias
          .map(
            (item) =>
              `<li>${[item.autor, item.titulo, item.fuente, item.anio].filter(Boolean).join(' - ')}${
                item.textoReferencia ? `<br/>${item.textoReferencia}` : ''
              }</li>`,
          )
          .join('')}</ul>`
      : '<p>Sin referencias doctrinarias.</p>';

    return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Ficha Sentencia ${data.sentencia.id}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 32px; color: #111827; }
      h1, h2 { margin-bottom: 8px; }
      section { margin-bottom: 24px; }
      p, li { line-height: 1.5; }
    </style>
  </head>
  <body>
    <h1>Ficha de Sentencia #${data.sentencia.id}</h1>
    <p>Generada: ${data.generatedAt}</p>
    <section><h2>Cita</h2><p>${data.cita.citaCompleta}</p></section>
    <section><h2>Resumen</h2><p>${data.resumen.texto ?? 'Sin resumen'}</p></section>
    <section><h2>Reseña</h2><p>${data.resena ?? 'Sin reseña'}</p></section>
    <section><h2>Sumarios</h2>${sumarios}</section>
    <section><h2>Este fallo cita a</h2>${citasFallo}</section>
    <section><h2>Normas relacionadas</h2>${referenciasNormativas}</section>
    <section><h2>Jurisprudencia relacionada</h2>${referenciasJurisprudenciales}</section>
    <section><h2>Doctrina</h2>${referenciasDoctrinarias}</section>
    <section><h2>Archivos PDF</h2>${archivos}</section>
  </body>
</html>`;
  }
}

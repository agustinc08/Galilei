import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeExpediente } from '../sentencias/utils/expediente-normalizer';
import { CreateComparisonDto } from './dto/create-comparison.dto';

const MAX_COMPARISON_ITEMS = 4;
const COMPARISON_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const PUBLIC_SENTENCE_SELECT = {
  id: true,
  slugPublico: true,
  numeroSentencia: true,
  tipoFallo: true,
  sala: true,
  fecha: true,
  expediente: true,
  tribunalOrigen: true,
  caratula: true,
  actor: true,
  demandado: true,
  anonimizado: true,
  actorPublico: true,
  demandadoPublico: true,
  objeto: true,
  magistrados: true,
  juez: true,
  resena: true,
  resenaPublicada: true,
  resumenIa: true,
  resumenPublicado: true,
  resumenFuente: true,
  sumarios: {
    where: { publicado: true, activo: true },
    orderBy: { id: 'asc' as const },
    select: { id: true, numeroSumario: true, tema: true, texto: true },
  },
  archivosPdf: { select: { id: true }, take: 1 },
} as const;

function parseSlugs(raw: string | string[] | undefined) {
  if (typeof raw !== 'string' || raw.length > 700) {
    throw new BadRequestException(
      'La comparación debe incluir entre 2 y 4 fallos públicos.',
    );
  }
  const slugs = raw.split(',').map((slug) => slug.trim());
  if (
    slugs.length < 2 ||
    slugs.length > MAX_COMPARISON_ITEMS ||
    slugs.some((slug) => !COMPARISON_SLUG.test(slug)) ||
    new Set(slugs).size !== slugs.length
  ) {
    throw new BadRequestException(
      'La comparación debe incluir entre 2 y 4 fallos públicos distintos.',
    );
  }
  return slugs;
}

function requireValidSlugs(slugs: unknown) {
  if (
    !Array.isArray(slugs) ||
    slugs.length < 2 ||
    slugs.length > MAX_COMPARISON_ITEMS ||
    slugs.some(
      (slug) => typeof slug !== 'string' || !COMPARISON_SLUG.test(slug),
    ) ||
    new Set(slugs).size !== slugs.length
  ) {
    throw new BadRequestException(
      'La comparación debe incluir entre 2 y 4 fallos públicos distintos.',
    );
  }
  return slugs as string[];
}

function genericNotFound() {
  return new NotFoundException('La comparación no está disponible.');
}

@Injectable()
export class ResearchComparisonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logsService: LogsService,
  ) {}

  async resolvePublic(rawSlugs: string | string[] | undefined) {
    const slugs = parseSlugs(rawSlugs);
    const sentences = await this.prisma.sentencia.findMany({
      where: {
        slugPublico: { in: slugs },
        publicado: true,
        activo: true,
      },
      select: PUBLIC_SENTENCE_SELECT,
    });
    if (
      sentences.length !== slugs.length ||
      sentences.some((sentence) => !sentence.slugPublico)
    ) {
      throw genericNotFound();
    }

    const bySlug = new Map(
      sentences.map((sentence) => [sentence.slugPublico!, sentence]),
    );
    const ordered = slugs.map((slug) => bySlug.get(slug)!);
    const sentenceIds = ordered.map((sentence) => sentence.id);
    const verifiedWhere = {
      status: 'VERIFIED' as const,
      relationshipType: 'CITES',
      targetSentenceId: { not: null },
      sourceSentence: { is: { publicado: true, activo: true } },
      targetSentence: { is: { publicado: true, activo: true } },
    };
    const [outgoingCounts, incomingCounts, crossCitations] = await Promise.all([
      this.prisma.sentenciaRelationshipCandidate.groupBy({
        by: ['sourceSentenceId'],
        where: { ...verifiedWhere, sourceSentenceId: { in: sentenceIds } },
        _count: { _all: true },
      }),
      this.prisma.sentenciaRelationshipCandidate.groupBy({
        by: ['targetSentenceId'],
        where: { ...verifiedWhere, targetSentenceId: { in: sentenceIds } },
        _count: { _all: true },
      }),
      this.prisma.sentenciaRelationshipCandidate.findMany({
        where: {
          ...verifiedWhere,
          sourceSentenceId: { in: sentenceIds },
          targetSentenceId: { in: sentenceIds },
        },
        select: {
          sourceSentenceId: true,
          targetSentenceId: true,
          rawCitation: true,
          page: true,
        },
        orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
        take: 500,
      }),
    ]);
    const outgoingById = new Map(
      outgoingCounts.map((item) => [item.sourceSentenceId, item._count._all]),
    );
    const incomingById = new Map(
      incomingCounts.flatMap((item) =>
        item.targetSentenceId === null
          ? []
          : [[item.targetSentenceId, item._count._all] as const],
      ),
    );
    const slugById = new Map(
      ordered.map((sentence) => [sentence.id, sentence.slugPublico!]),
    );

    const data = ordered.map((sentence) => {
      const normalizedExpediente = normalizeExpediente(sentence.expediente);
      const participants = sentence.anonimizado
        ? {
            actor: sentence.actorPublico,
            demandado: sentence.demandadoPublico,
          }
        : { actor: sentence.actor, demandado: sentence.demandado };
      return {
        slug: sentence.slugPublico!,
        caratula: sentence.caratula,
        numeroSentencia: sentence.numeroSentencia,
        tipoFallo: sentence.tipoFallo,
        sala: sentence.sala,
        fecha: sentence.fecha,
        expediente: sentence.expediente,
        tribunalOrigen: sentence.tribunalOrigen,
        objeto: sentence.objeto,
        actor: participants.actor,
        demandado: participants.demandado,
        magistrados: sentence.magistrados,
        juez: sentence.juez,
        resenaEditorial: sentence.resenaPublicada ? sentence.resena : null,
        resumenAi: sentence.resumenPublicado ? sentence.resumenIa : null,
        resumenAiFuente: sentence.resumenPublicado
          ? sentence.resumenFuente
          : null,
        sumarios: sentence.sumarios,
        hasPdf: sentence.archivosPdf.length > 0,
        verifiedCitesCount: outgoingById.get(sentence.id) ?? 0,
        verifiedCitedByCount: incomingById.get(sentence.id) ?? 0,
        sameExpedienteAs: normalizedExpediente
          ? ordered
              .filter(
                (other) =>
                  other.id !== sentence.id &&
                  normalizeExpediente(other.expediente) ===
                    normalizedExpediente,
              )
              .map((other) => other.slugPublico!)
          : [],
      };
    });

    return {
      data: {
        judgments: data,
        verifiedCrossCitations: crossCitations.flatMap((relation) => {
          const sourceSlug = slugById.get(relation.sourceSentenceId);
          const targetSlug =
            relation.targetSentenceId === null
              ? undefined
              : slugById.get(relation.targetSentenceId);
          return sourceSlug && targetSlug
            ? [
                {
                  sourceSlug,
                  targetSlug,
                  rawCitation: relation.rawCitation,
                  page: relation.page,
                },
              ]
            : [];
        }),
      },
    };
  }

  async findAll(ownerId: number) {
    const comparisons = await this.prisma.researchComparison.findMany({
      where: { ownerId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        items: {
          orderBy: { position: 'asc' },
          select: {
            sentencia: {
              select: { slugPublico: true, publicado: true, activo: true },
            },
          },
        },
      },
    });
    return {
      data: comparisons
        .filter(
          (comparison) =>
            comparison.items.length >= 2 &&
            comparison.items.length <= MAX_COMPARISON_ITEMS &&
            comparison.items.every(
              (item) =>
                item.sentencia.publicado &&
                item.sentencia.activo &&
                item.sentencia.slugPublico,
            ),
        )
        .map((comparison) => ({
          id: comparison.id,
          name: comparison.name,
          createdAt: comparison.createdAt,
          updatedAt: comparison.updatedAt,
          slugs: comparison.items.map((item) => item.sentencia.slugPublico!),
        })),
    };
  }

  async findOne(ownerId: number, id: number) {
    const comparison = await this.prisma.researchComparison.findFirst({
      where: { id, ownerId },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        items: {
          orderBy: { position: 'asc' },
          select: {
            sentencia: {
              select: { slugPublico: true, publicado: true, activo: true },
            },
          },
        },
      },
    });
    if (
      !comparison ||
      comparison.items.length < 2 ||
      comparison.items.length > MAX_COMPARISON_ITEMS ||
      comparison.items.some(
        (item) =>
          !item.sentencia.publicado ||
          !item.sentencia.activo ||
          !item.sentencia.slugPublico,
      )
    ) {
      throw genericNotFound();
    }
    return {
      data: {
        id: comparison.id,
        name: comparison.name,
        createdAt: comparison.createdAt,
        updatedAt: comparison.updatedAt,
        slugs: comparison.items.map((item) => item.sentencia.slugPublico!),
      },
    };
  }

  async create(ownerId: number, dto: CreateComparisonDto) {
    const slugs = requireValidSlugs(dto.slugs);
    const name = dto.name.trim();
    if (!name || name.length > 100) {
      throw new BadRequestException(
        'El nombre debe tener entre 1 y 100 caracteres.',
      );
    }
    const sentences = await this.prisma.sentencia.findMany({
      where: { slugPublico: { in: slugs }, publicado: true, activo: true },
      select: { id: true, slugPublico: true },
    });
    if (
      sentences.length !== slugs.length ||
      sentences.some((item) => !item.slugPublico)
    ) {
      throw genericNotFound();
    }
    const bySlug = new Map(
      sentences.map((sentence) => [sentence.slugPublico!, sentence]),
    );
    const ordered = slugs.map((slug) => bySlug.get(slug)!);
    const created = await this.prisma.researchComparison.create({
      data: {
        ownerId,
        name,
        items: {
          create: ordered.map((sentence, position) => ({
            sentenciaId: sentence.id,
            position,
          })),
        },
      },
      select: { id: true },
    });
    await this.logsService.registrarAccion({
      usuarioId: ownerId,
      entidad: 'RESEARCH_COMPARISON',
      entidadId: created.id,
      accion: 'COMPARISON_CREATED',
      descripcion: 'Guardó una comparación de fallos públicos.',
      datosDespues: { itemCount: ordered.length },
    });
    return this.findOne(ownerId, created.id);
  }

  async updateName(ownerId: number, id: number, rawName: string) {
    const name = rawName.trim();
    if (!name || name.length > 100) {
      throw new BadRequestException(
        'El nombre debe tener entre 1 y 100 caracteres.',
      );
    }
    const before = await this.prisma.researchComparison.findFirst({
      where: { id, ownerId },
      select: { id: true, name: true },
    });
    if (!before) throw genericNotFound();
    await this.prisma.researchComparison.updateMany({
      where: { id, ownerId },
      data: { name },
    });
    await this.logsService.registrarAccion({
      usuarioId: ownerId,
      entidad: 'RESEARCH_COMPARISON',
      entidadId: id,
      accion: 'COMPARISON_UPDATED',
      descripcion: 'Renombró una comparación guardada.',
      datosAntes: { name: before.name },
      datosDespues: { name },
    });
    return this.findOne(ownerId, id);
  }

  async remove(ownerId: number, id: number) {
    const before = await this.prisma.researchComparison.findFirst({
      where: { id, ownerId },
      select: { id: true, name: true, _count: { select: { items: true } } },
    });
    if (!before) throw genericNotFound();
    const result = await this.prisma.researchComparison.deleteMany({
      where: { id, ownerId },
    });
    if (!result.count) throw genericNotFound();
    await this.logsService.registrarAccion({
      usuarioId: ownerId,
      entidad: 'RESEARCH_COMPARISON',
      entidadId: id,
      accion: 'COMPARISON_DELETED',
      descripcion: 'Eliminó una comparación guardada.',
      datosAntes: { name: before.name, itemCount: before._count.items },
    });
    return { data: { deleted: true } };
  }

  async findOwnedNotes(ownerId: number, rawSlugs: string | undefined) {
    const slugs = parseSlugs(rawSlugs);
    const notes = await this.prisma.researchCollectionItem.findMany({
      where: {
        collection: { is: { usuarioId: ownerId } },
        sentencia: {
          is: {
            slugPublico: { in: slugs },
            publicado: true,
            activo: true,
          },
        },
        nota: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        nota: true,
        collection: { select: { nombre: true } },
        sentencia: { select: { slugPublico: true } },
      },
    });
    return {
      data: notes.flatMap((item) =>
        item.nota?.trim() && item.sentencia.slugPublico
          ? [
              {
                slug: item.sentencia.slugPublico,
                collectionName: item.collection.nombre,
                note: item.nota,
              },
            ]
          : [],
      ),
    };
  }
}

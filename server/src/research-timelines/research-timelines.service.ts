import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeExpediente } from '../sentencias/utils/expediente-normalizer';
import {
  buildResearchBundle,
  createResearchBundleZip,
} from '../research-collections/research-bundle.util';
import { CreateTimelineDto } from './dto/create-timeline.dto';
import { UpdateTimelineDto } from './dto/update-timeline.dto';

const MAX_TIMELINE_ITEMS = 50;
const TIMELINE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const PUBLIC_JUDGMENT_SELECT = {
  id: true,
  slugPublico: true,
  caratula: true,
  numeroSentencia: true,
  tipoFallo: true,
  sala: true,
  fecha: true,
  expediente: true,
  anonimizado: true,
  actor: true,
  demandado: true,
  actorPublico: true,
  demandadoPublico: true,
  archivosPdf: { select: { id: true }, take: 1 },
  sumarios: { where: { publicado: true, activo: true }, select: { id: true } },
} as const;

type PublicJudgment = {
  id: number;
  slugPublico: string | null;
  caratula: string | null;
  numeroSentencia: string | null;
  tipoFallo: string | null;
  sala: string | null;
  fecha: Date | null;
  expediente: string | null;
  anonimizado: boolean;
  actor: string | null;
  demandado: string | null;
  actorPublico: string | null;
  demandadoPublico: string | null;
  archivosPdf: Array<{ id: number }>;
  sumarios: Array<{ id: number }>;
};

function genericNotFound() {
  return new NotFoundException('El espacio de evolución no está disponible.');
}

function requireValidSlugs(slugs: unknown) {
  if (
    !Array.isArray(slugs) ||
    slugs.length < 2 ||
    slugs.length > MAX_TIMELINE_ITEMS ||
    slugs.some(
      (slug) => typeof slug !== 'string' || !TIMELINE_SLUG.test(slug),
    ) ||
    new Set(slugs).size !== slugs.length
  ) {
    throw new BadRequestException(
      'La evolución debe incluir entre 2 y 50 fallos públicos distintos.',
    );
  }
  return slugs as string[];
}

function safeIsoDate(value: Date | null) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    return null;
  return value.toISOString();
}

function chronological(
  left: { decisionDate: string | null; slug: string },
  right: { decisionDate: string | null; slug: string },
) {
  if (left.decisionDate && right.decisionDate) {
    const byDate = left.decisionDate.localeCompare(right.decisionDate);
    if (byDate) return byDate;
  } else if (left.decisionDate) return -1;
  else if (right.decisionDate) return 1;
  return left.slug.localeCompare(right.slug, 'es');
}

@Injectable()
export class ResearchTimelinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logsService: LogsService,
  ) {}

  async resolvePublic(rawSlugs: unknown) {
    const slugs = requireValidSlugs(rawSlugs);
    const sentences = (await this.prisma.sentencia.findMany({
      where: { slugPublico: { in: slugs }, publicado: true, activo: true },
      select: PUBLIC_JUDGMENT_SELECT,
    })) as PublicJudgment[];
    const ordered = [...sentences]
      .filter((item) => item.slugPublico)
      .sort((a, b) => {
        const left = {
          decisionDate: safeIsoDate(a.fecha),
          slug: a.slugPublico!,
        };
        const right = {
          decisionDate: safeIsoDate(b.fecha),
          slug: b.slugPublico!,
        };
        return chronological(left, right);
      });
    const sentenceIds = ordered.map((item) => item.id);
    const verifiedWhere = {
      status: 'VERIFIED' as const,
      relationshipType: 'CITES',
      targetSentenceId: { not: null },
      sourceSentence: { is: { publicado: true, activo: true } },
      targetSentence: { is: { publicado: true, activo: true } },
    };
    let outgoingCounts: Array<{
      sourceSentenceId: number;
      _count: { _all: number };
    }> = [];
    let incomingCounts: Array<{
      targetSentenceId: number | null;
      _count: { _all: number };
    }> = [];
    let citationRows: Array<{
      sourceSentenceId: number;
      targetSentenceId: number | null;
      rawCitation: string;
      page: number | null;
    }> = [];
    if (sentenceIds.length) {
      [outgoingCounts, incomingCounts, citationRows] = await Promise.all([
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
          take: 2500,
        }),
      ]);
    }
    const slugById = new Map(
      ordered.map((item) => [item.id, item.slugPublico!]),
    );
    const judgments = ordered.map((sentence) => {
      const slug = sentence.slugPublico!;
      const decisionDate = safeIsoDate(sentence.fecha);
      const participants = sentence.anonimizado
        ? { actor: sentence.actorPublico, demandado: sentence.demandadoPublico }
        : { actor: sentence.actor, demandado: sentence.demandado };
      const citationParts = [
        sentence.caratula?.trim() ||
          [participants.actor, participants.demandado]
            .filter(Boolean)
            .join(' c/ ') ||
          'Sentencia sin carátula',
        sentence.sala?.trim()
          ? sentence.sala.toLocaleLowerCase('es-AR').startsWith('sala')
            ? sentence.sala
            : `Sala ${sentence.sala}`
          : null,
        decisionDate
          ? new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC' }).format(
              new Date(decisionDate),
            )
          : null,
        sentence.expediente?.trim()
          ? `Expte. ${sentence.expediente.trim()}`
          : null,
        sentence.numeroSentencia?.trim()
          ? `Sentencia ${sentence.numeroSentencia.trim()}`
          : null,
      ].filter(Boolean);
      return {
        slug,
        caratula: sentence.caratula,
        cita: citationParts.join(', '),
        numeroSentencia: sentence.numeroSentencia,
        tipoFallo: sentence.tipoFallo,
        sala: sentence.sala,
        decisionDate,
        dateStatus: decisionDate
          ? ('AVAILABLE' as const)
          : ('UNAVAILABLE' as const),
        year: decisionDate ? new Date(decisionDate).getUTCFullYear() : null,
        expediente: sentence.expediente,
        hasPdf: sentence.archivosPdf.length > 0,
        sumarioCount: sentence.sumarios.length,
        verifiedCitesCount:
          outgoingCounts.find((item) => item.sourceSentenceId === sentence.id)
            ?._count._all ?? 0,
        verifiedCitedByCount:
          incomingCounts.find((item) => item.targetSentenceId === sentence.id)
            ?._count._all ?? 0,
      };
    });
    const seenCitations = new Set<string>();
    const verifiedCitationEdges = citationRows.flatMap((row) => {
      if (row.targetSentenceId === null) return [];
      const sourceSlug = slugById.get(row.sourceSentenceId);
      const targetSlug = slugById.get(row.targetSentenceId);
      const key = `${row.sourceSentenceId}:${row.targetSentenceId}`;
      if (!sourceSlug || !targetSlug || seenCitations.has(key)) return [];
      seenCitations.add(key);
      return [
        {
          type: 'VERIFIED_CITATION' as const,
          sourceSlug,
          targetSlug,
          evidence: row.rawCitation,
          page: row.page,
        },
      ];
    });
    const expedienteGroups = new Map<string, string[]>();
    for (const judgment of ordered) {
      const normalized = normalizeExpediente(judgment.expediente);
      if (!normalized) continue;
      expedienteGroups.set(normalized, [
        ...(expedienteGroups.get(normalized) ?? []),
        judgment.slugPublico!,
      ]);
    }
    const sameExpedienteGroups = [...expedienteGroups.entries()]
      .filter(([, groupSlugs]) => groupSlugs.length > 1)
      .map(([expediente, groupSlugs]) => ({
        type: 'SAME_EXPEDIENTE' as const,
        expediente,
        slugs: groupSlugs,
      }));

    return {
      data: {
        judgments,
        verifiedCitationEdges,
        sameExpedienteGroups,
        omittedCount: slugs.length - ordered.length,
        truncatedCitationEvidence: citationRows.length >= 2500,
      },
    };
  }

  async findAll(ownerId: number) {
    const timelines = await this.prisma.researchTimeline.findMany({
      where: { ownerId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: { _count: { select: { items: true } } },
    });
    return {
      data: timelines.map(({ _count, ...timeline }) => ({
        ...timeline,
        itemCount: _count.items,
      })),
    };
  }

  async findOne(ownerId: number, id: number) {
    const timeline = await this.prisma.researchTimeline.findFirst({
      where: { id, ownerId },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { items: true } },
        items: {
          where: {
            sentencia: {
              is: { publicado: true, activo: true, slugPublico: { not: null } },
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { sentencia: { select: { slugPublico: true } } },
        },
      },
    });
    if (!timeline) throw genericNotFound();
    const slugs = timeline.items.flatMap((item) =>
      item.sentencia.slugPublico ? [item.sentencia.slugPublico] : [],
    );
    return {
      data: {
        id: timeline.id,
        name: timeline.name,
        description: timeline.description,
        createdAt: timeline.createdAt,
        updatedAt: timeline.updatedAt,
        slugs,
        omittedCount: Math.max(0, timeline._count.items - slugs.length),
      },
    };
  }

  async exportBundle(ownerId: number, id: number) {
    const timeline = await this.prisma.researchTimeline.findFirst({
      where: { id, ownerId },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { items: true } },
        items: {
          where: {
            sentencia: {
              is: { publicado: true, activo: true, slugPublico: { not: null } },
            },
          },
          select: {
            sentenciaId: true,
            sentencia: {
              select: {
                id: true,
                slugPublico: true,
                caratula: true,
                numeroSentencia: true,
                expediente: true,
                sala: true,
                fecha: true,
                tipoFallo: true,
              },
            },
          },
        },
      },
    });
    if (!timeline) throw genericNotFound();
    if (timeline._count.items > MAX_TIMELINE_ITEMS) {
      throw new PayloadTooLargeException(
        `La investigación supera el límite seguro de ${MAX_TIMELINE_ITEMS} fallos.`,
      );
    }

    const itemBySlug = new Map(
      timeline.items.flatMap((item) =>
        item.sentencia.slugPublico
          ? [[item.sentencia.slugPublico, item] as const]
          : [],
      ),
    );
    const requestedSlugs = [...itemBySlug.keys()];
    const resolution =
      requestedSlugs.length >= 2
        ? (await this.resolvePublic(requestedSlugs)).data
        : null;
    const chronologicalSlugs = resolution
      ? resolution.judgments.map((judgment) => judgment.slug)
      : requestedSlugs.sort((leftSlug, rightSlug) => {
          const left = itemBySlug.get(leftSlug)!.sentencia.fecha;
          const right = itemBySlug.get(rightSlug)!.sentencia.fecha;
          const leftDate = safeIsoDate(left);
          const rightDate = safeIsoDate(right);
          if (leftDate && rightDate) {
            const byDate = leftDate.localeCompare(rightDate);
            if (byDate) return byDate;
          } else if (leftDate) return -1;
          else if (rightDate) return 1;
          return leftSlug.localeCompare(rightSlug, 'es');
        });
    const generatedAt = new Date();
    const orderedItems = chronologicalSlugs.flatMap((slug) => {
      const item = itemBySlug.get(slug);
      return item ? [item] : [];
    });
    const relationTypes = [
      ...(resolution?.verifiedCitationEdges.length
        ? (['VERIFIED_CITATION'] as const)
        : []),
      ...(resolution?.sameExpedienteGroups.length
        ? (['SAME_EXPEDIENTE'] as const)
        : []),
    ];
    const bundle = buildResearchBundle({
      collection: {
        id: timeline.id,
        nombre: timeline.name,
        createdAt: timeline.createdAt,
        updatedAt: timeline.updatedAt,
      },
      generatedAt,
      judgmentOrder: 'INPUT',
      ...(process.env.GIT_SHA ? { gitSha: process.env.GIT_SHA } : {}),
      omittedItemCount: Math.max(
        0,
        timeline._count.items - orderedItems.length,
      ),
      judgments: orderedItems.map(({ sentencia }) => ({
        ...sentencia,
        nota: null,
        addedAt: generatedAt,
      })),
      evolution: {
        name: timeline.name,
        selectedJudgmentIds: orderedItems.map((item) => item.sentenciaId),
        chronologicalSlugs,
        relationTypes: [...relationTypes],
        verifiedCitationEdges: resolution?.verifiedCitationEdges ?? [],
        sameExpedienteGroups: resolution?.sameExpedienteGroups ?? [],
      },
    });

    await this.logsService.registrarAccion({
      usuarioId: ownerId,
      entidad: 'RESEARCH_TIMELINE',
      entidadId: timeline.id,
      accion: 'TIMELINE_BUNDLE_EXPORT',
      descripcion: `Exportó una investigación verificable con ${orderedItems.length} fallo(s).`,
      datosDespues: {
        judgmentCount: orderedItems.length,
        relationTypes,
        generatedAt: generatedAt.toISOString(),
      },
    });

    return {
      stream: createResearchBundleZip(bundle.files),
      filename: bundle.downloadFilename,
      manifest: bundle.manifest,
    };
  }

  async create(ownerId: number, dto: CreateTimelineDto) {
    const slugs = requireValidSlugs(dto.slugs);
    const name = this.validateName(dto.name);
    const description = this.validateDescription(dto.description);
    const sentences = await this.findAllPublicSlugs(slugs);
    if (
      sentences.length !== slugs.length ||
      sentences.some((item) => !item.slugPublico)
    )
      throw genericNotFound();
    const idBySlug = new Map(
      sentences.map((item) => [item.slugPublico!, item.id]),
    );
    const created = await this.prisma.researchTimeline.create({
      data: {
        ownerId,
        name,
        description,
        items: {
          create: slugs.map((slug) => ({ sentenciaId: idBySlug.get(slug)! })),
        },
      },
      select: { id: true },
    });
    await this.logsService.registrarAccion({
      usuarioId: ownerId,
      entidad: 'RESEARCH_TIMELINE',
      entidadId: created.id,
      accion: 'TIMELINE_CREATED',
      descripcion: 'Guardó un espacio privado de evolución jurisprudencial.',
      datosDespues: { itemCount: slugs.length },
    });
    return this.findOne(ownerId, created.id);
  }

  async update(ownerId: number, id: number, dto: UpdateTimelineDto) {
    const before = await this.prisma.researchTimeline.findFirst({
      where: { id, ownerId },
      select: { id: true, name: true, description: true },
    });
    if (!before) throw genericNotFound();
    const data: { name?: string; description?: string | null } = {};
    if (dto.name !== undefined) data.name = this.validateName(dto.name);
    if (dto.description !== undefined)
      data.description = this.validateDescription(dto.description);
    let sentenceIds: number[] | null = null;
    if (dto.slugs !== undefined) {
      const slugs = requireValidSlugs(dto.slugs);
      const sentences = await this.findAllPublicSlugs(slugs);
      if (
        sentences.length !== slugs.length ||
        sentences.some((item) => !item.slugPublico)
      )
        throw genericNotFound();
      const idBySlug = new Map(
        sentences.map((item) => [item.slugPublico!, item.id]),
      );
      sentenceIds = slugs.map((slug) => idBySlug.get(slug)!);
    }
    if (Object.keys(data).length === 0 && sentenceIds === null)
      throw new BadRequestException('Indicá al menos un cambio.');
    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.researchTimeline.updateMany({ where: { id, ownerId }, data });
      }
      if (sentenceIds !== null) {
        await tx.researchTimelineItem.deleteMany({ where: { timelineId: id } });
        await tx.researchTimelineItem.createMany({
          data: sentenceIds.map((sentenciaId) => ({
            timelineId: id,
            sentenciaId,
          })),
        });
      }
    });
    await this.logsService.registrarAccion({
      usuarioId: ownerId,
      entidad: 'RESEARCH_TIMELINE',
      entidadId: id,
      accion: 'TIMELINE_UPDATED',
      descripcion: 'Actualizó un espacio privado de evolución jurisprudencial.',
      datosAntes: { name: before.name },
      datosDespues: {
        ...(data.name ? { name: data.name } : {}),
        ...(sentenceIds ? { itemCount: sentenceIds.length } : {}),
      },
    });
    return this.findOne(ownerId, id);
  }

  async remove(ownerId: number, id: number) {
    const before = await this.prisma.researchTimeline.findFirst({
      where: { id, ownerId },
      select: { id: true, name: true, _count: { select: { items: true } } },
    });
    if (!before) throw genericNotFound();
    const result = await this.prisma.researchTimeline.deleteMany({
      where: { id, ownerId },
    });
    if (!result.count) throw genericNotFound();
    await this.logsService.registrarAccion({
      usuarioId: ownerId,
      entidad: 'RESEARCH_TIMELINE',
      entidadId: id,
      accion: 'TIMELINE_DELETED',
      descripcion: 'Eliminó un espacio privado de evolución jurisprudencial.',
      datosAntes: { name: before.name, itemCount: before._count.items },
    });
    return { data: { deleted: true } };
  }

  private async findAllPublicSlugs(slugs: string[]) {
    return this.prisma.sentencia.findMany({
      where: { slugPublico: { in: slugs }, publicado: true, activo: true },
      select: { id: true, slugPublico: true },
    });
  }

  private validateName(raw: string) {
    if (typeof raw !== 'string') {
      throw new BadRequestException(
        'El nombre debe tener entre 1 y 120 caracteres.',
      );
    }
    const name = raw.trim();
    if (!name || name.length > 120)
      throw new BadRequestException(
        'El nombre debe tener entre 1 y 120 caracteres.',
      );
    return name;
  }

  private validateDescription(raw: string | null | undefined) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string') {
      throw new BadRequestException('La descripción debe ser texto.');
    }
    const description = raw.trim();
    if (description.length > 2000)
      throw new BadRequestException(
        'La descripción admite hasta 2000 caracteres.',
      );
    return description || null;
  }
}

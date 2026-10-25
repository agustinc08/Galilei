import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { extractIdentifiedCitations } from './citation-extractor';
import { RelationshipCandidatesQueryDto } from './dto/relationship-candidates-query.dto';
import { ReviewRelationshipCandidateDto } from './dto/review-relationship-candidate.dto';

const PUBLIC_RELATIONSHIP_SELECT = {
  id: true,
  slugPublico: true,
  caratula: true,
  numeroSentencia: true,
  expediente: true,
  sala: true,
  fecha: true,
} as const;

type CitationCandidateData = {
  rawCitation: string;
  identifier: string;
  normalizedIdentifier: string;
  identifierType: 'EXPEDIENTE' | 'NUMERO_SENTENCIA';
  extractionMethod: 'explicit-case-identifier-v1';
};

@Injectable()
export class ResearchRelationshipsService {
  constructor(private readonly prisma: PrismaService) {}

  async extractForSentence(sourceSentenceId: number) {
    const source = await this.prisma.sentencia.findUnique({
      where: { id: sourceSentenceId },
      select: {
        id: true,
        referenciasJurisprudenciales: {
          select: {
            referencia: true,
            textoOriginal: true,
            falloRelacionadoId: true,
          },
        },
        citasFallo: {
          where: { confirmada: false },
          select: { referencia: true, textoOriginal: true },
        },
      },
    });
    if (!source) throw new NotFoundException('Fallo de origen no encontrado');

    const candidates = new Map<string, CitationCandidateData>();
    for (const reference of source.referenciasJurisprudenciales) {
      // Existing linked curator data remains authoritative and is not re-created as an extraction candidate.
      if (reference.falloRelacionadoId) continue;
      this.collectCandidates(
        candidates,
        reference.textoOriginal ?? reference.referencia,
      );
    }
    for (const citation of source.citasFallo) {
      this.collectCandidates(
        candidates,
        citation.textoOriginal ?? citation.referencia,
      );
    }

    if (!candidates.size) return { data: { created: 0, candidates: [] } };
    const rows = await Promise.all(
      [...candidates.values()].map(async (candidate) => {
        const matches = await this.resolvePublicTarget(
          sourceSentenceId,
          candidate.identifierType,
          candidate.identifier,
        );
        return {
          sourceSentenceId,
          targetSentenceId: matches.length === 1 ? matches[0].id : null,
          rawCitation: candidate.rawCitation,
          normalizedIdentifier: candidate.normalizedIdentifier,
          identifierType: candidate.identifierType,
          relationshipType: 'CITES',
          status: 'DETECTED_CANDIDATE' as const,
          extractionMethod: candidate.extractionMethod,
          // No calibrated probability is available; confidence is intentionally left null.
          confidence: null,
          page: null,
        };
      }),
    );
    const created = await this.prisma.sentenciaRelationshipCandidate.createMany(
      {
        data: rows,
        skipDuplicates: true,
      },
    );
    const stored = await this.prisma.sentenciaRelationshipCandidate.findMany({
      where: {
        sourceSentenceId,
        status: 'DETECTED_CANDIDATE',
        rawCitation: { in: rows.map((row) => row.rawCitation) },
      },
      orderBy: { id: 'asc' },
      include: {
        sourceSentence: { select: PUBLIC_RELATIONSHIP_SELECT },
        targetSentence: { select: PUBLIC_RELATIONSHIP_SELECT },
      },
    });
    return { data: { created: created.count, candidates: stored } };
  }

  async listCandidates(query: RelationshipCandidatesQueryDto) {
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 100);
    const where = query.status ? { status: query.status } : {};
    const [total, data] = await Promise.all([
      this.prisma.sentenciaRelationshipCandidate.count({ where }),
      this.prisma.sentenciaRelationshipCandidate.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: pageSize,
        include: {
          sourceSentence: { select: PUBLIC_RELATIONSHIP_SELECT },
          targetSentence: { select: PUBLIC_RELATIONSHIP_SELECT },
        },
      }),
    ]);
    return { data, meta: { total, pageSize } };
  }

  async reviewCandidate(
    id: number,
    reviewerId: number,
    dto: ReviewRelationshipCandidateDto,
  ) {
    const candidate =
      await this.prisma.sentenciaRelationshipCandidate.findFirst({
        where: { id, status: 'DETECTED_CANDIDATE' },
        select: { id: true, sourceSentenceId: true, targetSentenceId: true },
      });
    if (!candidate)
      throw new NotFoundException('Candidata pendiente no encontrada');

    let targetSentenceId: number | null = candidate.targetSentenceId;
    if (dto.status === 'VERIFIED') {
      targetSentenceId = dto.targetSentenceId ?? targetSentenceId;
      if (
        !targetSentenceId ||
        targetSentenceId === candidate.sourceSentenceId
      ) {
        throw new BadRequestException(
          'Seleccioná un fallo destino distinto del origen.',
        );
      }
      const target = await this.prisma.sentencia.findFirst({
        where: { id: targetSentenceId, publicado: true, activo: true },
        select: { id: true },
      });
      if (!target)
        throw new NotFoundException(
          'El destino debe ser un fallo publicado y activo.',
        );
    }

    const result = await this.prisma.sentenciaRelationshipCandidate.updateMany({
      where: { id, status: 'DETECTED_CANDIDATE' },
      data: {
        status: dto.status,
        targetSentenceId: dto.status === 'VERIFIED' ? targetSentenceId : null,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
      },
    });
    if (!result.count)
      throw new ConflictException(
        'La candidata ya fue revisada. Recargá la cola.',
      );
    return {
      data: await this.prisma.sentenciaRelationshipCandidate.findUnique({
        where: { id },
        include: {
          sourceSentence: { select: PUBLIC_RELATIONSHIP_SELECT },
          targetSentence: { select: PUBLIC_RELATIONSHIP_SELECT },
        },
      }),
    };
  }

  async findPublicVerifiedRelationships(slug: string) {
    const current = await this.prisma.sentencia.findFirst({
      where: { slugPublico: slug, publicado: true, activo: true },
      select: { id: true },
    });
    if (!current)
      throw new NotFoundException('Sentencia pública no encontrada');
    const data = await this.prisma.sentenciaRelationshipCandidate.findMany({
      where: {
        status: 'VERIFIED',
        targetSentenceId: { not: null },
        OR: [
          { sourceSentenceId: current.id },
          { targetSentenceId: current.id },
        ],
        sourceSentence: { is: { publicado: true, activo: true } },
        targetSentence: { is: { publicado: true, activo: true } },
      },
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
      include: {
        sourceSentence: { select: PUBLIC_RELATIONSHIP_SELECT },
        targetSentence: { select: PUBLIC_RELATIONSHIP_SELECT },
      },
    });
    return {
      data: data.flatMap((relationship) => {
        if (!relationship.sourceSentence || !relationship.targetSentence)
          return [];
        const citesCurrent = relationship.targetSentenceId === current.id;
        return [
          {
            type: citesCurrent ? ('CITED_BY' as const) : ('CITES' as const),
            status: 'VERIFIED' as const,
            rawCitation: relationship.rawCitation,
            page: relationship.page,
            judgment: citesCurrent
              ? relationship.sourceSentence
              : relationship.targetSentence,
          },
        ];
      }),
    };
  }

  private collectCandidates(
    output: Map<string, CitationCandidateData>,
    text: string,
  ) {
    for (const citation of extractIdentifiedCitations(text)) {
      const key = `${citation.identifierType}:${citation.normalizedIdentifier}`;
      if (!output.has(key)) {
        output.set(key, {
          rawCitation: citation.rawCitation,
          identifier: citation.identifier,
          normalizedIdentifier: citation.normalizedIdentifier,
          identifierType: citation.identifierType,
          extractionMethod: citation.extractionMethod,
        });
      }
    }
  }

  private resolvePublicTarget(
    sourceId: number,
    identifierType: 'EXPEDIENTE' | 'NUMERO_SENTENCIA',
    identifier: string,
  ) {
    const field =
      identifierType === 'EXPEDIENTE' ? 'expediente' : 'numeroSentencia';
    return this.prisma.sentencia.findMany({
      where: {
        id: { not: sourceId },
        publicado: true,
        activo: true,
        [field]: { equals: identifier, mode: 'insensitive' },
      },
      select: { id: true },
      take: 2,
    });
  }
}

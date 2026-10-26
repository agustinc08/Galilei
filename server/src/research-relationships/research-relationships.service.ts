import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { findLinkedCorpusTextSource } from '../sentencias/linked-corpus-source';
import {
  extractIdentifiedCitations,
  type CitationSourceIdentity,
} from './citation-extractor';
import { RelationshipCandidatesQueryDto } from './dto/relationship-candidates-query.dto';
import { ReviewRelationshipCandidateDto } from './dto/review-relationship-candidate.dto';
import {
  normalizeLegalIdentifier,
  parseArgentineCitationsV2,
  resolveCitationV2,
  type CitationCandidateV2,
} from './citation-parser-v2';

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

const CITATION_PARSER_V2_VERSION = 'argentine-citation-parser-v2';

@Injectable()
export class ResearchRelationshipsService {
  constructor(private readonly prisma: PrismaService) {}

  async extractForSentence(sourceSentenceId: number) {
    const source = await this.prisma.sentencia.findUnique({
      where: { id: sourceSentenceId },
      select: {
        id: true,
        expediente: true,
        numeroSentencia: true,
        archivosPdf: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, rutaArchivo: true },
        },
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
        source,
      );
    }
    for (const citation of source.citasFallo) {
      this.collectCandidates(
        candidates,
        citation.textoOriginal ?? citation.referencia,
        source,
      );
    }

    const legacyRows = await Promise.all(
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
          sourceExtractionId: null,
          sourceChecksum: null,
          parserVersion: candidate.extractionMethod,
          citationFamily:
            candidate.identifierType === 'EXPEDIENTE'
              ? 'EXPEDIENTE_IDENTIFIER'
              : 'SENTENCE_NUMBER_IDENTIFIER',
          parsedFields: Prisma.DbNull,
          sourcePage: null,
          sourceStartOffset: null,
          sourceEndOffset: null,
          sourceTextKind: null,
          sourceContext: null,
          resolutionOutcome:
            matches.length === 1
              ? 'RESOLVED_UNIQUE'
              : matches.length > 1
                ? 'AMBIGUOUS'
                : 'UNRESOLVED',
          resolutionReason:
            matches.length === 1
              ? 'El identificador coincide con un único fallo publicado y activo.'
              : matches.length > 1
                ? 'El identificador coincide con varios fallos publicados y activos.'
                : 'No hay coincidencia exacta publicada y activa.',
          occurrenceKey: occurrenceKey(
            `${candidate.extractionMethod}:${candidate.identifierType}:${candidate.normalizedIdentifier}`,
          ),
        };
      }),
    );

    const sourceExtraction = await findLinkedCorpusTextSource(
      this.prisma,
      sourceSentenceId,
      source.archivosPdf ?? [],
    );
    const parsed = sourceExtraction
      ? parseArgentineCitationsV2(
          sourceExtraction.pages.map((page) => ({
            pageNumber: page.pageNumber,
            text: page.text,
            textKind: page.textKind,
          })),
          {
            expediente: source.expediente,
            numeroSentencia: source.numeroSentencia,
          },
        )
      : [];
    const v2Rows = await Promise.all(
      parsed
        .filter(
          (citation) =>
            citation.identifierType !== null &&
            citation.normalizedIdentifier !== null &&
            citation.resolutionOutcome !== 'SELF_REFERENCE',
        )
        .map(async (citation) => {
          const resolution = await this.resolveParsedCandidate(
            sourceSentenceId,
            citation,
          );
          return {
            sourceSentenceId,
            targetSentenceId: resolution.targetSentenceId,
            rawCitation: citation.rawCitation,
            normalizedIdentifier: citation.normalizedIdentifier,
            identifierType: citation.identifierType,
            relationshipType: 'CITES',
            status: 'DETECTED_CANDIDATE' as const,
            extractionMethod: CITATION_PARSER_V2_VERSION,
            confidence: null,
            page: citation.sourcePage,
            sourceExtractionId: sourceExtraction!.id,
            sourceChecksum: sourceExtraction!.file.sha256,
            parserVersion: citation.parserVersion,
            citationFamily: citation.family,
            parsedFields: citation.parsedFields,
            sourcePage: citation.sourcePage,
            sourceStartOffset: citation.sourceStartOffset,
            sourceEndOffset: citation.sourceEndOffset,
            sourceTextKind: citation.sourceTextKind,
            sourceContext: citation.sourceContext,
            resolutionOutcome: resolution.outcome,
            resolutionReason: resolution.reason,
            occurrenceKey: occurrenceKey(
              `${sourceExtraction!.id}:${citation.sourcePage}:${citation.sourceStartOffset}:${citation.sourceEndOffset}:${citation.parserVersion}`,
            ),
          };
        }),
    );
    const rows = [...legacyRows, ...v2Rows];
    if (!rows.length) return { data: { created: 0, candidates: [] } };
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
        occurrenceKey: { in: rows.map((row) => row.occurrenceKey) },
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
    sourceIdentity: CitationSourceIdentity,
  ) {
    for (const citation of extractIdentifiedCitations(text, sourceIdentity)) {
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

  private async resolveParsedCandidate(
    sourceId: number,
    citation: CitationCandidateV2,
  ) {
    if (!citation.identifierType || !citation.normalizedIdentifier) {
      return {
        outcome: 'UNRESOLVED' as const,
        targetSentenceId: null,
        candidateTargetIds: [],
        reason: citation.resolutionReason,
      };
    }
    const field =
      citation.identifierType === 'EXPEDIENTE'
        ? 'expediente'
        : 'numeroSentencia';
    const variants = legalIdentifierVariants(citation.normalizedIdentifier);
    if (!variants.length) {
      return resolveCitationV2(citation, sourceId, []);
    }
    const targets = await this.prisma.sentencia.findMany({
      where: {
        id: { not: sourceId },
        publicado: true,
        activo: true,
        OR: variants.map((identifier) => ({
          [field]: { equals: identifier, mode: 'insensitive' as const },
        })),
      },
      select: {
        id: true,
        expediente: true,
        numeroSentencia: true,
        sala: true,
        fecha: true,
        publicado: true,
        activo: true,
      },
      take: 3,
    });
    return resolveCitationV2(citation, sourceId, targets);
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

function occurrenceKey(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function legalIdentifierVariants(value: string) {
  const normalized = normalizeLegalIdentifier(value);
  if (!normalized) return [];
  const match = normalized.match(/^([A-Z]{1,8})?(\d{1,15})\/(\d{2}|\d{4})$/u);
  if (!match) return [normalized];
  const prefix = match[1] ?? '';
  const number = match[2];
  const year = match[3];
  const dotted = number.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return [
    ...new Set([`${prefix}${number}/${year}`, `${prefix}${dotted}/${year}`]),
  ];
}

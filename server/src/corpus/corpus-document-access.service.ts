import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  LocalDocumentStorageAdapter,
  type DocumentStorageAdapter,
} from './document-storage.adapter';
import type { SearchVisibility } from '../busqueda/adapters/search-source.adapter';
import { findDocumentMatches } from './corpus-document-matches';
import { canReadWorkspaceDocument } from './workspace-document-acl';
import {
  parseStructuredJudgment,
  STRUCTURED_JUDGMENT_PARSER_VERSION,
} from '../sentencias/structured-judgment-parser';
import { formatCitation } from '../sentencias/utils/citation-formatter';

@Injectable()
export class CorpusDocumentAccessService {
  private readonly storage: DocumentStorageAdapter;
  constructor(private readonly prisma: PrismaService) {
    this.storage = new LocalDocumentStorageAdapter();
  }

  canReadWorkspaceDocument(
    documentId: string,
    workspaceId: string,
    userId: number,
  ) {
    return canReadWorkspaceDocument(this.prisma, documentId, {
      kind: 'WORKSPACE',
      workspaceId,
      userId,
    });
  }

  async metadata(
    documentId: string,
    visibility: SearchVisibility,
    pageNumber?: number,
    workspaceId?: string,
    userId?: number,
  ) {
    const document = await this.visibleDocument(
      documentId,
      visibility,
      workspaceId,
      userId,
    );
    const latestFile = document.files[0];
    const latestExtraction = document.latestExtraction;
    const provenance = document.ingestions[0];
    const page =
      pageNumber && latestExtraction
        ? await this.prisma.corpusDocumentPage.findFirst({
            where: { extractionId: latestExtraction.id, pageNumber },
            select: {
              pageNumber: true,
              text: true,
              textKind: true,
              processingStatus: true,
              ocrConfidence: true,
            },
          })
        : null;
    if (pageNumber !== undefined) {
      const pageCount = latestFile?.pageCount;
      if (
        !Number.isSafeInteger(pageNumber) ||
        pageNumber < 1 ||
        pageNumber > 100_000 ||
        (pageCount !== null &&
          pageCount !== undefined &&
          pageNumber > pageCount) ||
        !page ||
        !isUsablePage(latestExtraction?.status, page)
      ) {
        throw new BadRequestException(
          'La página solicitada no está disponible.',
        );
      }
    }
    return {
      id: document.id,
      documentType: document.documentType,
      title: document.title,
      subtitle: document.subtitle,
      jurisdiction: document.jurisdiction,
      court: document.court,
      chamber: document.chamber,
      instance: document.instance,
      caseNumber: document.caseNumber,
      decisionDate: document.decisionDate,
      visibility: document.visibility,
      status: document.status,
      metadata: document.metadata,
      source: provenance
        ? {
            code: provenance.sourceSystem.code,
            name: provenance.sourceSystem.name,
            externalId: provenance.externalId,
            externalUrl: provenance.externalUrl,
            sourceReference: provenance.sourceReference,
            obtainedAt: provenance.obtainedAt,
            checksum: provenance.checksum,
          }
        : null,
      file: latestFile
        ? {
            mimeType: latestFile.mimeType,
            filename: latestFile.originalFilename,
            sizeBytes: Number(latestFile.sizeBytes),
            sha256: latestFile.sha256,
            version: latestFile.version,
            pageCount: latestFile.pageCount,
            href: workspaceId
              ? `/api/workspaces/${workspaceId}/documents/${document.id}/file`
              : userId
                ? `/api/personal/documents/${document.id}/file`
                : document.visibility === 'PUBLIC'
                  ? `/api/public/corpus/documents/${document.id}/file`
                  : `/api/corpus/documents/${document.id}/file`,
          }
        : null,
      extraction: latestExtraction
        ? {
            status: latestExtraction.status,
            extractor: latestExtraction.extractor,
            extractorVersion: latestExtraction.extractorVersion,
            extractedAt: latestExtraction.extractedAt,
            pageCount: latestExtraction.pages.length,
            pages: latestExtraction.pages.map((item) => item.pageNumber),
          }
        : null,
      ...(page ? { selectedPage: page } : {}),
    };
  }

  async citation(
    documentId: string,
    visibility: SearchVisibility,
    pageNumber: number,
  ) {
    const document = await this.visibleDocument(documentId, visibility);
    const citationPage = document.latestExtraction?.pages.find(
      (page) => page.pageNumber === pageNumber,
    );
    if (
      !Number.isSafeInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > 100_000 ||
      (document.files[0]?.pageCount !== null &&
        document.files[0]?.pageCount !== undefined &&
        pageNumber > document.files[0].pageCount) ||
      !citationPage ||
      !isUsablePage(document.latestExtraction?.status, citationPage)
    ) {
      throw new BadRequestException(
        'La página indicada no tiene texto fuente asociado.',
      );
    }
    const metadata =
      typeof document.metadata === 'object' &&
      document.metadata !== null &&
      !Array.isArray(document.metadata)
        ? (document.metadata as Record<string, unknown>)
        : {};
    const text = (...keys: string[]) => {
      const value = keys
        .map((key) => metadata[key])
        .find((item) => typeof item === 'string');
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    };
    return {
      data: formatCitation(
        {
          actor: text('actor', 'actorPublico'),
          demandado: text('demandado', 'demandadoPublico'),
          sala: document.chamber,
          fecha: document.decisionDate,
          expediente: document.caseNumber,
          numeroSentencia: text('numeroSentencia'),
          citaPersonalizada: text('citaPersonalizada'),
        },
        { page: pageNumber },
      ),
    };
  }

  async file(
    documentId: string,
    visibility: SearchVisibility,
    workspaceId?: string,
    userId?: number,
  ) {
    const document = await this.visibleDocument(
      documentId,
      visibility,
      workspaceId,
      userId,
    );
    const file = document.files[0];
    if (!file) throw new NotFoundException('Archivo no encontrado.');
    let content: Buffer;
    try {
      content = await this.storage.get(file.storageKey);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('Archivo no encontrado.');
      }
      throw new InternalServerErrorException('No se pudo acceder al archivo.');
    }
    const actual = createHash('sha256').update(content).digest('hex');
    if (actual !== file.sha256)
      throw new InternalServerErrorException(
        'La integridad del archivo no pudo verificarse.',
      );
    if (
      ![
        'application/pdf',
        'text/plain',
        'application/rtf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.oasis.opendocument.text',
      ].includes(file.mimeType)
    )
      throw new NotFoundException('Tipo de archivo no disponible.');
    return {
      content,
      filename: safeFilename(file.originalFilename),
      mimeType: file.mimeType,
      sha256: file.sha256,
    };
  }

  storageReady() {
    return this.storage.isAvailable?.() ?? Promise.resolve(false);
  }

  async matches(
    documentId: string,
    visibility: SearchVisibility,
    query: string,
    workspaceId?: string,
    userId?: number,
  ) {
    const document = await this.visibleDocument(
      documentId,
      visibility,
      workspaceId,
      userId,
    );
    const extraction = document.latestExtractionId
      ? await this.prisma.corpusExtraction.findUnique({
          where: { id: document.latestExtractionId },
          select: {
            status: true,
            pages: {
              orderBy: { pageNumber: 'asc' },
              select: {
                pageNumber: true,
                text: true,
                textKind: true,
                processingStatus: true,
              },
            },
          },
        })
      : null;
    const metadata =
      typeof document.metadata === 'object' &&
      document.metadata !== null &&
      !Array.isArray(document.metadata)
        ? (document.metadata as Record<string, unknown>)
        : {};
    const metadataText = (...keys: string[]) => {
      const value = keys
        .map((key) => metadata[key])
        .find((item) => typeof item === 'string');
      return typeof value === 'string' ? value : null;
    };
    const pages = (extraction?.pages ?? [])
      .filter((page) => isUsablePage(extraction?.status, page))
      .map((page) => ({
        ...page,
        textKind:
          page.textKind === 'OCR' ? ('OCR' as const) : ('NATIVE' as const),
      }));
    return findDocumentMatches(pages, query, 500, {
      tema: document.subtitle,
      sala: document.chamber,
      tipoFallo: document.documentType,
      tribunalOrigen: document.court,
      expediente: document.caseNumber,
      caratula: document.title,
      actor: metadataText('actor', 'actorPublico'),
      demandado: metadataText('demandado', 'demandadoPublico'),
      objeto: metadataText('objeto'),
      magistrados: metadataText('magistrados'),
      numeroSentencia: document.caseNumber,
      numeroSumario: document.searchText,
    });
  }

  async structure(
    documentId: string,
    visibility: SearchVisibility,
    workspaceId?: string,
    userId?: number,
  ) {
    const document = await this.visibleDocument(
      documentId,
      visibility,
      workspaceId,
      userId,
    );
    const extraction = document.latestExtractionId
      ? await this.prisma.corpusExtraction.findFirst({
          where: {
            id: document.latestExtractionId,
            documentId: document.id,
          },
          select: {
            id: true,
            status: true,
            extractor: true,
            extractorVersion: true,
            extractedAt: true,
            file: { select: { sha256: true, pageCount: true } },
            pages: {
              orderBy: { pageNumber: 'asc' },
              select: { pageNumber: true, text: true, textKind: true },
            },
          },
        })
      : null;
    const pages = (extraction?.pages ?? []).filter((page) =>
      isUsablePage(extraction?.status, page),
    );
    const sequentialPages = pages.every(
      (page, index) => page.pageNumber === index + 1,
    );
    const complete =
      (extraction?.status === 'TEXT_EXTRACTED' ||
        extraction?.status === 'OCR_HUMAN_APPROVED') &&
      sequentialPages &&
      (extraction.file.pageCount === null ||
        extraction.file.pageCount === pages.length);
    const sections = extraction
      ? parseStructuredJudgment(pages, { completeSource: complete })
      : [];
    return {
      data: {
        status: sections.length
          ? complete
            ? 'DETECTED'
            : 'PARTIAL'
          : 'NO_STRUCTURE',
        parserVersion: STRUCTURED_JUDGMENT_PARSER_VERSION,
        source: extraction
          ? {
              checksum: extraction.file.sha256,
              extractor: extraction.extractor,
              extractorVersion: extraction.extractorVersion,
              pageCount: extraction.file.pageCount,
              extractedPages: pages.length,
              complete,
            }
          : null,
        sections,
      },
    };
  }

  async institutionalSummary() {
    const institutional = {
      ingestions: {
        some: {
          sourceSystem: {
            is: { code: { in: ['JURISPRUDENCIA_LOCAL_PDF', 'DIGESTO_LOCAL'] } },
          },
        },
      },
    } satisfies Prisma.CorpusDocumentWhereInput;
    const [
      physicalFiles,
      documents,
      files,
      pages,
      statusGroups,
      unclassified,
      linked,
      pendingAssociations,
      classifications,
      runs,
      unresolved,
      classificationGroups,
      selected,
      notSelected,
      digestoDocuments,
      digestoMemberships,
      sourceMissing,
      jurisprudencePending,
    ] = await Promise.all([
      this.prisma.corpusDocumentLocation.count({
        where: { document: institutional },
      }),
      this.prisma.corpusDocument.count({ where: institutional }),
      this.prisma.corpusDocumentFile.count({
        where: { document: institutional },
      }),
      this.prisma.corpusDocumentPage.count({
        where: { extraction: { document: institutional } },
      }),
      this.prisma.corpusDocument.groupBy({
        by: ['status'],
        where: institutional,
        _count: { _all: true },
      }),
      this.prisma.corpusDocument.count({
        where: { ...institutional, classifications: { none: {} } },
      }),
      this.prisma.corpusDocument.count({
        where: {
          ...institutional,
          links: { some: { targetDomain: 'JURISPRUDENCIA' } },
        },
      }),
      this.prisma.corpusDocumentAssociation.count({
        where: { document: institutional, reviewStatus: 'REVIEW_PENDING' },
      }),
      this.prisma.corpusDocumentClassification.count({
        where: { document: institutional },
      }),
      this.prisma.corpusImportRun.findMany({
        where: {
          sourceCode: { in: ['JURISPRUDENCIA_LOCAL_PDF', 'DIGESTO_LOCAL'] },
        },
        orderBy: { startedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          status: true,
          processed: true,
          uniqueHashes: true,
          failed: true,
          ocrRequired: true,
          startedAt: true,
          finishedAt: true,
        },
      }),
      this.prisma.corpusDocumentAssociation.count({
        where: { document: institutional, confidence: 'UNRESOLVED' },
      }),
      this.prisma.corpusDocumentClassification.groupBy({
        by: ['reviewStatus'],
        where: { document: institutional },
        _count: { _all: true },
      }),
      this.prisma.corpusDocument.count({
        where: { ...institutional, editorialStatus: 'SELECTED' },
      }),
      this.prisma.corpusDocument.count({
        where: { ...institutional, editorialStatus: 'NOT_SELECTED' },
      }),
      this.prisma.corpusDocument.count({
        where: {
          ingestions: {
            some: { sourceSystem: { is: { code: 'DIGESTO_LOCAL' } } },
          },
        },
      }),
      this.prisma.digestoCollectionMembership.count({
        where: { document: institutional },
      }),
      this.prisma.corpusDocumentLocation.count({
        where: { sourceMissing: true, document: institutional },
      }),
      this.prisma.corpusDocument.count({
        where: { ...institutional, editorialStatus: 'REVIEW_PENDING' },
      }),
    ]);
    return {
      physicalFiles,
      documents,
      files,
      pages,
      statusCounts: Object.fromEntries(
        statusGroups.map((item) => [item.status, item._count._all]),
      ),
      unclassified,
      linked,
      unresolved,
      pendingAssociations,
      classifications,
      classificationCounts: Object.fromEntries(
        classificationGroups.map((item) => [
          item.reviewStatus,
          item._count._all,
        ]),
      ),
      selected,
      notSelected,
      digestoDocuments,
      digestoMemberships,
      sourceMissing,
      jurisprudencePending,
      runs,
    };
  }

  async institutionalReviewQueue(filter = 'all', page = 1, pageSize = 50) {
    const institutional = {
      ingestions: {
        some: {
          sourceSystem: {
            is: { code: { in: ['JURISPRUDENCIA_LOCAL_PDF', 'DIGESTO_LOCAL'] } },
          },
        },
      },
    } satisfies Prisma.CorpusDocumentWhereInput;
    const where: Prisma.CorpusDocumentWhereInput = { ...institutional };
    if (filter === 'unresolved')
      where.associations = { some: { confidence: 'UNRESOLVED' } };
    else if (filter === 'unclassified') where.classifications = { none: {} };
    else if (filter === 'classification')
      where.classifications = { some: { reviewStatus: 'SUGGESTED' } };
    else if (filter === 'ocr') where.status = 'OCR_REQUIRED';
    else if (filter === 'failed')
      where.status = { in: ['INVALID_PDF', 'EXTRACTION_FAILED'] };
    else if (filter === 'candidate')
      where.associations = {
        some: {
          confidence: { in: ['HIGH_CONFIDENCE', 'CANDIDATE'] },
          reviewStatus: 'REVIEW_PENDING',
        },
      };
    else if (filter === 'metadata')
      where.OR = [
        { decisionDate: null },
        { court: null },
        { chamber: null },
        { instance: null },
      ];
    else if (filter === 'sourceMissing')
      where.locations = { some: { sourceMissing: true } };
    else if (filter !== 'all') throw new Error('REVIEW_FILTER_UNSUPPORTED');
    const safePage = Math.max(1, Math.trunc(page));
    const safePageSize = Math.min(100, Math.max(1, Math.trunc(pageSize)));
    const [total, documents] = await Promise.all([
      this.prisma.corpusDocument.count({ where }),
      this.prisma.corpusDocument.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        select: {
          id: true,
          title: true,
          status: true,
          documentType: true,
          court: true,
          chamber: true,
          instance: true,
          caseNumber: true,
          decisionDate: true,
          visibility: true,
          locations: {
            where: { sourceMissing: true },
            select: { id: true },
            take: 1,
          },
          editorialStatus: true,
          anonymizationStatus: true,
          associations: {
            select: {
              id: true,
              targetId: true,
              confidence: true,
              reviewStatus: true,
              evidence: true,
            },
            take: 5,
          },
          classifications: {
            select: {
              id: true,
              category: true,
              value: true,
              origin: true,
              confidence: true,
              reviewStatus: true,
            },
            take: 8,
            orderBy: [{ reviewStatus: 'asc' }, { confidence: 'desc' }],
          },
          files: {
            select: { originalFilename: true, sha256: true, pageCount: true },
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      }),
    ]);
    return {
      filter,
      page: safePage,
      pageSize: safePageSize,
      total,
      results: documents,
    };
  }

  private async visibleDocument(
    documentId: string,
    visibility: SearchVisibility,
    workspaceId?: string,
    userId?: number,
  ) {
    const allowed =
      visibility === 'ADMIN'
        ? ['PUBLIC', 'INTERNAL', 'RESTRICTED']
        : visibility === 'INTERNAL'
          ? ['PUBLIC', 'INTERNAL']
          : visibility === 'PUBLIC'
            ? ['PUBLIC']
            : visibility === 'RESTRICTED' && (workspaceId || userId)
              ? ['RESTRICTED']
              : [];
    if (!allowed.length)
      throw new NotFoundException('Documento no encontrado.');
    if (workspaceId) {
      if (
        !Number.isSafeInteger(userId) ||
        !(await canReadWorkspaceDocument(this.prisma, documentId, {
          kind: 'WORKSPACE',
          workspaceId,
          userId: userId as number,
        }))
      )
        throw new NotFoundException('Documento no encontrado.');
    } else if (userId) {
      if (
        !Number.isSafeInteger(userId) ||
        !(await canReadWorkspaceDocument(this.prisma, documentId, {
          kind: 'PERSONAL',
          userId,
        }))
      )
        throw new NotFoundException('Documento no encontrado.');
    }
    const document = await this.prisma.corpusDocument.findFirst({
      where: {
        id: documentId,
        documentScope: workspaceId || userId ? 'PRIVATE_WORKSPACE' : 'GENERAL',
        ...(workspaceId
          ? { workspaceDocuments: { some: { workspaceId } } }
          : userId
            ? {
                workspaceDocuments: {
                  some: { workspaceId: null, ownerUserId: userId },
                },
              }
            : {}),
        visibility: { in: allowed },
        status: { in: ['INDEXED', 'OCR_REQUIRED'] },
      },
      include: {
        files: { orderBy: { version: 'desc' }, take: 1 },
        latestExtraction: {
          include: {
            pages: {
              orderBy: { pageNumber: 'asc' },
              select: {
                pageNumber: true,
                textKind: true,
                processingStatus: true,
              },
            },
          },
        },
        ingestions: {
          orderBy: { ingestedAt: 'desc' },
          take: 1,
          include: { sourceSystem: { select: { code: true, name: true } } },
        },
      },
    });
    if (!document) throw new NotFoundException('Documento no encontrado.');
    return document;
  }
}

function isUsablePage(
  extractionStatus: string | null | undefined,
  page: { textKind?: string | null; processingStatus?: string | null },
) {
  if (page.textKind === 'NATIVE') return true;
  return (
    page.textKind === 'OCR' &&
    extractionStatus === 'OCR_HUMAN_APPROVED' &&
    page.processingStatus === 'OCR_HUMAN_APPROVED'
  );
}

export function singleByteRange(rangeHeader: string | undefined, size: number) {
  if (!rangeHeader)
    return { status: 200, start: 0, end: Math.max(0, size - 1) };
  const match = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0)
    return { status: 416, start: 0, end: -1 };
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0)
      return { status: 416, start: 0, end: -1 };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return { status: 416, start: 0, end: -1 };
  return { status: 206, start, end: Math.min(end, size - 1) };
}

export function safeContentDisposition(filename: string, inline: boolean) {
  const clean = safeFilename(filename);
  const fallback =
    clean.replace(/[^\x20-\x7e]|["\\;]/gu, '_').replace(/[\r\n]/gu, '_') ||
    'documento';
  const encoded = encodeURIComponent(clean).replace(
    /['()]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function safeFilename(filename: string) {
  const basename =
    filename.replace(/\\/gu, '/').split('/').pop() ?? 'documento';
  const clean = basename
    // eslint-disable-next-line no-control-regex -- remove control chars from uploaded file names
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .replace(/[<>:"|?*]/gu, '_')
    .trim();
  return clean.slice(0, 180) || 'documento';
}

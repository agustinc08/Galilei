import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Prisma } from '../generated/prisma/client';
import { ROLES, type RoleName } from '../auth/constants';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeSearchText } from '../busqueda/utils/search-normalizer';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import {
  LocalDocumentProcessingError,
  LocalPdfOcrProcessor,
} from './document-local-processors';
import {
  BasicDocumentTextExtractor,
  InvalidPdfError,
} from './document-text-extractor';
import { OCR_REVIEW_PAGE_TEXT_LIMIT } from './ocr-human-review.dto';

const PAGE_TEXT_LIMIT = OCR_REVIEW_PAGE_TEXT_LIMIT;
const PAGE_COUNT_LIMIT = 2_000;
const RUNTIME_CHECK_PAGE_LIMIT = 3;
const RUNTIME_CHECK_BYTE_LIMIT = 20 * 1024 * 1024;
const RUNTIME_CHECK_PREVIEW_LIMIT = 180;
const SOURCE_CODES = [
  'JURISPRUDENCIA_LOCAL_PDF',
  'DIGESTO_LOCAL',
  'INSTITUTIONAL_UPLOAD',
];
type ReviewRole = RoleName;
type ReviewWithContext = Prisma.OcrHumanReviewGetPayload<{
  include: {
    document: {
      include: {
        files: { orderBy: { version: 'desc' }; take: 1 };
        latestExtraction: {
          include: { pages: { orderBy: { pageNumber: 'asc' } } };
        };
        ingestions: { take: 1 };
      };
    };
    file: true;
    activeRun: { include: { pages: { orderBy: { pageNumber: 'asc' } } } };
  };
}>;

@Injectable()
export class OcrHumanReviewService {
  private readonly runtimeTextExtractor = new BasicDocumentTextExtractor();

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: LocalPdfOcrProcessor,
    private readonly documents: CorpusDocumentAccessService,
  ) {}

  runtimeDiagnostics() {
    const { config, capabilities } = this.processor;
    const engineDirectory = capabilities.enginePath
      ? path.dirname(capabilities.enginePath)
      : null;
    const rendererDirectory = capabilities.rendererPath
      ? path.dirname(capabilities.rendererPath)
      : null;
    return {
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        executable: process.execPath,
        workingDirectory: process.cwd(),
        environment: process.env.NODE_ENV ?? null,
      },
      ocr: {
        enabled: config.enabled,
        available: capabilities.ocrAvailable,
        enginePath: capabilities.enginePath,
        engineVersion: capabilities.engineVersion,
        configuredLanguages: config.languages,
        installedLanguages: capabilities.languages,
        spanishAvailable: capabilities.languages.includes('spa'),
        tessdataDirectory: config.tessdataDir,
        pathContainsEngineDirectory: pathContains(engineDirectory),
        rendererPath: capabilities.rendererPath,
        rendererVersion: capabilities.rendererVersion,
        pathContainsRendererDirectory: pathContains(rendererDirectory),
        temporaryDirectory: config.tempDir,
        timeoutMs: config.timeoutMs,
        maximumPages: config.maxPages,
      },
    };
  }

  async verifyRuntimePdf(content: Buffer) {
    const sha256 = createHash('sha256').update(content).digest('hex');
    const preserved = () =>
      createHash('sha256').update(content).digest('hex') === sha256;
    if (
      content.byteLength === 0 ||
      !content.subarray(0, 5).equals(Buffer.from('%PDF-'))
    )
      return runtimeCheckResult({
        status: 'CONTROLLED_ERROR',
        errorCode: 'FILE_INVALID',
        message: 'El archivo no es un PDF válido.',
        sha256,
        originalPreserved: preserved(),
      });
    if (content.byteLength > RUNTIME_CHECK_BYTE_LIMIT)
      return runtimeCheckResult({
        status: 'CONTROLLED_ERROR',
        errorCode: 'FILE_TOO_LARGE',
        message: 'El PDF supera el límite de 20 MiB para esta comprobación.',
        sha256,
        originalPreserved: preserved(),
      });

    try {
      const pageCount = await this.processor.inspectPdfPageCount(content);
      if (pageCount > RUNTIME_CHECK_PAGE_LIMIT)
        return runtimeCheckResult({
          status: 'CONTROLLED_ERROR',
          errorCode: 'PAGE_LIMIT',
          message: 'La comprobación admite hasta tres páginas.',
          sha256,
          pageCount,
          originalPreserved: preserved(),
        });

      const extraction = await this.runtimeTextExtractor.extract(
        'runtime-check.pdf',
        'application/pdf',
        content,
      );
      if (extraction.ocrRequiredPages.length === 0) {
        return runtimeCheckResult({
          status: 'NATIVE_TEXT_FOUND',
          message: 'El PDF ya contiene texto seleccionable; no se ejecutó OCR.',
          sha256,
          pageCount,
          nativeTextCharacters: extraction.text.length,
          ocrAttempted: false,
          originalPreserved: preserved(),
        });
      }

      const run = await this.processor.processPdf(
        content,
        sha256,
        extraction.ocrRequiredPages,
        {
          languages: ['spa'],
          timeoutMs: Math.min(this.processor.config.timeoutMs, 60_000),
        },
      );
      const pages = run.pages.map((page) => ({
        pageNumber: page.pageNumber,
        characters: page.text.length,
        confidence: page.confidence,
        textPreview: page.text.slice(0, RUNTIME_CHECK_PREVIEW_LIMIT),
      }));
      return runtimeCheckResult({
        status: pages.some((page) => page.characters > 0)
          ? 'OCR_READY_FOR_HUMAN_REVIEW'
          : 'OCR_NO_TEXT',
        message: pages.some((page) => page.characters > 0)
          ? 'OCR completado en este proceso. El resultado requiere revisión humana.'
          : 'El motor terminó, pero no obtuvo texto utilizable; requiere revisión humana.',
        sha256,
        pageCount,
        nativeTextCharacters: extraction.text.length,
        ocrAttempted: true,
        pages,
        originalPreserved: preserved(),
      });
    } catch (error) {
      const errorCode = runtimeCheckErrorCode(error);
      const reviewable = errorCode === 'OCR_LOW_QUALITY';
      return runtimeCheckResult({
        status: reviewable ? 'OCR_REVIEW_REQUIRED' : 'CONTROLLED_ERROR',
        errorCode,
        message: reviewable
          ? 'El escaneo fue procesado, pero la calidad requiere revisión humana.'
          : runtimeCheckMessage(errorCode),
        sha256,
        ocrAttempted: true,
        originalPreserved: preserved(),
      });
    }
  }

  async queue(filter: string, page: number, pageSize: number, actorId: number) {
    const safePage = Math.max(1, Math.trunc(page) || 1);
    const safePageSize = Math.min(50, Math.max(1, Math.trunc(pageSize) || 25));
    const base = this.queueWhere();
    const where: Prisma.CorpusDocumentWhereInput = { ...base };
    if (filter === 'mine')
      where.ocrReviews = { some: { assignedToId: actorId } };
    else if (filter === 'unassigned')
      where.AND = [
        ...(Array.isArray(where.AND)
          ? where.AND
          : where.AND
            ? [where.AND]
            : []),
        {
          OR: [
            { ocrReviews: { none: {} } },
            { ocrReviews: { some: { assignedToId: null } } },
          ],
        },
      ];
    else if (filter === 'assigned')
      where.ocrReviews = { some: { assignedToId: { not: null } } };
    else if (filter === 'ready')
      where.ocrReviews = { some: { status: 'READY_FOR_APPROVAL' } };
    else if (filter !== 'all')
      throw new BadRequestException('Filtro de cola no reconocido.');

    const [total, documents, unreviewed, mine, ready] = await Promise.all([
      this.prisma.corpusDocument.count({ where }),
      this.prisma.corpusDocument.findMany({
        where,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        select: {
          id: true,
          title: true,
          court: true,
          chamber: true,
          caseNumber: true,
          decisionDate: true,
          updatedAt: true,
          files: {
            orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: {
              id: true,
              originalFilename: true,
              pageCount: true,
              sha256: true,
            },
          },
          latestExtraction: {
            select: {
              pages: {
                select: { pageNumber: true },
                orderBy: { pageNumber: 'desc' },
                take: 1,
              },
            },
          },
          ocrReviews: {
            orderBy: { updatedAt: 'desc' },
            take: 1,
            select: {
              id: true,
              status: true,
              assignedToId: true,
              version: true,
              activeApprovalId: true,
              activeRun: {
                select: {
                  status: true,
                  pageCount: true,
                  pages: { select: { status: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.corpusDocument.count({
        where: { ...base, ocrReviews: { none: {} } },
      }),
      this.prisma.corpusDocument.count({
        where: { ...base, ocrReviews: { some: { assignedToId: actorId } } },
      }),
      this.prisma.corpusDocument.count({
        where: {
          ...base,
          ocrReviews: { some: { status: 'READY_FOR_APPROVAL' } },
        },
      }),
    ]);

    return {
      page: safePage,
      pageSize: safePageSize,
      total,
      pageCount: Math.ceil(total / safePageSize),
      counts: {
        total: await this.prisma.corpusDocument.count({ where: base }),
        unreviewed,
        mine,
        ready,
      },
      results: documents.map((document) => {
        const file = document.files[0];
        const review = document.ocrReviews[0];
        const lastSourcePage =
          document.latestExtraction?.pages[0]?.pageNumber ?? 0;
        const pageCount = file?.pageCount ?? lastSourcePage;
        const approvedPages =
          review?.activeRun?.pages.filter((item) =>
            ['APPROVED', 'NO_TEXT'].includes(item.status),
          ).length ?? 0;
        return {
          documentId: document.id,
          title: document.title,
          court: document.court,
          chamber: document.chamber,
          caseNumber: document.caseNumber,
          decisionDate: document.decisionDate,
          fileId: file?.id ?? null,
          filename: file?.originalFilename ?? null,
          fileSha256: file?.sha256 ?? null,
          pageCount,
          reviewId: review?.id ?? null,
          status: review?.status ?? 'PENDING',
          assignedToId: review?.assignedToId ?? null,
          version: review?.version ?? null,
          hasApprovedVersion: Boolean(review?.activeApprovalId),
          approvedPages,
          ocrRun: review?.activeRun
            ? {
                status: review.activeRun.status,
                generatedPageCount: review.activeRun.pages.length,
                pageCount: review.activeRun.pageCount,
              }
            : null,
        };
      }),
    };
  }

  async openDocument(documentId: string, actorId: number, role: ReviewRole) {
    const document = await this.prisma.corpusDocument.findFirst({
      where: { id: documentId, ...this.queueWhere() },
      include: {
        files: {
          orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
          take: 1,
        },
        latestExtraction: {
          include: { pages: { orderBy: { pageNumber: 'asc' } } },
        },
        ocrReviews: { orderBy: { updatedAt: 'desc' }, take: 1 },
      },
    });
    if (!document || !document.files[0])
      throw new NotFoundException('Documento OCR no encontrado.');
    const pageCount = this.resolvePageCount(
      document.files[0].pageCount,
      document.latestExtraction?.pages.map((item) => item.pageNumber) ?? [],
    );
    const review = await this.prisma.ocrHumanReview.upsert({
      where: {
        documentId_fileId: {
          documentId: document.id,
          fileId: document.files[0].id,
        },
      },
      create: {
        documentId: document.id,
        fileId: document.files[0].id,
        createdById: actorId,
      },
      update: {},
    });
    return this.reviewDetails(review.id, actorId, role, pageCount);
  }

  async reviewDetails(
    reviewId: string,
    actorId: number,
    role: ReviewRole,
    knownPageCount?: number,
  ) {
    const review = await this.loadReview(reviewId);
    this.assertReviewAccess(review);
    this.assertAssignee(review, actorId, role);
    const pageCount = this.resolvePageCount(
      review.file.pageCount,
      review.document.latestExtraction?.pages.map((item) => item.pageNumber) ??
        [],
      knownPageCount,
    );
    return {
      id: review.id,
      status: review.status,
      version: review.version,
      assignedToId: review.assignedToId,
      hasApprovedVersion: Boolean(review.activeApprovalId),
      currentApprovalId: review.activeApprovalId,
      document: {
        id: review.document.id,
        title: review.document.title,
        subtitle: review.document.subtitle,
        court: review.document.court,
        chamber: review.document.chamber,
        caseNumber: review.document.caseNumber,
        decisionDate: review.document.decisionDate,
        status: review.document.status,
      },
      file: {
        id: review.file.id,
        filename: review.file.originalFilename,
        mimeType: review.file.mimeType,
        sha256: review.file.sha256,
        sizeBytes: Number(review.file.sizeBytes),
        pageCount,
        href: '/ocr-human-review/' + review.id + '/file',
      },
      sourceExtractionId: review.document.latestExtractionId,
      sourcePages: (review.document.latestExtraction?.pages ?? []).map(
        (item) => ({
          pageNumber: item.pageNumber,
          text: item.text,
          textKind: item.textKind,
          processingStatus: item.processingStatus,
        }),
      ),
      activeRun: review.activeRun
        ? {
            id: review.activeRun.id,
            runNumber: review.activeRun.runNumber,
            fingerprint: review.activeRun.fingerprint,
            processorVersion: review.activeRun.processorVersion,
            sourceFileSha256: review.activeRun.sourceFileSha256,
            pageCount: review.activeRun.pageCount,
            status: review.activeRun.status,
            provenance: review.activeRun.provenance,
            pages: review.activeRun.pages.map((item) => ({
              id: item.id,
              pageNumber: item.pageNumber,
              version: item.version,
              status: item.status,
              ocrText: item.ocrText,
              correctedText: item.correctedText,
              ocrChecksum: item.ocrChecksum,
              renderedImageSha256: item.renderedImageSha256,
              confidence: item.confidence,
              processingError: item.processingError,
              approvedById: item.approvedById,
              approvedAt: item.approvedAt,
              approvedChecksum: item.approvedChecksum,
            })),
          }
        : null,
    };
  }

  async assignSelf(reviewId: string, actorId: number) {
    const review = await this.loadReview(reviewId);
    this.assertReviewAccess(review);
    if (review.assignedToId && review.assignedToId !== actorId)
      throw new ConflictException(
        'El documento ya fue tomado por otra persona.',
      );
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.ocrHumanReview.updateMany({
        where: {
          id: reviewId,
          OR: [{ assignedToId: null }, { assignedToId: actorId }],
          version: review.version,
        },
        data: {
          assignedToId: actorId,
          status: review.status === 'PENDING' ? 'IN_REVIEW' : review.status,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'La revisión cambió en otra sesión. Recargá la cola.',
        );
      await tx.ocrHumanReviewRevision.create({
        data: {
          reviewId,
          actorId,
          action: 'ASSIGNED_TO_SELF',
          details: { assignedToId: actorId },
        },
      });
    });
    return this.reviewDetails(reviewId, actorId, ROLES.JURISPRUDENCIA);
  }

  async generateOcr(
    reviewId: string,
    actorId: number,
    role: ReviewRole,
    force = false,
  ) {
    const review = await this.loadReview(reviewId);
    this.assertReviewAccess(review);
    this.assertAssignee(review, actorId, role);
    if (
      review.document.status !== 'OCR_REQUIRED' &&
      !(review.document.status === 'INDEXED' && review.activeApprovalId)
    )
      throw new ConflictException('El documento ya no requiere OCR.');
    if (review.file.mimeType !== 'application/pdf')
      throw new BadRequestException('La revisión OCR solo admite PDF.');
    let sourcePdf: Awaited<ReturnType<CorpusDocumentAccessService['file']>>;
    try {
      sourcePdf = await this.documents.file(review.documentId, 'INTERNAL');
    } catch {
      throw new NotFoundException('No se pudo verificar el PDF original.');
    }
    if (
      sourcePdf.sha256 !== review.file.sha256 ||
      review.document.files[0]?.id !== review.file.id
    )
      throw new ConflictException(
        'El archivo cambió desde que se abrió la revisión.',
      );
    let physicalPageCount: number;
    try {
      physicalPageCount = await this.processor.inspectPdfPageCount(
        sourcePdf.content,
      );
    } catch (error) {
      if (error instanceof LocalDocumentProcessingError)
        throw new BadRequestException(
          'No se pudo confirmar la cantidad física de páginas (' +
            error.code +
            ').',
        );
      throw error;
    }
    const recordedPageCount = this.resolvePageCount(
      review.file.pageCount,
      review.document.latestExtraction?.pages.map((item) => item.pageNumber) ??
        [],
    );
    if (recordedPageCount !== physicalPageCount)
      throw new ConflictException(
        'La cantidad física de páginas del PDF no coincide con la registrada. No se inició OCR.',
      );
    const pageCount = physicalPageCount;
    const pageNumbers = Array.from(
      { length: pageCount },
      (_, index) => index + 1,
    );
    const processorVersion = this.processor.identity();
    const fingerprint = this.processor.fingerprint(
      review.file.sha256,
      pageNumbers,
    );
    if (
      !force &&
      review.activeRun?.status === 'COMPLETE' &&
      review.activeRun.fingerprint === fingerprint
    )
      return this.reviewDetails(reviewId, actorId, role);
    if (!force) {
      const cached = await this.prisma.ocrHumanReviewRun.findFirst({
        where: {
          sourceFileSha256: review.file.sha256,
          fingerprint,
          status: 'COMPLETE',
        },
        include: { pages: { orderBy: { pageNumber: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      });
      if (cached) {
        return this.installCachedRun(review, cached, actorId, role);
      }
    }

    const run = await this.createRun(
      review,
      actorId,
      fingerprint,
      processorVersion,
      pageCount,
    );
    const pageProvenance: Record<string, unknown>[] = [];
    try {
      for (const pageNumber of pageNumbers) {
        try {
          const result = await this.processor.processPdf(
            sourcePdf.content,
            review.file.sha256,
            [pageNumber],
          );
          const page = result.pages[0];
          if (!page || page.pageNumber !== pageNumber)
            throw new LocalDocumentProcessingError('OCR_RENDER_FAILED');
          if (page.text.length > PAGE_TEXT_LIMIT)
            throw new LocalDocumentProcessingError('OCR_PAGE_TOO_LARGE');
          pageProvenance.push(result.provenance);
          await this.prisma.ocrHumanReviewPage.create({
            data: {
              runId: run.id,
              pageNumber,
              ocrText: page.text,
              ocrChecksum: checksum(page.text),
              renderedImageSha256: page.renderedImageSha256 ?? null,
              confidence: page.confidence,
            },
          });
        } catch (error) {
          if (
            error instanceof LocalDocumentProcessingError &&
            error.code === 'OCR_LOW_QUALITY'
          ) {
            pageProvenance.push({ pageNumber, result: 'LOW_QUALITY' });
            await this.prisma.ocrHumanReviewPage.create({
              data: {
                runId: run.id,
                pageNumber,
                ocrText: '',
                ocrChecksum: checksum(''),
                processingError: 'OCR_LOW_QUALITY',
              },
            });
            continue;
          }
          throw error;
        }
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.ocrHumanReviewRun.update({
          where: { id: run.id },
          data: {
            status: 'COMPLETE',
            provenance: {
              engine: 'tesseract-local',
              processorVersion,
              fileSha256: review.file.sha256,
              fingerprint,
              pageCount,
              sourceExtractionId: review.document.latestExtractionId,
              processedAt: new Date().toISOString(),
              pageRuns: pageProvenance,
            } as Prisma.InputJsonValue,
          },
        });
        await tx.ocrHumanReview.update({
          where: { id: review.id },
          data: {
            status: 'IN_REVIEW',
            activeRunId: run.id,
            version: { increment: 1 },
          },
        });
        await tx.ocrHumanReviewRevision.create({
          data: {
            reviewId: review.id,
            actorId,
            action: 'OCR_RUN_COMPLETED',
            details: { runId: run.id, fingerprint, pageCount, reused: false },
          },
        });
      });
    } catch (error) {
      await this.prisma.ocrHumanReviewRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          provenance: {
            engine: 'tesseract-local',
            processorVersion,
            fileSha256: review.file.sha256,
            fingerprint,
            pageCount,
            sourceExtractionId: review.document.latestExtractionId,
            failureCode:
              error instanceof LocalDocumentProcessingError
                ? error.code
                : 'OCR_PROCESSING_FAILED',
            pageRuns: pageProvenance,
            processedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
      throw error instanceof LocalDocumentProcessingError
        ? new BadRequestException(
            'No se pudo generar OCR local (' + error.code + ').',
          )
        : error;
    }
    return this.reviewDetails(reviewId, actorId, role);
  }

  async originalPdf(reviewId: string, actorId: number, role: ReviewRole) {
    const review = await this.loadReview(reviewId);
    this.assertReviewAccess(review);
    this.assertAssignee(review, actorId, role);
    const original = await this.documents.file(review.documentId, 'INTERNAL');
    if (original.sha256 !== review.file.sha256)
      throw new ConflictException(
        'El PDF original cambió desde que se abrió la revisión.',
      );
    if (review.document.files[0]?.id !== review.file.id)
      throw new ConflictException(
        'El archivo activo cambió desde que se abrió la revisión.',
      );
    return original;
  }

  async savePage(
    reviewId: string,
    pageNumber: number,
    actorId: number,
    role: ReviewRole,
    input: { expectedVersion: number; correctedText: string | null },
  ) {
    const review = await this.loadReview(reviewId);
    this.assertReviewAccess(review);
    this.assertAssignee(review, actorId, role);
    const page = this.activePage(review, pageNumber);
    const text =
      input.correctedText === null
        ? null
        : normalizeHumanText(input.correctedText);
    if (text !== null && text.length > PAGE_TEXT_LIMIT)
      throw new BadRequestException(
        'El texto corregido excede el máximo por página.',
      );
    if (page.version !== input.expectedVersion)
      throw new ConflictException(
        'La página fue editada en otra sesión. Recargá antes de guardar.',
      );
    if (['APPROVED', 'NO_TEXT'].includes(page.status))
      throw new ConflictException('Reabrí la página antes de editarla.');
    const previousChecksum =
      page.correctedText === null ? null : checksum(page.correctedText);
    const newChecksum = text === null ? null : checksum(text);
    if (previousChecksum === newChecksum)
      return this.reviewDetails(reviewId, actorId, role);

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.ocrHumanReviewPage.updateMany({
        where: {
          id: page.id,
          version: input.expectedVersion,
          status: { notIn: ['APPROVED', 'NO_TEXT'] },
        },
        data: { correctedText: text, version: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'La página fue editada en otra sesión. Recargá antes de guardar.',
        );
      await tx.ocrHumanReviewRevision.create({
        data: {
          reviewId,
          pageId: page.id,
          actorId,
          action: 'CORRECTION_SAVED',
          previousChecksum,
          newChecksum,
          textSnapshot: text,
        },
      });
      const reviewChanged = await tx.ocrHumanReview.updateMany({
        where: { id: reviewId, activeRunId: page.runId },
        data: { version: { increment: 1 } },
      });
      if (reviewChanged.count !== 1)
        throw new ConflictException(
          'La ejecución OCR activa cambió durante el guardado. Recargá la revisión.',
        );
    });
    return this.reviewDetails(reviewId, actorId, role);
  }

  async approvePage(
    reviewId: string,
    pageNumber: number,
    actorId: number,
    role: ReviewRole,
    expectedVersion: number,
  ) {
    const review = await this.loadReview(reviewId);
    this.assertReviewAccess(review);
    this.assertAssignee(review, actorId, role);
    const page = this.activePage(review, pageNumber);
    if (page.version !== expectedVersion)
      throw new ConflictException(
        'La página cambió en otra sesión. Recargá antes de aprobar.',
      );
    if (['APPROVED', 'NO_TEXT'].includes(page.status))
      throw new ConflictException(
        'Reabrí la página antes de aprobarla nuevamente.',
      );
    const approvedText = selectApprovedText(page.ocrText, page.correctedText);
    if (!approvedText.trim())
      throw new BadRequestException(
        'Usá “Página sin texto” para confirmar una página vacía.',
      );
    await this.transitionPage({
      review,
      page,
      actorId,
      role,
      expectedVersion,
      toStatus: 'APPROVED',
      action: 'PAGE_APPROVED',
      approvedChecksum: checksum(approvedText),
    });
    return this.reviewDetails(reviewId, actorId, role);
  }

  async markNoText(
    reviewId: string,
    pageNumber: number,
    actorId: number,
    role: ReviewRole,
    expectedVersion: number,
  ) {
    const review = await this.loadReview(reviewId);
    this.assertReviewAccess(review);
    this.assertAssignee(review, actorId, role);
    const page = this.activePage(review, pageNumber);
    if (page.version !== expectedVersion)
      throw new ConflictException(
        'La página cambió en otra sesión. Recargá antes de confirmar.',
      );
    if (['APPROVED', 'NO_TEXT'].includes(page.status))
      throw new ConflictException(
        'Reabrí la página antes de cambiar su estado.',
      );
    await this.transitionPage({
      review,
      page,
      actorId,
      role,
      expectedVersion,
      toStatus: 'NO_TEXT',
      action: 'PAGE_CONFIRMED_NO_TEXT',
      approvedChecksum: checksum(''),
    });
    return this.reviewDetails(reviewId, actorId, role);
  }

  async rejectPage(
    reviewId: string,
    pageNumber: number,
    actorId: number,
    role: ReviewRole,
    input: { expectedVersion: number; reason: string },
  ) {
    const reasons = new Set([
      'ILLEGIBLE',
      'ROTATED',
      'BAD_SCAN',
      'OCR_CORRUPT',
      'OTHER',
    ]);
    if (!reasons.has(input.reason))
      throw new BadRequestException('Motivo de rechazo no reconocido.');
    const review = await this.loadReview(reviewId);
    this.assertReviewAccess(review);
    this.assertAssignee(review, actorId, role);
    const page = this.activePage(review, pageNumber);
    if (page.version !== input.expectedVersion)
      throw new ConflictException(
        'La página cambió en otra sesión. Recargá antes de rechazar.',
      );
    if (['APPROVED', 'NO_TEXT'].includes(page.status))
      throw new ConflictException('Reabrí la página antes de rechazarla.');
    await this.transitionPage({
      review,
      page,
      actorId,
      role,
      expectedVersion: input.expectedVersion,
      toStatus: 'REJECTED',
      action: 'PAGE_REJECTED',
      details: { reason: input.reason },
    });
    return this.reviewDetails(reviewId, actorId, role);
  }

  async reopenPage(
    reviewId: string,
    pageNumber: number,
    actorId: number,
    role: ReviewRole,
    expectedVersion: number,
  ) {
    const review = await this.loadReview(reviewId);
    this.assertReviewAccess(review);
    this.assertAssignee(review, actorId, role);
    const page = this.activePage(review, pageNumber);
    if (page.version !== expectedVersion)
      throw new ConflictException(
        'La página cambió en otra sesión. Recargá antes de reabrir.',
      );
    if (!['APPROVED', 'NO_TEXT'].includes(page.status))
      throw new ConflictException('Solo se pueden reabrir páginas aprobadas.');
    await this.transitionPage({
      review,
      page,
      actorId,
      role,
      expectedVersion,
      toStatus: 'REOPENED',
      action: 'PAGE_REOPENED',
      clearApproval: true,
    });
    return this.reviewDetails(reviewId, actorId, role);
  }

  async approveDocument(reviewId: string, actorId: number, role: ReviewRole) {
    const review = await this.loadReview(reviewId);
    this.assertReviewAccess(review);
    this.assertAssignee(review, actorId, role);
    if (!review.activeRun || review.activeRun.status !== 'COMPLETE')
      throw new ConflictException(
        'Generá OCR y revisá todas las páginas antes de aprobar el documento.',
      );
    const pages = review.activeRun.pages;
    const expectedCount = this.resolvePageCount(
      review.file.pageCount,
      review.document.latestExtraction?.pages.map((item) => item.pageNumber) ??
        [],
    );
    if (
      pages.length !== expectedCount ||
      pages.some((item, index) => item.pageNumber !== index + 1) ||
      pages.some((item) => !['APPROVED', 'NO_TEXT'].includes(item.status))
    )
      throw new ConflictException(
        'Cada página debe aprobarse o confirmarse “Sin texto”.',
      );

    const approvedPages = pages.map((page) => {
      const text =
        page.status === 'NO_TEXT'
          ? ''
          : selectApprovedText(page.ocrText, page.correctedText);
      if (checksum(text) !== page.approvedChecksum)
        throw new ConflictException(
          'El texto aprobado cambió; reabrí y aprobá nuevamente la página.',
        );
      return { page, text };
    });
    const mergedText = approvedPages
      .map(({ text }) => text)
      .filter((text) => text.length > 0)
      .join('\n\n')
      .trim();
    const searchText = normalizeSearchText(
      [
        review.document.title,
        review.document.subtitle,
        review.document.court,
        review.document.chamber,
        review.document.caseNumber,
        review.document.docket,
        JSON.stringify(review.document.metadata ?? {}),
        mergedText,
      ]
        .filter(Boolean)
        .join(' '),
    );
    const documentChecksum = checksum(
      approvedPages
        .map(
          ({ page, text }) => String(page.pageNumber) + '\0' + checksum(text),
        )
        .join('\n'),
    );
    const searchTextChecksum = checksum(searchText);

    const approval = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.ocrHumanReview.updateMany({
        where: {
          id: reviewId,
          version: review.version,
          activeRunId: review.activeRunId,
        },
        data: { version: { increment: 1 } },
      });
      if (locked.count !== 1)
        throw new ConflictException(
          'La revisión cambió durante la aprobación del documento.',
        );
      const fresh = await tx.ocrHumanReview.findUnique({
        where: { id: reviewId },
        include: {
          activeRun: { include: { pages: { orderBy: { pageNumber: 'asc' } } } },
          document: {
            include: {
              files: {
                orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
                take: 1,
              },
            },
          },
          file: true,
        },
      });
      if (!fresh || fresh.activeRunId !== review.activeRunId)
        throw new ConflictException(
          'La ejecución OCR activa cambió durante la aprobación.',
        );
      if (
        fresh.document.status !== 'OCR_REQUIRED' &&
        !(fresh.document.status === 'INDEXED' && fresh.activeApprovalId)
      )
        throw new ConflictException(
          'El documento dejó de requerir una revisión OCR.',
        );
      if (
        fresh.fileId !== fresh.document.files[0]?.id ||
        fresh.file.sha256 !== review.file.sha256
      )
        throw new ConflictException(
          'El PDF original cambió durante la revisión.',
        );
      if (
        !fresh.activeRun ||
        fresh.activeRun.pages.length !== expectedCount ||
        fresh.activeRun.pages.some(
          (item, index) => item.pageNumber !== index + 1,
        ) ||
        fresh.activeRun.pages.some(
          (item) =>
            !['APPROVED', 'NO_TEXT'].includes(item.status) ||
            !item.approvedById ||
            !item.approvedAt ||
            !item.approvedChecksum,
        )
      )
        throw new ConflictException(
          'Las páginas cambiaron durante la aprobación.',
        );
      const sourceExtractionId = readSourceExtractionId(
        fresh.activeRun.provenance,
      );
      if (sourceExtractionId !== fresh.document.latestExtractionId) {
        const priorApproval = fresh.activeApprovalId
          ? await tx.ocrHumanReviewApproval.findUnique({
              where: { id: fresh.activeApprovalId },
              select: {
                runId: true,
                extractionId: true,
                sourceFileSha256: true,
              },
            })
          : null;
        if (
          !priorApproval ||
          priorApproval.runId !== fresh.activeRunId ||
          priorApproval.extractionId !== fresh.document.latestExtractionId ||
          priorApproval.sourceFileSha256 !== fresh.file.sha256
        )
          throw new ConflictException(
            'La extracción fuente cambió durante la revisión; generá OCR nuevamente.',
          );
      }

      const sequence =
        (
          await tx.ocrHumanReviewApproval.aggregate({
            where: { reviewId },
            _max: { sequence: true },
          })
        )._max.sequence ?? 0;
      const extraction = await tx.corpusExtraction.create({
        data: {
          documentId: fresh.documentId,
          fileId: fresh.fileId,
          extractor: 'ocr-human-reviewed',
          extractorVersion: fresh.activeRun.processorVersion,
          status: 'OCR_HUMAN_APPROVED',
          text: mergedText,
          provenance: {
            reviewId,
            runId: fresh.activeRunId,
            sourceFileSha256: fresh.file.sha256,
            sourceExtractionId,
            pageCount: expectedCount,
            documentChecksum,
            approvedText: 'CORRECTED_TEXT_OR_OCR',
            approvedById: actorId,
            approvedAt: new Date().toISOString(),
          },
          pages: {
            create: approvedPages.map(({ page, text }) => ({
              pageNumber: page.pageNumber,
              text,
              textKind: 'OCR',
              processingStatus:
                page.status === 'NO_TEXT'
                  ? 'NO_TEXT_CONFIRMED'
                  : 'OCR_HUMAN_APPROVED',
              ocrConfidence: page.confidence,
            })),
          },
        },
        select: { id: true },
      });
      const changed = await tx.corpusDocument.updateMany({
        where: {
          id: fresh.documentId,
          status: fresh.document.status,
          latestExtractionId: fresh.document.latestExtractionId,
        },
        data: {
          status: 'INDEXED',
          searchText,
          latestExtractionId: extraction.id,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'El documento cambió durante la aprobación; no se publicó la extracción.',
        );
      const created = await tx.ocrHumanReviewApproval.create({
        data: {
          reviewId,
          runId: fresh.activeRunId!,
          extractionId: extraction.id,
          sequence: sequence + 1,
          approvedById: actorId,
          sourceFileSha256: fresh.file.sha256,
          documentChecksum,
          searchTextChecksum,
        },
      });
      await tx.ocrHumanReview.update({
        where: { id: reviewId },
        data: {
          status: 'APPROVED',
          activeApprovalId: created.id,
          version: { increment: 1 },
        },
      });
      await tx.institutionalIngestion.updateMany({
        where: { documentId: fresh.documentId, fileId: fresh.fileId },
        data: {
          status: 'OCR_APPROVED',
          extractionStatus: 'OCR_HUMAN_APPROVED',
          completedAt: new Date(),
        },
      });
      await tx.corpusIngestionRecord.updateMany({
        where: { documentId: fresh.documentId, fileId: fresh.fileId },
        data: {
          status: 'INDEXED',
          errorStage: null,
          errorMessage: null,
          retryable: false,
        },
      });
      await tx.ocrHumanReviewRevision.create({
        data: {
          reviewId,
          actorId,
          action: 'DOCUMENT_APPROVED',
          newChecksum: documentChecksum,
          details: {
            extractionId: extraction.id,
            approvalId: created.id,
            previousApprovalId: review.activeApprovalId,
            sequence: sequence + 1,
          },
        },
      });
      return created;
    });
    return {
      status: 'APPROVED',
      approvalId: approval.id,
      extractionId: approval.extractionId,
      documentChecksum,
      searchTextChecksum,
      pageCount: expectedCount,
      publicationChanged: false,
      metadataChanged: false,
      citationVerificationChanged: false,
      searchOutbox: 'QUEUED_BY_EXISTING_CORPUS_TRIGGER',
    };
  }

  private async createRun(
    review: ReviewWithContext,
    actorId: number,
    fingerprint: string,
    processorVersion: string,
    pageCount: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.ocrHumanReview.findUniqueOrThrow({
        where: { id: review.id },
      });
      const runNumber =
        (
          await tx.ocrHumanReviewRun.aggregate({
            where: { reviewId: review.id },
            _max: { runNumber: true },
          })
        )._max.runNumber ?? 0;
      const run = await tx.ocrHumanReviewRun.create({
        data: {
          reviewId: review.id,
          createdById: actorId,
          runNumber: runNumber + 1,
          fingerprint,
          sourceFileSha256: review.file.sha256,
          processorVersion,
          pageCount,
          provenance: {
            engine: 'tesseract-local',
            fileSha256: review.file.sha256,
            fingerprint,
            processorVersion,
            sourceExtractionId: review.document.latestExtractionId,
            startedAt: new Date().toISOString(),
          },
        },
      });
      const changed = await tx.ocrHumanReview.updateMany({
        where: { id: review.id, version: current.version },
        data: {
          activeRunId: run.id,
          status: 'IN_REVIEW',
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'La revisión cambió al iniciar la ejecución OCR.',
        );
      return run;
    });
  }

  private async installCachedRun(
    review: ReviewWithContext,
    cached: Prisma.OcrHumanReviewRunGetPayload<{
      include: { pages: { orderBy: { pageNumber: 'asc' } } };
    }>,
    actorId: number,
    role: ReviewRole,
  ) {
    if (
      cached.pageCount !== review.file.pageCount &&
      review.file.pageCount !== null
    )
      throw new ConflictException(
        'La ejecución OCR guardada no coincide con la cantidad de páginas del PDF.',
      );
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.ocrHumanReview.findUniqueOrThrow({
        where: { id: review.id },
      });
      const runNumber =
        (
          await tx.ocrHumanReviewRun.aggregate({
            where: { reviewId: review.id },
            _max: { runNumber: true },
          })
        )._max.runNumber ?? 0;
      const run = await tx.ocrHumanReviewRun.create({
        data: {
          reviewId: review.id,
          createdById: actorId,
          runNumber: runNumber + 1,
          fingerprint: cached.fingerprint,
          sourceFileSha256: cached.sourceFileSha256,
          processorVersion: cached.processorVersion,
          status: 'COMPLETE',
          pageCount: cached.pageCount,
          provenance: {
            ...(cached.provenance as Prisma.JsonObject),
            reusedFromRunId: cached.id,
            reusedForReviewId: review.id,
            reusedAt: new Date().toISOString(),
          },
          pages: {
            create: cached.pages.map((page) => ({
              pageNumber: page.pageNumber,
              status: 'NEEDS_REVIEW',
              ocrText: page.ocrText,
              correctedText: null,
              ocrChecksum: page.ocrChecksum,
              renderedImageSha256: page.renderedImageSha256,
              confidence: page.confidence,
              processingError: page.processingError,
            })),
          },
        },
      });
      const changed = await tx.ocrHumanReview.updateMany({
        where: { id: review.id, version: current.version },
        data: {
          activeRunId: run.id,
          status: 'IN_REVIEW',
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'La revisión cambió mientras se recuperaba el OCR compartido.',
        );
      await tx.ocrHumanReviewRevision.create({
        data: {
          reviewId: review.id,
          actorId,
          action: 'OCR_RUN_REUSED',
          details: {
            runId: run.id,
            reusedFromRunId: cached.id,
            fingerprint: cached.fingerprint,
          },
        },
      });
    });
    return this.reviewDetails(review.id, actorId, role);
  }

  private async transitionPage(input: {
    review: ReviewWithContext;
    page: NonNullable<ReviewWithContext['activeRun']>['pages'][number];
    actorId: number;
    role: ReviewRole;
    expectedVersion: number;
    toStatus: string;
    action: string;
    approvedChecksum?: string;
    clearApproval?: boolean;
    details?: Record<string, unknown>;
  }) {
    const { review, page } = input;
    await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.OcrHumanReviewPageUpdateManyMutationInput = {
        status: input.toStatus,
        version: { increment: 1 },
        approvedById: input.approvedChecksum ? input.actorId : null,
        approvedAt: input.approvedChecksum ? new Date() : null,
        approvedChecksum: input.approvedChecksum ?? null,
      };
      const changed = await tx.ocrHumanReviewPage.updateMany({
        where: {
          id: page.id,
          runId: page.runId,
          version: input.expectedVersion,
          ...(input.toStatus === 'REOPENED'
            ? { status: { in: ['APPROVED', 'NO_TEXT'] } }
            : { status: { notIn: ['APPROVED', 'NO_TEXT'] } }),
        },
        data: updateData,
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'La página cambió en otra sesión. Recargá antes de continuar.',
        );
      await tx.ocrHumanReviewRevision.create({
        data: {
          reviewId: review.id,
          pageId: page.id,
          actorId: input.actorId,
          action: input.action,
          fromStatus: page.status,
          toStatus: input.toStatus,
          previousChecksum: page.approvedChecksum,
          newChecksum: input.approvedChecksum ?? null,
          details: input.details as Prisma.InputJsonValue | undefined,
        },
      });
      const statuses = await tx.ocrHumanReviewPage.findMany({
        where: { runId: page.runId },
        select: { status: true },
      });
      const complete =
        statuses.length === review.activeRun?.pageCount &&
        statuses.every((item) => ['APPROVED', 'NO_TEXT'].includes(item.status));
      const reviewChanged = await tx.ocrHumanReview.updateMany({
        where: { id: review.id, activeRunId: page.runId },
        data: {
          status: complete ? 'READY_FOR_APPROVAL' : 'IN_REVIEW',
          version: { increment: 1 },
        },
      });
      if (reviewChanged.count !== 1)
        throw new ConflictException(
          'La ejecución OCR activa cambió durante el cambio de página. Recargá la revisión.',
        );
    });
  }

  private activePage(review: ReviewWithContext, pageNumber: number) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1)
      throw new BadRequestException('Número de página inválido.');
    if (!review.activeRun || review.activeRun.status !== 'COMPLETE')
      throw new ConflictException('Generá primero una ejecución OCR local.');
    const page = review.activeRun.pages.find(
      (item) => item.pageNumber === pageNumber,
    );
    if (!page)
      throw new NotFoundException('La página no pertenece a esta revisión.');
    return page;
  }

  private queueWhere(): Prisma.CorpusDocumentWhereInput {
    return {
      documentScope: 'GENERAL',
      visibility: 'INTERNAL',
      AND: [
        {
          OR: [
            { status: 'OCR_REQUIRED' },
            {
              ocrReviews: {
                some: {
                  status: { in: ['IN_REVIEW', 'READY_FOR_APPROVAL', 'FAILED'] },
                },
              },
            },
          ],
        },
        {
          ingestions: {
            some: {
              sourceSystem: { is: { code: { in: SOURCE_CODES } } },
            },
          },
        },
      ],
    };
  }

  private async loadReview(reviewId: string): Promise<ReviewWithContext> {
    const review = await this.prisma.ocrHumanReview.findUnique({
      where: { id: reviewId },
      include: {
        document: {
          include: {
            files: {
              orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
              take: 1,
            },
            latestExtraction: {
              include: { pages: { orderBy: { pageNumber: 'asc' } } },
            },
            ingestions: {
              where: {
                sourceSystem: { is: { code: { in: SOURCE_CODES } } },
              },
              take: 1,
            },
          },
        },
        file: true,
        activeRun: { include: { pages: { orderBy: { pageNumber: 'asc' } } } },
      },
    });
    if (!review) throw new NotFoundException('Revisión OCR no encontrada.');
    return review;
  }

  private assertReviewAccess(review: ReviewWithContext) {
    if (
      review.document.documentScope !== 'GENERAL' ||
      review.document.visibility !== 'INTERNAL' ||
      !review.document.ingestions.length ||
      review.file.documentId !== review.documentId
    )
      throw new NotFoundException('Revisión OCR no encontrada.');
  }

  private assertAssignee(
    review: ReviewWithContext,
    actorId: number,
    role: ReviewRole,
  ) {
    if (
      review.assignedToId !== null &&
      review.assignedToId !== actorId &&
      role !== ROLES.ADMIN &&
      role !== ROLES.OPERADOR
    )
      throw new ForbiddenException('La revisión está asignada a otra persona.');
  }

  private resolvePageCount(
    filePageCount: number | null,
    extractedPageNumbers: number[],
    knownPageCount?: number,
  ) {
    const fallback =
      extractedPageNumbers.length > 0
        ? Math.max(...extractedPageNumbers)
        : (knownPageCount ?? 0);
    const pageCount = filePageCount ?? fallback;
    if (
      !Number.isInteger(pageCount) ||
      pageCount < 1 ||
      pageCount > PAGE_COUNT_LIMIT ||
      (knownPageCount !== undefined && pageCount !== knownPageCount)
    )
      throw new ConflictException(
        'No se pudo verificar una cantidad válida de páginas físicas.',
      );
    if (
      extractedPageNumbers.length > 0 &&
      (extractedPageNumbers.length !== fallback ||
        extractedPageNumbers.some((number, index) => number !== index + 1))
    )
      throw new ConflictException(
        'La extracción previa no conserva una secuencia completa de páginas.',
      );
    return pageCount;
  }
}

function normalizeHumanText(text: string) {
  if (typeof text !== 'string')
    throw new BadRequestException('Texto de corrección inválido.');
  return text.normalize('NFC').replace(/\r\n?/gu, '\n');
}

function checksum(text: string) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function selectApprovedText(ocrText: string, correctedText: string | null) {
  return normalizeHumanText(correctedText !== null ? correctedText : ocrText);
}

function readSourceExtractionId(provenance: Prisma.JsonValue) {
  if (
    !provenance ||
    typeof provenance !== 'object' ||
    Array.isArray(provenance)
  )
    return null;
  const value = provenance.sourceExtractionId;
  return typeof value === 'string' ? value : null;
}

function pathContains(directory: string | null) {
  if (!directory) return false;
  const expected = path.resolve(directory).toLowerCase();
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .some((entry) => path.resolve(entry).toLowerCase() === expected);
}

function runtimeCheckErrorCode(error: unknown) {
  if (error instanceof LocalDocumentProcessingError) return error.code;
  if (error instanceof InvalidPdfError) return 'FILE_INVALID';
  return 'OCR_RUNTIME_FAILED';
}

function runtimeCheckMessage(errorCode: string) {
  switch (errorCode) {
    case 'OCR_DISABLED':
      return 'OCR está desactivado en este proceso de Office.';
    case 'OCR_ENGINE_UNAVAILABLE':
      return 'El motor OCR no está disponible para el proceso de Office.';
    case 'OCR_LANGUAGE_UNAVAILABLE':
      return 'El idioma español no está disponible para el proceso de Office.';
    case 'OCR_RENDER_FAILED':
      return 'No se pudo preparar la página del PDF para el reconocimiento.';
    case 'OCR_TIMEOUT':
      return 'La comprobación superó el tiempo permitido.';
    case 'OCR_LOW_QUALITY':
      return 'El escaneo requiere revisión humana.';
    case 'FILE_INVALID':
      return 'El PDF está dañado o no se puede leer.';
    case 'PDF_INFO_UNAVAILABLE':
      return 'No se pudo verificar la estructura del PDF en este proceso.';
    default:
      return 'No se pudo completar la comprobación OCR en este proceso.';
  }
}

function runtimeCheckResult<T extends Record<string, unknown>>(result: T) {
  return { ...result, checkedAt: new Date().toISOString() };
}

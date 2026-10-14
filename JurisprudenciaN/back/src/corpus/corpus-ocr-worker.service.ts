import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  LocalDocumentProcessingError,
  LocalPdfOcrProcessor,
  type OcrPageResult,
} from './document-local-processors';
import {
  LocalDocumentStorageAdapter,
  type DocumentStorageAdapter,
} from './document-storage.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeSearchText } from '../busqueda/utils/search-normalizer';

const POLL_INTERVAL_MS = 1_000;
const LEASE_DURATION_MS = 120_000;
const STALE_RECOVERY_INTERVAL_MS = 30_000;
const MAX_ERROR_DETAIL = 4_096;

type OcrJobWithDocument = Prisma.CorpusOcrJobGetPayload<{
  include: {
    file: true;
    document: {
      include: {
        latestExtraction: {
          include: { pages: { orderBy: { pageNumber: 'asc' } } };
        };
      };
    };
  };
}>;
type OcrSourcePages = NonNullable<
  OcrJobWithDocument['document']['latestExtraction']
>['pages'];

type OcrJobClaim = { id: string };

@Injectable()
export class CorpusOcrWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CorpusOcrWorkerService.name);
  private timer: NodeJS.Timeout | undefined;
  private recoveryTimer: NodeJS.Timeout | undefined;
  private working = false;
  private stopping = false;
  private readonly storage: DocumentStorageAdapter;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LocalPdfOcrProcessor)
    private readonly processor: LocalPdfOcrProcessor = new LocalPdfOcrProcessor(),
  ) {
    this.storage = new LocalDocumentStorageAdapter();
  }

  onModuleInit() {
    const recovery = this.recoverStaleJobs();
    if (!this.processor.config.enabled) {
      void recovery.catch(() =>
        this.logger.warn('OCR stale-job recovery failed.'),
      );
      return;
    }
    void recovery
      .then(() => this.runOne())
      .catch(() => this.logger.warn('OCR startup recovery failed.'));
    this.timer = setInterval(() => void this.runOne(), POLL_INTERVAL_MS);
    this.timer.unref?.();
    this.recoveryTimer = setInterval(
      () => void this.recoverStaleJobs(),
      STALE_RECOVERY_INTERVAL_MS,
    );
    this.recoveryTimer.unref?.();
    if (!this.processor.capabilities.ocrAvailable) {
      this.logger.warn(
        'Local OCR is enabled but unavailable; durable OCR jobs remain queued until a Spanish engine and renderer are present.',
      );
    }
  }

  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
  }

  async processNextForTest(jobId?: string) {
    return this.runOne(jobId);
  }

  async recoverStaleJobs(now = new Date()) {
    const stale = { lt: now };
    const requeued = await this.prisma.corpusOcrJob.updateMany({
      where: {
        status: 'RUNNING',
        leaseExpiresAt: stale,
        attemptCount: { lt: 2 },
      },
      data: {
        status: 'PENDING',
        startedAt: null,
        completedAt: null,
        leaseExpiresAt: null,
        errorCode: 'OCR_WORKER_RESTARTED',
        errorDetail: 'A stale worker lease was recovered.',
      },
    });
    const exhaustedJobs = await this.prisma.corpusOcrJob.findMany({
      where: {
        status: 'RUNNING',
        leaseExpiresAt: stale,
        attemptCount: { gte: 2 },
      },
      select: {
        id: true,
        documentId: true,
        fileId: true,
        document: {
          select: { latestExtraction: { select: { id: true, fileId: true } } },
        },
      },
    });
    let failed = 0;
    for (const staleJob of exhaustedJobs) {
      const markedFailed = await this.prisma.$transaction(async (tx) => {
        const result = await tx.corpusOcrJob.updateMany({
          where: {
            id: staleJob.id,
            status: 'RUNNING',
            leaseExpiresAt: stale,
            attemptCount: { gte: 2 },
          },
          data: {
            status: 'FAILED',
            completedAt: now,
            leaseExpiresAt: null,
            errorCode: 'OCR_WORKER_RESTARTED',
            errorDetail:
              'The job exceeded its retry limit after a worker restart.',
          },
        });
        if (!result.count) return false;
        const latest = staleJob.document.latestExtraction;
        if (latest?.fileId === staleJob.fileId) {
          await tx.corpusDocument.updateMany({
            where: {
              id: staleJob.documentId,
              latestExtractionId: latest.id,
              status: 'OCR_PROCESSING',
            },
            data: { status: 'OCR_FAILED' },
          });
          await tx.corpusIngestionRecord.updateMany({
            where: {
              documentId: staleJob.documentId,
              fileId: staleJob.fileId,
              status: 'OCR_PROCESSING',
            },
            data: {
              status: 'OCR_FAILED',
              errorStage: 'OCR',
              errorMessage: 'OCR_WORKER_RESTARTED',
              retryable: true,
            },
          });
        }
        return true;
      });
      if (markedFailed) failed += 1;
    }
    return { requeued: requeued.count, failed };
  }

  private async runOne(jobId?: string) {
    if (
      this.working ||
      this.stopping ||
      !this.processor.config.enabled ||
      !this.processor.capabilities.ocrAvailable
    )
      return false;
    this.working = true;
    try {
      const job = await this.claimNext(jobId);
      if (!job) return false;
      const heartbeat = setInterval(
        () => {
          void this.prisma.corpusOcrJob
            .updateMany({
              where: { id: job.id, status: 'RUNNING' },
              data: {
                leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
              },
            })
            .catch(() =>
              this.logger.warn(`OCR lease heartbeat failed for ${job.id}.`),
            );
        },
        Math.max(1_000, Math.floor(LEASE_DURATION_MS / 3)),
      );
      heartbeat.unref?.();
      try {
        await this.processJob(job);
      } catch (error) {
        await this.failOrRetry(job, error);
      } finally {
        clearInterval(heartbeat);
      }
      return true;
    } catch (error) {
      this.logger.error(`OCR queue tick failed: ${safeErrorCode(error)}`);
      return false;
    } finally {
      this.working = false;
    }
  }

  private async claimNext(jobId?: string): Promise<OcrJobWithDocument | null> {
    const idFilter = jobId ? Prisma.sql`AND "id" = ${jobId}` : Prisma.empty;
    const claims = await this.prisma.$queryRaw<OcrJobClaim[]>(Prisma.sql`
      WITH next_job AS (
        SELECT "id"
        FROM "CorpusOcrJob"
        WHERE "status" = 'PENDING' AND "attemptCount" < "maxAttempts"
        ${idFilter}
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "CorpusOcrJob" AS job
      SET "status" = 'RUNNING',
          "attemptCount" = job."attemptCount" + 1,
          "startedAt" = CURRENT_TIMESTAMP,
          "completedAt" = NULL,
          "leaseExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '120 seconds',
          "errorCode" = NULL,
          "errorDetail" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      FROM next_job
      WHERE job."id" = next_job."id"
      RETURNING job."id"
    `);
    const id = claims[0]?.id;
    if (!id) return null;
    const job = await this.prisma.corpusOcrJob.findUnique({
      where: { id },
      include: {
        file: true,
        document: {
          include: {
            latestExtraction: {
              include: { pages: { orderBy: { pageNumber: 'asc' } } },
            },
          },
        },
      },
    });
    return job;
  }

  private async processJob(job: OcrJobWithDocument) {
    const extraction = job.document.latestExtraction;
    if (
      !extraction ||
      extraction.fileId !== job.fileId ||
      job.document.latestExtractionId !== extraction.id
    ) {
      await this.cancelStaleJob(job.id, 'SOURCE_REPLACED');
      return;
    }
    const requestedPages = parsePageNumbers(job.pageNumbers);
    const queuedLanguages = job.languages.split('+').map((item) => item.trim());
    if (
      this.processor.identity(job.dpi, queuedLanguages) !== job.processorVersion
    )
      throw new LocalDocumentProcessingError('OCR_PROCESSOR_CHANGED');
    const nativePages = extraction.pages;
    if (
      requestedPages.length === 0 ||
      requestedPages.some(
        (pageNumber) =>
          !nativePages.some((page) => page.pageNumber === pageNumber),
      )
    )
      throw new LocalDocumentProcessingError('FILE_INVALID');

    const content = await this.storage.get(job.file.storageKey);
    const actualSha256 = createHash('sha256').update(content).digest('hex');
    if (actualSha256 !== job.fileSha256 || actualSha256 !== job.file.sha256)
      throw new LocalDocumentProcessingError('FILE_INVALID');

    const result = await this.processor.processPdf(
      content,
      job.fileSha256,
      requestedPages,
      { dpi: job.dpi, timeoutMs: job.timeoutMs, languages: queuedLanguages },
    );
    await this.persistResult(
      job,
      extraction.id,
      nativePages,
      result.pages,
      result.provenance,
    );
  }

  private async persistResult(
    job: OcrJobWithDocument,
    sourceExtractionId: string,
    sourcePages: OcrSourcePages,
    ocrPages: OcrPageResult[],
    provenance: Record<string, unknown>,
  ) {
    const ocrByPage = new Map(ocrPages.map((page) => [page.pageNumber, page]));
    const mergedPages = sourcePages.map((page) => {
      const ocr = ocrByPage.get(page.pageNumber);
      return ocr
        ? {
            pageNumber: page.pageNumber,
            text: ocr.text,
            textKind: 'OCR',
            processingStatus: 'OCR_COMPLETE',
            ocrConfidence: ocr.confidence,
          }
        : {
            pageNumber: page.pageNumber,
            text: page.text,
            textKind: 'NATIVE',
            processingStatus:
              page.text.length < 25 ? 'OCR_REQUIRED' : 'TEXT_NATIVE',
            ocrConfidence: null,
          };
    });
    if (
      ocrByPage.size !== ocrPages.length ||
      ocrPages.length !== parsePageNumbers(job.pageNumbers).length
    )
      throw new LocalDocumentProcessingError('FILE_INVALID');
    const mergedText = mergedPages
      .map((page) => page.text)
      .filter(Boolean)
      .join('\n\n')
      .trim();
    const metadata = job.document.metadata;
    const searchText = normalizeSearchText(
      [
        job.document.title,
        job.document.subtitle,
        job.document.court,
        job.document.chamber,
        job.document.caseNumber,
        job.document.docket,
        JSON.stringify(metadata ?? {}),
        mergedText,
      ]
        .filter(Boolean)
        .join(' '),
    );
    const combinedProvenance = {
      ...(isJsonObject(job.document.latestExtraction?.provenance)
        ? job.document.latestExtraction.provenance
        : {}),
      localOcr: provenance,
      sourceFileSha256: job.fileSha256,
      sourceExtractionId,
    } as Prisma.InputJsonValue;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.corpusDocument.updateMany({
        where: {
          id: job.documentId,
          latestExtractionId: sourceExtractionId,
        },
        data: {
          status: 'INDEXED',
          searchText,
        },
      });
      if (updated.count !== 1)
        throw new LocalDocumentProcessingError('SOURCE_REPLACED');

      const newExtraction = await tx.corpusExtraction.create({
        data: {
          documentId: job.documentId,
          fileId: job.fileId,
          extractor: 'pdf-parse+tesseract-local',
          extractorVersion: this.processor.identity(),
          status: 'OCR_COMPLETE',
          text: mergedText,
          provenance: combinedProvenance,
          pages: {
            create: mergedPages,
          },
        },
        select: { id: true },
      });
      await tx.corpusDocument.updateMany({
        where: { id: job.documentId, latestExtractionId: sourceExtractionId },
        data: { latestExtractionId: newExtraction.id },
      });
      await tx.corpusIngestionRecord.updateMany({
        where: { documentId: job.documentId, fileId: job.fileId },
        data: {
          status: 'INDEXED',
          errorStage: null,
          errorMessage: null,
          retryable: false,
        },
      });
      await tx.corpusOcrJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETE',
          completedAt: new Date(),
          leaseExpiresAt: null,
          errorCode: null,
          errorDetail: null,
          provenance: {
            ...provenance,
            sourceExtractionId,
            resultExtractionId: newExtraction.id,
          },
        },
      });
    });
  }

  private async cancelStaleJob(jobId: string, reason: string) {
    await this.prisma.corpusOcrJob.updateMany({
      where: { id: jobId, status: 'RUNNING' },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
        leaseExpiresAt: null,
        errorCode: reason,
        errorDetail: 'The source file changed while OCR was running.',
      },
    });
  }

  private async failOrRetry(job: OcrJobWithDocument, error: unknown) {
    if (
      error instanceof LocalDocumentProcessingError &&
      error.code === 'SOURCE_REPLACED'
    ) {
      await this.cancelStaleJob(job.id, error.code);
      return;
    }
    const errorCode = safeErrorCode(error);
    const retry =
      !(
        error instanceof LocalDocumentProcessingError &&
        [
          'OCR_PROCESSOR_CHANGED',
          'OCR_LANGUAGE_UNAVAILABLE',
          'FILE_INVALID',
        ].includes(error.code)
      ) && job.attemptCount < job.maxAttempts;
    const safeDetail = errorCode.slice(0, MAX_ERROR_DETAIL);
    await this.prisma.$transaction(async (tx) => {
      await tx.corpusOcrJob.updateMany({
        where: { id: job.id, status: 'RUNNING' },
        data: {
          status: retry ? 'PENDING' : 'FAILED',
          completedAt: retry ? null : new Date(),
          leaseExpiresAt: null,
          errorCode,
          errorDetail: safeDetail,
        },
      });
      if (!retry) {
        await tx.corpusDocument.updateMany({
          where: {
            id: job.documentId,
            latestExtractionId: job.document.latestExtractionId,
          },
          data: { status: 'OCR_FAILED' },
        });
        await tx.corpusIngestionRecord.updateMany({
          where: { documentId: job.documentId, fileId: job.fileId },
          data: {
            status: 'OCR_FAILED',
            errorStage: 'OCR',
            errorMessage: safeDetail,
            retryable: true,
          },
        });
      }
    });
    if (!retry) this.logger.warn(`OCR job ${job.id} failed: ${errorCode}`);
  }
}

function parsePageNumbers(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is number =>
        typeof item === 'number' && Number.isInteger(item) && item > 0,
    )
    .sort((left, right) => left - right);
}

function isJsonObject(
  value: Prisma.JsonValue | null | undefined,
): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeErrorCode(error: unknown) {
  if (error instanceof LocalDocumentProcessingError) return error.code;
  if (error instanceof Prisma.PrismaClientKnownRequestError)
    return `DATABASE_${error.code}`;
  return 'OCR_FAILED';
}

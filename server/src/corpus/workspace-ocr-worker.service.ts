import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
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

const POLL_INTERVAL_MS = 1_000;
const LEASE_DURATION_MS = 120_000;
const STALE_RECOVERY_INTERVAL_MS = 30_000;
const MAX_ERROR_DETAIL = 4_096;

const jobInclude = {
  file: true,
  document: {
    include: {
      latestExtraction: {
        include: { pages: { orderBy: { pageNumber: 'asc' as const } } },
      },
    },
  },
  workspace: { include: { dependency: { select: { name: true } } } },
  requestedBy: { select: { nombre: true, apellido: true } },
} satisfies Prisma.WorkspaceOcrJobInclude;

type WorkspaceOcrJobWithSource = Prisma.WorkspaceOcrJobGetPayload<{
  include: typeof jobInclude;
}>;
type JobClaim = { id: string };

@Injectable()
export class WorkspaceOcrWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WorkspaceOcrWorkerService.name);
  private readonly queueName =
    process.env.BJC_OCR_QUEUE_NAME?.trim() || 'default';
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
    void this.recoverStaleJobs()
      .then(() => this.runOne())
      .catch(() => this.logger.warn('Workspace OCR recovery failed.'));
    if (!this.processor.config.enabled) return;
    this.timer = setInterval(() => void this.runOne(), POLL_INTERVAL_MS);
    this.timer.unref?.();
    this.recoveryTimer = setInterval(
      () => void this.recoverStaleJobs(),
      STALE_RECOVERY_INTERVAL_MS,
    );
    this.recoveryTimer.unref?.();
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
    const requeued = await this.prisma.workspaceOcrJob.updateMany({
      where: {
        queueName: this.queueName,
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
        errorDetail: 'A stale Workspace OCR lease was recovered.',
      },
    });
    const exhausted = await this.prisma.workspaceOcrJob.findMany({
      where: {
        queueName: this.queueName,
        status: 'RUNNING',
        leaseExpiresAt: stale,
        attemptCount: { gte: 2 },
      },
      select: { id: true },
    });
    let failed = 0;
    for (const job of exhausted) {
      const result = await this.prisma.workspaceOcrJob.updateMany({
        where: { id: job.id, status: 'RUNNING' },
        data: {
          status: 'FAILED',
          completedAt: now,
          leaseExpiresAt: null,
          errorCode: 'OCR_WORKER_RESTARTED',
          errorDetail: 'The Workspace OCR retry limit was reached.',
        },
      });
      failed += result.count;
      if (result.count === 1) await this.writeAudit(job.id, 'FAILED');
    }
    return { requeued: requeued.count, failed };
  }

  private async runOne(jobId?: string) {
    if (
      this.stopping ||
      this.working ||
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
          void this.prisma.workspaceOcrJob
            .updateMany({
              where: { id: job.id, status: 'RUNNING' },
              data: {
                leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
              },
            })
            .catch(() =>
              this.logger.warn('Workspace OCR lease heartbeat failed.'),
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
      this.logger.error(
        `Workspace OCR queue tick failed: ${safeErrorCode(error)}`,
      );
      return false;
    } finally {
      this.working = false;
    }
  }

  private async claimNext(
    jobId?: string,
  ): Promise<WorkspaceOcrJobWithSource | null> {
    const idFilter = jobId ? Prisma.sql`AND "id" = ${jobId}` : Prisma.empty;
    const claimed = await this.prisma.$queryRaw<JobClaim[]>(Prisma.sql`
      WITH next_job AS (
        SELECT "id" FROM "WorkspaceOcrJob"
         WHERE "status" = 'PENDING' AND "queueName" = ${this.queueName}
           AND "attemptCount" < "maxAttempts"
           ${idFilter}
         ORDER BY "createdAt" ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      UPDATE "WorkspaceOcrJob" AS job
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
    const id = claimed[0]?.id;
    if (!id) return null;
    return this.prisma.workspaceOcrJob.findUnique({
      where: { id },
      include: jobInclude,
    });
  }

  private async processJob(job: WorkspaceOcrJobWithSource) {
    const extraction = job.document.latestExtraction;
    if (
      !extraction ||
      extraction.id !== job.latestExtractionId ||
      extraction.fileId !== job.fileId ||
      job.document.latestExtractionId !== extraction.id
    ) {
      await this.cancelStaleJob(job.id, 'SOURCE_REPLACED');
      return;
    }
    const requestedPages = parsePageNumbers(job.pageNumbers);
    const queuedLanguages = job.languages.split('+').map((item) => item.trim());
    if (
      requestedPages.length === 0 ||
      this.processor.identity(job.dpi, queuedLanguages) !==
        job.processorVersion ||
      requestedPages.some(
        (pageNumber) =>
          !extraction.pages.some((page) => page.pageNumber === pageNumber),
      )
    )
      throw new LocalDocumentProcessingError('OCR_PROCESSOR_CHANGED');

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
      requestedPages,
      result.pages,
      result.provenance,
    );
  }

  private async persistResult(
    job: WorkspaceOcrJobWithSource,
    requestedPages: number[],
    pages: OcrPageResult[],
    provenance: Record<string, unknown>,
  ) {
    const pageByNumber = new Map(pages.map((page) => [page.pageNumber, page]));
    if (
      pageByNumber.size !== pages.length ||
      pages.length !== requestedPages.length ||
      requestedPages.some((pageNumber) => !pageByNumber.has(pageNumber))
    )
      throw new LocalDocumentProcessingError('FILE_INVALID');

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.corpusDocument.findFirst({
        where: {
          id: job.documentId,
          latestExtractionId: job.latestExtractionId,
          files: { some: { id: job.fileId, sha256: job.fileSha256 } },
          workspaceDocuments: {
            some: {
              workspaceId: job.workspaceId,
              ownerUserId: null,
            },
          },
        },
        select: { id: true },
      });
      if (!current) throw new LocalDocumentProcessingError('SOURCE_REPLACED');

      await tx.workspaceOcrPage.deleteMany({
        where: {
          workspaceId: job.workspaceId,
          documentId: job.documentId,
          fileId: job.fileId,
          fileSha256: job.fileSha256,
          extractionId: job.latestExtractionId,
        },
      });
      await tx.workspaceOcrPage.createMany({
        data: requestedPages.map((pageNumber) => {
          const page = pageByNumber.get(pageNumber)!;
          return {
            workspaceId: job.workspaceId,
            documentId: job.documentId,
            fileId: job.fileId,
            jobId: job.id,
            fileSha256: job.fileSha256,
            extractionId: job.latestExtractionId,
            pageNumber,
            text: page.text,
            confidence: page.confidence,
          };
        }),
      });
      const updated = await tx.workspaceOcrJob.updateMany({
        where: { id: job.id, status: 'RUNNING' },
        data: {
          status: 'COMPLETE',
          completedAt: new Date(),
          leaseExpiresAt: null,
          errorCode: null,
          errorDetail: null,
          provenance: {
            ...provenance,
            workspaceId: job.workspaceId,
            sourceFileSha256: job.fileSha256,
            latestExtractionId: job.latestExtractionId,
            requestedByUserId: job.requestedByUserId,
          },
        },
      });
      if (updated.count !== 1)
        throw new LocalDocumentProcessingError('SOURCE_REPLACED');
      await this.writeAuditInTransaction(tx, job, 'COMPLETE');
    });
  }

  private async cancelStaleJob(jobId: string, reason: string) {
    await this.prisma.workspaceOcrJob.updateMany({
      where: { id: jobId, status: 'RUNNING' },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
        leaseExpiresAt: null,
        errorCode: reason,
        errorDetail: 'The Workspace source changed while OCR was running.',
      },
    });
  }

  private async failOrRetry(job: WorkspaceOcrJobWithSource, error: unknown) {
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
    const updated = await this.prisma.workspaceOcrJob.updateMany({
      where: { id: job.id, status: 'RUNNING' },
      data: {
        status: retry ? 'PENDING' : 'FAILED',
        completedAt: retry ? null : new Date(),
        leaseExpiresAt: null,
        errorCode,
        errorDetail: safeDetail,
      },
    });
    if (!retry && updated.count === 1) await this.writeAudit(job.id, 'FAILED');
    if (!retry)
      this.logger.warn(`Workspace OCR job ${job.id} failed: ${errorCode}`);
  }

  private async writeAudit(jobId: string, outcome: 'COMPLETE' | 'FAILED') {
    const job = await this.prisma.workspaceOcrJob.findUnique({
      where: { id: jobId },
      include: jobInclude,
    });
    if (job)
      await this.prisma.$transaction((tx) =>
        this.writeAuditInTransaction(tx, job, outcome),
      );
  }

  private async writeAuditInTransaction(
    tx: Prisma.TransactionClient,
    job: WorkspaceOcrJobWithSource,
    outcome: 'COMPLETE' | 'FAILED',
  ) {
    const filename = safeFilename(job.file.originalFilename);
    const actorName = [job.requestedBy.nombre, job.requestedBy.apellido]
      .filter(Boolean)
      .join(' ');
    const dependencyName = job.workspace.dependency.name;
    await tx.accionLog.create({
      data: {
        usuarioId: job.requestedByUserId,
        entidad: 'WorkspaceDocument',
        entidadId: null,
        accion:
          outcome === 'COMPLETE'
            ? 'WORKSPACE_OCR_COMPLETE'
            : 'WORKSPACE_OCR_FAILED',
        descripcion:
          `${actorName} · ` +
          (outcome === 'COMPLETE'
            ? `OCR completado para “${filename}” en ${dependencyName}.`
            : `No se pudo completar el OCR de “${filename}” en ${dependencyName}.`),
        datosDespues: {
          workspaceId: job.workspaceId,
          documentId: job.documentId,
          jobId: job.id,
          fileSha256: job.fileSha256,
          status: outcome,
          scope: 'WORKSPACE_ONLY',
        },
      },
    });
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

function safeFilename(value: string) {
  return (
    Array.from(value, (character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
        ? ' '
        : character;
    })
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 180) || 'documento.pdf'
  );
}

function safeErrorCode(error: unknown) {
  if (error instanceof LocalDocumentProcessingError) return error.code;
  if (error instanceof Prisma.PrismaClientKnownRequestError)
    return `DATABASE_${error.code}`;
  return 'OCR_FAILED';
}

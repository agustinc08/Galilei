import { Prisma } from '../generated/prisma/client';
import type { CorpusOcrJob } from '../generated/prisma/client';
import { LocalPdfOcrProcessor } from './document-local-processors';
import { isRetryableWorkspaceOcrError } from './workspace-ocr-status';

const MAX_TOTAL_ATTEMPTS = 2;

export type EnqueuedLocalOcrJob = Pick<CorpusOcrJob, 'id' | 'status'> & {
  created: boolean;
  retried: boolean;
  errorCode?: string | null;
};

export async function enqueueLocalOcrJob(
  tx: Prisma.TransactionClient,
  processor: LocalPdfOcrProcessor,
  input: {
    documentId: string;
    fileId: string;
    fileSha256: string;
    pageNumbers: number[];
    workspaceAudit?: { workspaceId: string; requestedByUserId: number };
  },
  options: { retryFailed?: boolean } = {},
): Promise<EnqueuedLocalOcrJob | null> {
  const pageNumbers = [...new Set(input.pageNumbers)]
    .filter((page) => Number.isInteger(page) && page > 0)
    .sort((left, right) => left - right);
  if (
    !processor.config.enabled ||
    !processor.capabilities.ocrAvailable ||
    pageNumbers.length === 0
  )
    return null;

  const fingerprint = processor.fingerprint(input.fileSha256, pageNumbers);
  const existing = await tx.corpusOcrJob.findUnique({
    where: { fileId_fingerprint: { fileId: input.fileId, fingerprint } },
    select: { id: true, status: true, errorCode: true },
  });
  if (existing && !canRetryExisting(existing, options.retryFailed)) {
    return { ...existing, created: false, retried: false };
  }

  await tx.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_advisory_xact_lock(154, 1) IS NULL AS acquired
  `;
  const afterLock = await tx.corpusOcrJob.findUnique({
    where: { fileId_fingerprint: { fileId: input.fileId, fingerprint } },
    select: { id: true, status: true, errorCode: true },
  });
  if (afterLock) {
    if (!canRetryExisting(afterLock, options.retryFailed)) {
      return { ...afterLock, created: false, retried: false };
    }
    const queueName = process.env.BJC_OCR_QUEUE_NAME?.trim() || 'default';
    const pendingLimit = readPendingLimit();
    const activeCount = await tx.corpusOcrJob.count({
      where: { queueName, status: { in: ['PENDING', 'RUNNING'] } },
    });
    if (activeCount >= pendingLimit) return null;
    const retried = await tx.corpusOcrJob.updateMany({
      where: { id: afterLock.id, status: 'FAILED' },
      data: {
        status: 'PENDING',
        attemptCount: 0,
        maxAttempts: MAX_TOTAL_ATTEMPTS,
        startedAt: null,
        completedAt: null,
        leaseExpiresAt: null,
        errorCode: null,
        errorDetail: null,
        ...(input.workspaceAudit
          ? {
              provenance: {
                workspaceOcr: input.workspaceAudit,
              },
            }
          : {}),
      },
    });
    if (retried.count === 1) {
      return {
        id: afterLock.id,
        status: 'PENDING',
        created: false,
        retried: true,
      };
    }
    const current = await tx.corpusOcrJob.findUnique({
      where: { id: afterLock.id },
      select: { id: true, status: true, errorCode: true },
    });
    return current ? { ...current, created: false, retried: false } : null;
  }
  const queueName = process.env.BJC_OCR_QUEUE_NAME?.trim() || 'default';
  const pendingLimit = readPendingLimit();
  const activeCount = await tx.corpusOcrJob.count({
    where: { queueName, status: { in: ['PENDING', 'RUNNING'] } },
  });
  if (activeCount >= pendingLimit) return null;

  const created = await tx.corpusOcrJob.create({
    data: {
      queueName,
      documentId: input.documentId,
      fileId: input.fileId,
      fileSha256: input.fileSha256,
      fingerprint,
      processorVersion: processor.identity(),
      languages: processor.config.languages.join('+'),
      dpi: processor.config.dpi,
      pageNumbers: pageNumbers,
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: MAX_TOTAL_ATTEMPTS,
      timeoutMs: processor.config.timeoutMs,
      ...(input.workspaceAudit
        ? { provenance: { workspaceOcr: input.workspaceAudit } }
        : {}),
    },
    select: { id: true, status: true },
  });
  return { ...created, created: true, retried: false };
}

function canRetryExisting(
  job: { status: string; errorCode?: string | null },
  retryFailed: boolean | undefined,
) {
  return Boolean(
    retryFailed &&
    job.status === 'FAILED' &&
    isRetryableWorkspaceOcrError(job.errorCode),
  );
}

function readPendingLimit() {
  const value = Number.parseInt(process.env.OCR_MAX_PENDING_JOBS ?? '', 10);
  return Number.isInteger(value) ? Math.max(1, Math.min(100, value)) : 20;
}

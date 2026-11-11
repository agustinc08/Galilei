import { Prisma } from '../generated/prisma/client';
import type { WorkspaceOcrJob } from '../generated/prisma/client';
import { LocalPdfOcrProcessor } from './document-local-processors';
import { isRetryableWorkspaceOcrError } from './workspace-ocr-status';

const MAX_TOTAL_ATTEMPTS = 2;

export type EnqueuedWorkspaceOcrJob = Pick<WorkspaceOcrJob, 'id' | 'status'> & {
  created: boolean;
  retried: boolean;
  errorCode?: string | null;
};

export async function enqueueWorkspaceOcrJob(
  tx: Prisma.TransactionClient,
  processor: LocalPdfOcrProcessor,
  input: {
    workspaceId: string;
    documentId: string;
    fileId: string;
    fileSha256: string;
    latestExtractionId: string;
    requestedByUserId: number;
    pageNumbers: number[];
  },
): Promise<EnqueuedWorkspaceOcrJob | null> {
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
  const existing = await tx.workspaceOcrJob.findUnique({
    where: {
      workspaceId_fileId_fingerprint: {
        workspaceId: input.workspaceId,
        fileId: input.fileId,
        fingerprint,
      },
    },
    select: { id: true, status: true, errorCode: true },
  });
  if (existing && !canRetry(existing))
    return { ...existing, created: false, retried: false };

  // Serialize only job creation/retry. OCR itself remains concurrent across
  // Workspace documents and isolated by workspaceId in its idempotency key.
  await tx.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_advisory_xact_lock(154, 2) IS NULL AS acquired
  `;
  const afterLock = await tx.workspaceOcrJob.findUnique({
    where: {
      workspaceId_fileId_fingerprint: {
        workspaceId: input.workspaceId,
        fileId: input.fileId,
        fingerprint,
      },
    },
    select: { id: true, status: true, errorCode: true },
  });
  const queueName = process.env.BJC_OCR_QUEUE_NAME?.trim() || 'default';
  const activeCount = await tx.workspaceOcrJob.count({
    where: { queueName, status: { in: ['PENDING', 'RUNNING'] } },
  });
  if (activeCount >= readPendingLimit()) return null;

  if (afterLock) {
    if (!canRetry(afterLock))
      return { ...afterLock, created: false, retried: false };
    const retried = await tx.workspaceOcrJob.updateMany({
      where: { id: afterLock.id, status: { in: ['FAILED', 'CANCELLED'] } },
      data: {
        workspaceId: input.workspaceId,
        documentId: input.documentId,
        fileId: input.fileId,
        fileSha256: input.fileSha256,
        latestExtractionId: input.latestExtractionId,
        requestedByUserId: input.requestedByUserId,
        pageNumbers,
        processorVersion: processor.identity(),
        languages: processor.config.languages.join('+'),
        dpi: processor.config.dpi,
        timeoutMs: processor.config.timeoutMs,
        status: 'PENDING',
        attemptCount: 0,
        maxAttempts: MAX_TOTAL_ATTEMPTS,
        startedAt: null,
        completedAt: null,
        leaseExpiresAt: null,
        errorCode: null,
        errorDetail: null,
        provenance: Prisma.DbNull,
      },
    });
    if (retried.count === 1)
      return {
        id: afterLock.id,
        status: 'PENDING',
        created: false,
        retried: true,
      };
    const current = await tx.workspaceOcrJob.findUnique({
      where: { id: afterLock.id },
      select: { id: true, status: true, errorCode: true },
    });
    return current ? { ...current, created: false, retried: false } : null;
  }

  const created = await tx.workspaceOcrJob.create({
    data: {
      queueName,
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      fileId: input.fileId,
      fileSha256: input.fileSha256,
      latestExtractionId: input.latestExtractionId,
      requestedByUserId: input.requestedByUserId,
      fingerprint,
      processorVersion: processor.identity(),
      languages: processor.config.languages.join('+'),
      dpi: processor.config.dpi,
      pageNumbers,
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: MAX_TOTAL_ATTEMPTS,
      timeoutMs: processor.config.timeoutMs,
    },
    select: { id: true, status: true },
  });
  return { ...created, created: true, retried: false };
}

function canRetry(job: { status: string; errorCode?: string | null }) {
  return (
    (job.status === 'FAILED' && isRetryableWorkspaceOcrError(job.errorCode)) ||
    job.status === 'CANCELLED'
  );
}

function readPendingLimit() {
  const value = Number.parseInt(process.env.OCR_MAX_PENDING_JOBS ?? '', 10);
  return Number.isInteger(value) ? Math.max(1, Math.min(100, value)) : 20;
}

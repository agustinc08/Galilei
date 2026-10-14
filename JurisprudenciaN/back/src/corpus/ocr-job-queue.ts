import { Prisma } from '@prisma/client';
import type { CorpusOcrJob } from '@prisma/client';
import { LocalPdfOcrProcessor } from './document-local-processors';

const MAX_TOTAL_ATTEMPTS = 2;

export async function enqueueLocalOcrJob(
  tx: Prisma.TransactionClient,
  processor: LocalPdfOcrProcessor,
  input: {
    documentId: string;
    fileId: string;
    fileSha256: string;
    pageNumbers: number[];
  },
): Promise<Pick<CorpusOcrJob, 'id' | 'status'> | null> {
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
    select: { id: true, status: true },
  });
  if (existing) return existing;

  await tx.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_advisory_xact_lock(154, 1) IS NULL AS acquired
  `;
  const afterLock = await tx.corpusOcrJob.findUnique({
    where: { fileId_fingerprint: { fileId: input.fileId, fingerprint } },
    select: { id: true, status: true },
  });
  if (afterLock) return afterLock;
  const queueName = process.env.BJC_OCR_QUEUE_NAME?.trim() || 'default';
  const pendingLimit = readPendingLimit();
  const activeCount = await tx.corpusOcrJob.count({
    where: { queueName, status: { in: ['PENDING', 'RUNNING'] } },
  });
  if (activeCount >= pendingLimit) return null;

  return tx.corpusOcrJob.create({
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
    },
    select: { id: true, status: true },
  });
}

function readPendingLimit() {
  const value = Number.parseInt(process.env.OCR_MAX_PENDING_JOBS ?? '', 10);
  return Number.isInteger(value) ? Math.max(1, Math.min(100, value)) : 20;
}

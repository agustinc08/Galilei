import { CorpusOcrWorkerService } from './corpus-ocr-worker.service';
import type { LocalPdfOcrProcessor } from './document-local-processors';
import type { PrismaService } from '../prisma/prisma.service';

function partial(value: Record<string, unknown>) {
  return expect.objectContaining(value) as unknown as Record<string, unknown>;
}

describe('CorpusOcrWorkerService recovery policy', () => {
  it('requeues stale jobs once and permanently fails jobs at the retry limit', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const exhausted = jest.fn().mockResolvedValue([
      {
        id: 'job-exhausted',
        documentId: 'doc-1',
        fileId: 'file-1',
        document: {
          latestExtraction: { id: 'extraction-1', fileId: 'file-1' },
        },
      },
    ]);
    const failedUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const documentUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const ingestionUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      corpusOcrJob: { updateMany, findMany: exhausted },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback({
          corpusOcrJob: { updateMany: failedUpdate },
          corpusDocument: { updateMany: documentUpdate },
          corpusIngestionRecord: { updateMany: ingestionUpdate },
        }),
      ),
    } as unknown as PrismaService;
    const processor = {
      config: { enabled: true },
      capabilities: { ocrAvailable: true },
    } as unknown as LocalPdfOcrProcessor;
    const worker = new CorpusOcrWorkerService(prisma, processor);
    const now = new Date('2026-10-14T12:00:00.000Z');

    await expect(worker.recoverStaleJobs(now)).resolves.toEqual({
      requeued: 2,
      failed: 1,
    });
    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      partial({
        where: partial({
          status: 'RUNNING',
          attemptCount: { lt: 2 },
          leaseExpiresAt: { lt: now },
        }),
        data: partial({
          status: 'PENDING',
          errorCode: 'OCR_WORKER_RESTARTED',
        }),
      }),
    );
    expect(exhausted).toHaveBeenCalledWith(
      partial({
        where: partial({
          status: 'RUNNING',
          attemptCount: { gte: 2 },
          leaseExpiresAt: { lt: now },
        }),
      }),
    );
    expect(failedUpdate).toHaveBeenCalledWith(
      partial({
        where: partial({
          id: 'job-exhausted',
          status: 'RUNNING',
        }),
        data: partial({
          status: 'FAILED',
          errorCode: 'OCR_WORKER_RESTARTED',
        }),
      }),
    );
    expect(documentUpdate).toHaveBeenCalledWith(
      partial({
        where: partial({ latestExtractionId: 'extraction-1' }),
        data: { status: 'OCR_FAILED' },
      }),
    );
    expect(ingestionUpdate).toHaveBeenCalledWith(
      partial({
        data: partial({ status: 'OCR_FAILED' }),
      }),
    );
  });
});

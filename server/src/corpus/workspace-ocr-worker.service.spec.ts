import { WorkspaceOcrWorkerService } from './workspace-ocr-worker.service';
import type { LocalPdfOcrProcessor } from './document-local-processors';
import type { PrismaService } from '../prisma/prisma.service';

describe('WorkspaceOcrWorkerService recovery policy', () => {
  it('requeues a stale workspace job for one safe retry without touching corpus OCR state', async () => {
    type StaleJobUpdate = {
      where: {
        queueName: string;
        status: string;
        leaseExpiresAt: { lt: Date };
        attemptCount: { lt: number };
      };
      data: {
        status: string;
        startedAt: null;
        completedAt: null;
        leaseExpiresAt: null;
        errorCode: string;
        errorDetail: string;
      };
    };
    const updateMany = jest
      .fn<Promise<{ count: number }>, [StaleJobUpdate]>()
      .mockResolvedValue({ count: 1 });
    const findMany = jest
      .fn<Promise<{ id: string }[]>, [Record<string, unknown>]>()
      .mockResolvedValue([]);
    const prisma = {
      workspaceOcrJob: { updateMany, findMany },
    } as unknown as PrismaService;
    const processor = {
      config: { enabled: true },
      capabilities: { ocrAvailable: true },
    } as unknown as LocalPdfOcrProcessor;
    const worker = new WorkspaceOcrWorkerService(prisma, processor);
    const now = new Date('2026-11-11T12:00:00.000Z');

    await expect(worker.recoverStaleJobs(now)).resolves.toEqual({
      requeued: 1,
      failed: 0,
    });
    expect(updateMany.mock.calls[0]?.[0].where).toMatchObject({
      status: 'RUNNING',
      attemptCount: { lt: 2 },
      leaseExpiresAt: { lt: now },
    });
    expect(updateMany.mock.calls[0]?.[0].data).toMatchObject({
      status: 'PENDING',
      startedAt: null,
      completedAt: null,
      leaseExpiresAt: null,
      errorCode: 'OCR_WORKER_RESTARTED',
    });
    expect(prisma).not.toHaveProperty('corpusDocument');
    expect(prisma).not.toHaveProperty('corpusOcrJob');
  });
});

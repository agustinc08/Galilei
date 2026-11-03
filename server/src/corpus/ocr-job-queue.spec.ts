import { enqueueLocalOcrJob } from './ocr-job-queue';
import type { LocalPdfOcrProcessor } from './document-local-processors';
import type { Prisma } from '../generated/prisma/client';

function partial(value: Record<string, unknown>) {
  return expect.objectContaining(value) as unknown as Record<string, unknown>;
}

function processor(ocrAvailable = true, fingerprint = 'fingerprint-1') {
  return {
    config: {
      enabled: true,
      languages: ['spa'],
      dpi: 250,
      timeoutMs: 90_000,
    },
    capabilities: { ocrAvailable },
    identity: () => 'tesseract-test;poppler-test;spa;dpi=250',
    fingerprint: jest.fn(() => fingerprint),
  } as unknown as LocalPdfOcrProcessor;
}

function transaction(overrides: Record<string, unknown> = {}) {
  const findUnique = jest.fn().mockResolvedValue(null);
  const count = jest.fn().mockResolvedValue(0);
  const create = jest
    .fn()
    .mockResolvedValue({ id: 'job-1', status: 'PENDING' });
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const lock = jest.fn().mockResolvedValue([]);
  const tx = {
    corpusOcrJob: { findUnique, count, create, updateMany },
    $queryRaw: lock,
    ...overrides,
  };
  return {
    tx: tx as unknown as Prisma.TransactionClient,
    findUnique,
    count,
    create,
    updateMany,
    lock,
  };
}

describe('durable local OCR job enqueue', () => {
  const input = {
    documentId: 'doc-1',
    fileId: 'file-1',
    fileSha256: 'a'.repeat(64),
    pageNumbers: [4, 2, 2],
  };

  it('does not query the database when OCR is unavailable', async () => {
    const db = transaction();
    await expect(
      enqueueLocalOcrJob(db.tx, processor(false), input),
    ).resolves.toBeNull();
    expect(db.findUnique).not.toHaveBeenCalled();
    expect(db.create).not.toHaveBeenCalled();
  });

  it('reuses the same fingerprint before taking a lock', async () => {
    const db = transaction();
    db.findUnique.mockResolvedValueOnce({
      id: 'existing',
      status: 'COMPLETE',
      errorCode: null,
    });

    await expect(
      enqueueLocalOcrJob(db.tx, processor(), input),
    ).resolves.toEqual({
      id: 'existing',
      status: 'COMPLETE',
      errorCode: null,
      created: false,
      retried: false,
    });
    expect(db.lock).not.toHaveBeenCalled();
    expect(db.create).not.toHaveBeenCalled();
  });

  it('checks for a concurrent duplicate after the advisory lock', async () => {
    const db = transaction();
    db.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'concurrent',
      status: 'PENDING',
      errorCode: null,
    });

    await expect(
      enqueueLocalOcrJob(db.tx, processor(), input),
    ).resolves.toEqual({
      id: 'concurrent',
      status: 'PENDING',
      errorCode: null,
      created: false,
      retried: false,
    });
    expect(db.lock).toHaveBeenCalledTimes(1);
    expect(db.create).not.toHaveBeenCalled();
  });

  it('enqueues a new OCR job when the source file SHA changes', async () => {
    const db = transaction();
    const changedSha = 'b'.repeat(64);

    await expect(
      enqueueLocalOcrJob(db.tx, processor(true, 'fingerprint-changed'), {
        ...input,
        fileSha256: changedSha,
      }),
    ).resolves.toMatchObject({
      id: 'job-1',
      status: 'PENDING',
      created: true,
      retried: false,
    });
    expect(db.create).toHaveBeenCalledWith(
      partial({
        data: partial({
          fileSha256: changedSha,
          fingerprint: 'fingerprint-changed',
        }),
      }),
    );
  });

  it('applies backpressure and creates one normalized job when capacity is available', async () => {
    const full = transaction();
    full.count.mockResolvedValueOnce(20);
    await expect(
      enqueueLocalOcrJob(full.tx, processor(), input),
    ).resolves.toBeNull();
    expect(full.create).not.toHaveBeenCalled();

    const available = transaction();
    await expect(
      enqueueLocalOcrJob(available.tx, processor(), input),
    ).resolves.toMatchObject({
      id: 'job-1',
      status: 'PENDING',
      created: true,
      retried: false,
    });
    expect(available.create).toHaveBeenCalledWith(
      partial({
        data: partial({
          pageNumbers: [2, 4],
          attemptCount: 0,
          maxAttempts: 2,
          status: 'PENDING',
        }),
      }),
    );
  });

  it('retries a recoverable failed job in place instead of creating a duplicate', async () => {
    const db = transaction();
    db.findUnique
      .mockResolvedValueOnce({
        id: 'failed-job',
        status: 'FAILED',
        errorCode: 'OCR_TIMEOUT',
      })
      .mockResolvedValueOnce({
        id: 'failed-job',
        status: 'FAILED',
        errorCode: 'OCR_TIMEOUT',
      });

    await expect(
      enqueueLocalOcrJob(db.tx, processor(), input, { retryFailed: true }),
    ).resolves.toEqual({
      id: 'failed-job',
      status: 'PENDING',
      created: false,
      retried: true,
    });
    expect(db.updateMany).toHaveBeenCalledWith(
      partial({
        where: { id: 'failed-job', status: 'FAILED' },
        data: partial({ status: 'PENDING', attemptCount: 0, maxAttempts: 2 }),
      }),
    );
    expect(db.create).not.toHaveBeenCalled();
  });

  it('does not retry non-recoverable OCR failures', async () => {
    const db = transaction();
    db.findUnique.mockResolvedValueOnce({
      id: 'invalid-job',
      status: 'FAILED',
      errorCode: 'FILE_INVALID',
    });

    await expect(
      enqueueLocalOcrJob(db.tx, processor(), input, { retryFailed: true }),
    ).resolves.toEqual({
      id: 'invalid-job',
      status: 'FAILED',
      errorCode: 'FILE_INVALID',
      created: false,
      retried: false,
    });
    expect(db.lock).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
  });
});

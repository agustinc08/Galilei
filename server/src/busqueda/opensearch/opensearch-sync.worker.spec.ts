import type {
  OpenSearchDocumentRepository,
  SearchOutboxEvent,
} from './opensearch-document.repository';
import type { OpenSearchIndexService } from './opensearch-index.service';
import { OpenSearchSyncWorker } from './opensearch-sync.worker';

function event(id: string, documentKey: string): SearchOutboxEvent {
  return { id, documentKey, operation: 'UPSERT', attempts: 1 };
}

function workerWith(events: SearchOutboxEvent[], indexKey: jest.Mock) {
  const markOutboxProcessedMany = jest.fn().mockResolvedValue(undefined);
  const repository = {
    withAdvisoryLock: jest.fn(
      async (_required: boolean, action: () => Promise<unknown>) => ({
        acquired: true,
        value: await action(),
      }),
    ),
    claimOutboxByDocumentKey: jest.fn().mockResolvedValue(events),
    markOutboxProcessedMany,
    markOutboxFailed: jest.fn().mockResolvedValue(undefined),
  } as unknown as OpenSearchDocumentRepository;
  const index = {
    hasActiveIndex: jest.fn().mockResolvedValue(true),
    indexKey,
  } as unknown as OpenSearchIndexService;
  return {
    worker: new OpenSearchSyncWorker(repository, index),
    repository,
    markOutboxProcessedMany,
  };
}

describe('OpenSearchSyncWorker', () => {
  it('indexes each current document key once and acknowledges all its notifications', async () => {
    const indexKey = jest.fn().mockResolvedValue(undefined);
    const { worker, markOutboxProcessedMany } = workerWith(
      [
        event('1', 'SENTENCIA:10'),
        event('2', 'SENTENCIA:10'),
        event('3', 'SUMARIO:20'),
      ],
      indexKey,
    );

    await worker.tick();

    expect(indexKey).toHaveBeenCalledTimes(2);
    expect(indexKey).toHaveBeenCalledWith('SENTENCIA:10');
    expect(indexKey).toHaveBeenCalledWith('SUMARIO:20');
    expect(markOutboxProcessedMany).toHaveBeenCalledTimes(2);
    expect(markOutboxProcessedMany).toHaveBeenCalledWith(['1', '2']);
    expect(markOutboxProcessedMany).toHaveBeenCalledWith(['3']);
  });

  it('limits parallel indexing to the configured concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const indexKey = jest.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
    });
    const { worker } = workerWith(
      Array.from({ length: 12 }, (_, index) =>
        event(String(index + 1), `SENTENCIA:${index + 1}`),
      ),
      indexKey,
    );

    await worker.tick();

    expect(maxActive).toBe(4);
    expect(indexKey).toHaveBeenCalledTimes(12);
  });
});

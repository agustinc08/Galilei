import type { Client } from '@opensearch-project/opensearch';
import { OpenSearchDocumentRepository } from './opensearch-document.repository';
import { OpenSearchIndexService } from './opensearch-index.service';

describe('OpenSearchIndexService managed aliases', () => {
  it('recognizes a physical index under the isolated preproduction prefix', async () => {
    const getAlias = jest.fn().mockResolvedValue({
      body: {
        'galilei-preprod-search-v003-20261018t123456789z-ab12cd34': {},
      },
    });
    const client = {
      indices: {
        getAlias,
      },
    } as unknown as Client;
    const repository = {} as OpenSearchDocumentRepository;
    const service = new OpenSearchIndexService(
      client,
      repository,
      'galilei-preprod-search-active',
      'galilei-preprod-search',
    );

    await expect(service.hasActiveIndex()).resolves.toBe(true);
    expect(getAlias).toHaveBeenCalledWith({
      name: 'galilei-preprod-search-active',
    });
  });

  it('keeps recognizing the existing DEV index naming contract', async () => {
    const client = {
      indices: {
        getAlias: jest.fn().mockResolvedValue({
          body: { 'galilei-search-v003-20261018t123456789z-ab12cd34': {} },
        }),
      },
    } as unknown as Client;
    const service = new OpenSearchIndexService(
      client,
      {} as OpenSearchDocumentRepository,
      'galilei-search-active',
    );

    await expect(service.hasActiveIndex()).resolves.toBe(true);
  });

  it('writes V4 documents to the trusted physical target while the active alias stays on V3', async () => {
    const target = 'galilei-search-v004-20261020t094732495z-6015e394';
    const index = jest.fn().mockResolvedValue({ body: { result: 'created' } });
    const client = {
      indices: { exists: jest.fn().mockResolvedValue({ body: true }) },
      index,
    } as unknown as Client;
    const service = new OpenSearchIndexService(
      client,
      {} as OpenSearchDocumentRepository,
      'galilei-search-active',
      'galilei-search',
      4,
      false,
      target,
      true,
    );
    (service as unknown as { resolveKey: jest.Mock }).resolveKey = jest
      .fn()
      .mockResolvedValue({
        id: 'CORPUS:fixture',
        indexSchemaVersion: 4,
        sortFields: { numeroSentencia: null, numeroSentenciaCollation: '' },
      });

    await service.indexKey('CORPUS:fixture');

    const [written] = index.mock.calls[0] as unknown as [
      {
        index: string;
        id: string;
        body: {
          indexSchemaVersion: number;
          sortFields: { numeroSentenciaCollation: string };
        };
      },
    ];
    expect(written).toMatchObject({
      index: target,
      id: 'CORPUS:fixture',
      body: {
        indexSchemaVersion: 4,
        sortFields: { numeroSentenciaCollation: '' },
      },
    });
  });

  it('deletes idempotently from the explicit V4 physical target', async () => {
    const target = 'galilei-search-v004-20261020t094732495z-6015e394';
    const remove = jest.fn().mockRejectedValue({ statusCode: 404 });
    const client = {
      indices: { exists: jest.fn().mockResolvedValue({ body: true }) },
      delete: remove,
    } as unknown as Client;
    const service = new OpenSearchIndexService(
      client,
      {} as OpenSearchDocumentRepository,
      'galilei-search-active',
      'galilei-search',
      4,
      false,
      target,
      true,
    );
    (service as unknown as { resolveKey: jest.Mock }).resolveKey = jest
      .fn()
      .mockResolvedValue(null);

    await expect(service.indexKey('CORPUS:gone')).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith({
      index: target,
      id: 'gone',
      refresh: false,
    });
  });

  it('replays through a numeric high-water and invokes the cutover hook before releasing its barrier', async () => {
    const target = 'galilei-search-v004-20261020t094732495z-6015e394';
    const order: string[] = [];
    const repository = {
      withMutationBarrier: jest.fn(
        async (run: (client: never, watermark: string) => Promise<unknown>) => {
          order.push('LOCKED');
          const result = await run({} as never, '218842');
          order.push('RELEASED');
          return result;
        },
      ),
      outboxChangesPage: jest.fn().mockResolvedValue([]),
      outboxSnapshotThrough: jest
        .fn()
        .mockResolvedValue({ pending: 0, failed: 0 }),
    } as unknown as OpenSearchDocumentRepository;
    const client = {
      indices: {
        exists: jest.fn().mockResolvedValue({ body: true }),
        getMapping: jest.fn().mockResolvedValue({
          body: {
            [target]: {
              mappings: { _meta: { galileiSearchSchemaVersion: 4 } },
            },
          },
        }),
        refresh: jest.fn().mockResolvedValue({ body: { _shards: {} } }),
      },
    } as unknown as Client;
    const service = new OpenSearchIndexService(
      client,
      repository,
      'galilei-search-active',
      'galilei-search',
      4,
      false,
      target,
      true,
    );
    jest.spyOn(service, 'verifyPhysical').mockResolvedValue({
      exactIdEquality: true,
      expectedIds: 69313,
      indexedIds: 69313,
      missing: [],
      extra: [],
      duplicates: 0,
    } as never);

    const result = await service.replayShadowChanges(target, '218840', {
      requireOutboxClear: true,
      beforeBarrierRelease: (checkpoint) => {
        expect(checkpoint.highWatermark).toBe('218842');
        expect(order).toEqual(['LOCKED']);
        order.push('ALIAS_READY_HOOK');
        return Promise.resolve();
      },
    });

    expect(result).toMatchObject({
      target,
      schemaVersion: 4,
      afterWatermark: '218840',
      highWatermark: '218842',
      changedKeys: 0,
      pendingThrough: 0,
      failedThrough: 0,
      verification: {
        expectedIds: 69313,
        indexedIds: 69313,
        missing: 0,
        extra: 0,
      },
    });
    expect(order).toEqual(['LOCKED', 'ALIAS_READY_HOOK', 'RELEASED']);
  });

  it('pages changed document keys through the captured high-water without accumulating the outbox', async () => {
    const target = 'galilei-search-v004-20261020t094732495z-6015e394';
    const pages = [['CORPUS:fixture-a', 'CORPUS:fixture-b'], []];
    const outboxChangesPage = jest
      .fn()
      .mockImplementation(() => Promise.resolve(pages.shift()));
    const repository = {
      withMutationBarrier: jest.fn(
        async (run: (client: never, watermark: string) => Promise<unknown>) =>
          run({} as never, '218844'),
      ),
      outboxChangesPage,
      outboxSnapshotThrough: jest
        .fn()
        .mockResolvedValue({ pending: 0, failed: 0 }),
    } as unknown as OpenSearchDocumentRepository;
    const service = new OpenSearchIndexService(
      {
        indices: {
          exists: jest.fn().mockResolvedValue({ body: true }),
          getMapping: jest.fn().mockResolvedValue({
            body: {
              [target]: {
                mappings: { _meta: { galileiSearchSchemaVersion: 4 } },
              },
            },
          }),
          refresh: jest.fn().mockResolvedValue({}),
        },
      } as unknown as Client,
      repository,
      'galilei-search-active',
      'galilei-search',
      4,
      false,
      target,
      true,
    );
    (service as unknown as { resolveKey: jest.Mock }).resolveKey = jest
      .fn()
      .mockResolvedValue(null);
    const applyResolutions = jest.fn().mockResolvedValue(undefined);
    (service as unknown as { applyResolutions: jest.Mock }).applyResolutions =
      applyResolutions;
    jest.spyOn(service, 'verifyPhysical').mockResolvedValue({
      exactIdEquality: true,
      expectedIds: 69313,
      indexedIds: 69313,
      missing: [],
      extra: [],
      duplicates: 0,
    } as never);

    const checkpoint = await service.replayShadowChanges(target, '218840');

    expect(checkpoint.changedKeys).toBe(2);
    expect(outboxChangesPage).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      '218840',
      '218844',
      '',
      250,
    );
    expect(outboxChangesPage).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      '218840',
      '218844',
      'CORPUS:fixture-b',
      250,
    );
    expect(applyResolutions).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed or regressing high-water values before an index write', async () => {
    const target = 'galilei-search-v004-20261020t094732495z-6015e394';
    const repository = {
      withMutationBarrier: jest.fn(
        async (run: (client: never, watermark: string) => Promise<unknown>) =>
          run({} as never, '7'),
      ),
    } as unknown as OpenSearchDocumentRepository;
    const client = {
      indices: {
        exists: jest.fn().mockResolvedValue({ body: true }),
        getMapping: jest.fn().mockResolvedValue({
          body: {
            [target]: {
              mappings: { _meta: { galileiSearchSchemaVersion: 4 } },
            },
          },
        }),
      },
    } as unknown as Client;
    const service = new OpenSearchIndexService(
      client,
      repository,
      'galilei-search-active',
      'galilei-search',
      4,
      false,
      target,
      true,
    );
    await expect(service.replayShadowChanges(target, '-1')).rejects.toThrow(
      'SEARCH_OUTBOX_WATERMARK_INVALID',
    );
    await expect(service.replayShadowChanges(target, '8')).rejects.toThrow(
      'SEARCH_OUTBOX_WATERMARK_REGRESSION',
    );
  });
});

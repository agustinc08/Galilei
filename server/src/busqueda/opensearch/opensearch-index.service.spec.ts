import type { Client } from '@opensearch-project/opensearch';
import { OpenSearchDocumentRepository } from './opensearch-document.repository';
import { OpenSearchIndexService } from './opensearch-index.service';
import {
  SEARCH_INDEX_DEFINITION_V4,
  SEARCH_V4_COLLATION_PIPELINE,
  SEARCH_V4_COLLATION_PIPELINE_ID,
} from './opensearch-mapping';

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

  it('routes the explicitly configured fresh-v4 application writer through the alias', async () => {
    const alias = 'galilei-search-active';
    const target = 'galilei-search-v004-20261020t094732495z-6015e394';
    const write = jest.fn().mockResolvedValue({ body: { result: 'created' } });
    const client = {
      indices: {
        getAlias: jest.fn().mockResolvedValue({ body: { [target]: {} } }),
      },
      index: write,
    } as unknown as Client;
    const service = new OpenSearchIndexService(
      client,
      {} as OpenSearchDocumentRepository,
      alias,
      'galilei-search',
      4,
      false,
      alias,
      false,
      true,
    );
    (service as unknown as { resolveKey: jest.Mock }).resolveKey = jest
      .fn()
      .mockResolvedValue({ id: 'CORPUS:fixture', indexSchemaVersion: 4 });

    await service.indexKey('CORPUS:fixture');
    expect(write).toHaveBeenCalledWith({
      index: alias,
      id: 'CORPUS:fixture',
      body: { id: 'CORPUS:fixture', indexSchemaVersion: 4 },
      refresh: false,
    });
  });

  it('keeps schema-4 alias writes disabled when fresh-v4 topology was not configured', async () => {
    const service = new OpenSearchIndexService(
      {} as Client,
      {} as OpenSearchDocumentRepository,
      'galilei-search-active',
      'galilei-search',
      4,
    );
    await expect(service.indexKey('CORPUS:fixture')).rejects.toThrow(
      'OPENSEARCH_V4_WRITER_INDEX_DOCUMENT_REQUIRES_OPERATOR_MODE',
    );
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
              mappings: SEARCH_INDEX_DEFINITION_V4.mappings,
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
                mappings: SEARCH_INDEX_DEFINITION_V4.mappings,
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
              mappings: SEARCH_INDEX_DEFINITION_V4.mappings,
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

describe('OpenSearchIndexService fresh V4 operator lifecycle', () => {
  const alias = 'galilei-search-active';
  const target = 'galilei-search-v004-20261021t123456789z-ab12cd34';

  function simulateOpenSearchMappingResponse(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(simulateOpenSearchMappingResponse);
    }
    if (value === null || typeof value !== 'object') {
      return value;
    }
    const mapping = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        simulateOpenSearchMappingResponse(child),
      ]),
    ) as Record<string, unknown>;
    const type = mapping.type;
    if (type === 'object' && mapping.properties !== undefined) {
      delete mapping.type;
    }
    if (type === 'text') {
      if (mapping.index_options === 'positions') {
        delete mapping.index_options;
      }
      if (mapping.search_analyzer === mapping.analyzer) {
        delete mapping.search_analyzer;
      }
    }
    if (
      type === 'date' &&
      mapping.format === 'strict_date_optional_time||epoch_millis'
    ) {
      delete mapping.format;
    }
    if (type === 'icu_collation_keyword') {
      if (mapping.case_level === false) {
        delete mapping.case_level;
      }
      if (mapping.numeric === false) {
        delete mapping.numeric;
      }
      if (mapping.doc_values === true) {
        delete mapping.doc_values;
      }
    }
    if (
      (type === 'keyword' || type === 'date') &&
      mapping.doc_values === true
    ) {
      delete mapping.doc_values;
    }
    if (type === 'wildcard' && mapping.doc_values === false) {
      delete mapping.doc_values;
    }
    return mapping;
  }

  function makeService(client: unknown, repository: unknown) {
    return new OpenSearchIndexService(
      client as Client,
      repository as OpenSearchDocumentRepository,
      alias,
      'galilei-search',
      4,
      false,
      target,
      true,
    );
  }

  function canonicalPipelineSettings() {
    return jest.fn().mockResolvedValue({
      body: {
        [target]: {
          settings: { 'index.final_pipeline': SEARCH_V4_COLLATION_PIPELINE_ID },
        },
      },
    });
  }

  function canonicalPipelineRequest() {
    return jest.fn().mockResolvedValue({
      body: {
        [SEARCH_V4_COLLATION_PIPELINE_ID]: SEARCH_V4_COLLATION_PIPELINE,
      },
    });
  }

  it('creates a schema-4 index from the canonical V4 definition without requiring V3', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ body: { acknowledged: true } });
    const pipelineRequests = jest
      .fn()
      .mockRejectedValueOnce({ statusCode: 404 })
      .mockResolvedValueOnce({ body: { acknowledged: true } })
      .mockResolvedValueOnce({
        body: {
          [SEARCH_V4_COLLATION_PIPELINE_ID]: SEARCH_V4_COLLATION_PIPELINE,
        },
      });
    const client = {
      indices: {
        getAlias: jest.fn().mockResolvedValue({ body: {} }),
        exists: jest.fn().mockResolvedValue({ body: false }),
        create,
      },
      transport: { request: pipelineRequests },
    };
    const service = makeService(client, {});

    await expect(service.createFreshV4Index(target)).resolves.toMatchObject({
      target,
      schemaVersion: 4,
      state: 'INDEX_CREATED',
    });
    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0][0] as {
      index: string;
      body: Record<string, unknown>;
    };
    const expected = JSON.parse(JSON.stringify(SEARCH_INDEX_DEFINITION_V4)) as {
      settings: Record<string, unknown>;
    };
    expected.settings.refresh_interval = '-1';
    expect(request).toEqual({ index: target, body: expected });
    expect(pipelineRequests.mock.calls.map(([request]) => request)).toEqual([
      {
        method: 'GET',
        path: `/_ingest/pipeline/${SEARCH_V4_COLLATION_PIPELINE_ID}`,
      },
      {
        method: 'PUT',
        path: `/_ingest/pipeline/${SEARCH_V4_COLLATION_PIPELINE_ID}`,
        body: SEARCH_V4_COLLATION_PIPELINE,
      },
      {
        method: 'GET',
        path: `/_ingest/pipeline/${SEARCH_V4_COLLATION_PIPELINE_ID}`,
      },
    ]);
  });

  it('rejects an existing noncanonical collation pipeline instead of overwriting it', async () => {
    const create = jest.fn();
    const service = makeService(
      {
        indices: {
          getAlias: jest.fn().mockResolvedValue({ body: {} }),
          exists: jest.fn().mockResolvedValue({ body: false }),
          create,
        },
        transport: {
          request: jest.fn().mockResolvedValue({
            body: {
              [SEARCH_V4_COLLATION_PIPELINE_ID]: {
                description: 'unexpected',
                processors: [],
              },
            },
          }),
        },
      },
      {},
    );
    await expect(service.createFreshV4Index(target)).rejects.toThrow(
      'SEARCH_FRESH_V4_COLLATION_PIPELINE_MISMATCH',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a preexisting alias and does not create an index', async () => {
    const create = jest.fn();
    const service = makeService(
      {
        indices: {
          getAlias: jest.fn().mockResolvedValue({ body: { unexpected: {} } }),
          exists: jest.fn().mockResolvedValue({ body: false }),
          create,
        },
      },
      {},
    );
    await expect(service.createFreshV4Index(target)).rejects.toThrow(
      'SEARCH_FRESH_V4_ALIAS_MUST_BE_ABSENT',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('validates an interrupted target in place without deleting or recreating it', async () => {
    const remove = jest.fn();
    const create = jest.fn();
    const client = {
      indices: {
        getAlias: jest.fn().mockResolvedValue({ body: {} }),
        exists: jest.fn().mockResolvedValue({ body: true }),
        getMapping: jest.fn().mockResolvedValue({
          body: {
            [target]: {
              mappings: SEARCH_INDEX_DEFINITION_V4.mappings,
            },
          },
        }),
        getSettings: canonicalPipelineSettings(),
        delete: remove,
        create,
      },
      transport: { request: canonicalPipelineRequest() },
    };
    const service = makeService(client, {});

    await expect(
      service.assertFreshV4ResumeTarget(target),
    ).resolves.toMatchObject({
      target,
      schemaVersion: 4,
      state: 'INDEX_CREATED',
    });
    expect(remove).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts OpenSearch-omitted canonical mapping defaults on resume', async () => {
    const actualMapping = simulateOpenSearchMappingResponse(
      SEARCH_INDEX_DEFINITION_V4.mappings,
    );
    const service = makeService(
      {
        indices: {
          getAlias: jest.fn().mockResolvedValue({ body: {} }),
          exists: jest.fn().mockResolvedValue({ body: true }),
          getMapping: jest.fn().mockResolvedValue({
            body: { [target]: { mappings: actualMapping } },
          }),
          getSettings: canonicalPipelineSettings(),
        },
        transport: { request: canonicalPipelineRequest() },
      },
      {},
    );

    await expect(
      service.assertFreshV4ResumeTarget(target),
    ).resolves.toMatchObject({
      target,
      schemaVersion: 4,
      state: 'INDEX_CREATED',
    });
  });

  it('still rejects a real V4 collation mapping divergence on resume', async () => {
    const actualMapping = simulateOpenSearchMappingResponse(
      SEARCH_INDEX_DEFINITION_V4.mappings,
    ) as {
      properties: {
        sortFields: {
          properties: { numeroSentenciaCollation: Record<string, unknown> };
        };
      };
    };
    actualMapping.properties.sortFields.properties.numeroSentenciaCollation.strength =
      'primary';
    const service = makeService(
      {
        indices: {
          getAlias: jest.fn().mockResolvedValue({ body: {} }),
          exists: jest.fn().mockResolvedValue({ body: true }),
          getMapping: jest.fn().mockResolvedValue({
            body: { [target]: { mappings: actualMapping } },
          }),
        },
      },
      {},
    );

    await expect(service.assertFreshV4ResumeTarget(target)).rejects.toThrow(
      'SEARCH_FRESH_V4_CANONICAL_MAPPING_MISMATCH',
    );
  });

  it('rejects a resumed target with a missing or divergent final pipeline setting', async () => {
    const service = makeService(
      {
        indices: {
          getAlias: jest.fn().mockResolvedValue({ body: {} }),
          exists: jest.fn().mockResolvedValue({ body: true }),
          getMapping: jest.fn().mockResolvedValue({
            body: {
              [target]: { mappings: SEARCH_INDEX_DEFINITION_V4.mappings },
            },
          }),
          getSettings: jest.fn().mockResolvedValue({
            body: {
              [target]: { settings: { 'index.final_pipeline': 'wrong' } },
            },
          }),
        },
        transport: { request: canonicalPipelineRequest() },
      },
      {},
    );

    await expect(service.assertFreshV4ResumeTarget(target)).rejects.toThrow(
      'SEARCH_FRESH_V4_COLLATION_PIPELINE_SETTING_MISMATCH',
    );
  });

  it('projects in bounded source pages and checks the V4 document count without a V3 read', async () => {
    const repository = {
      withReadSnapshot: jest.fn(async (run: (pg: never) => Promise<unknown>) =>
        run({} as never),
      ),
      corpusPage: jest.fn().mockResolvedValue([]),
      jurisprudenciaPage: jest.fn().mockResolvedValue([]),
      sentenciaPage: jest.fn().mockResolvedValue([]),
    };
    const service = makeService(
      {
        indices: {
          exists: jest.fn().mockResolvedValue({ body: true }),
          getMapping: jest.fn().mockResolvedValue({
            body: {
              [target]: {
                mappings: SEARCH_INDEX_DEFINITION_V4.mappings,
              },
            },
          }),
          putSettings: jest.fn().mockResolvedValue({ body: {} }),
          refresh: jest.fn().mockResolvedValue({ body: {} }),
        },
        count: jest.fn().mockResolvedValue({ body: { count: 0 } }),
      },
      repository,
    );

    await expect(service.projectFreshV4(target)).resolves.toMatchObject({
      target,
      corpus: 0,
      jurisprudencia: 0,
      sentencias: 0,
      total: 0,
      countCheck: { expectedIds: 0, indexedIds: 0, pass: true },
      state: 'PROJECTED',
    });
    expect(repository.corpusPage).toHaveBeenCalledTimes(1);
    expect(repository.jurisprudenciaPage).toHaveBeenCalledTimes(1);
    expect(repository.sentenciaPage).toHaveBeenCalledTimes(1);
    expect(repository.corpusPage).toHaveBeenCalledWith(
      expect.anything(),
      '',
      10,
    );
    expect(repository.jurisprudenciaPage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      10,
    );
    expect(repository.sentenciaPage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      10,
    );
  });

  it('resumes from the persisted source cursor and preserves prior projection counts', async () => {
    const repository = {
      withReadSnapshot: jest.fn(async (run: (pg: never) => Promise<unknown>) =>
        run({} as never),
      ),
      corpusPage: jest.fn(),
      jurisprudenciaPage: jest.fn(),
      sentenciaPage: jest.fn().mockResolvedValue([]),
    };
    const service = makeService(
      {
        indices: {
          exists: jest.fn().mockResolvedValue({ body: true }),
          getMapping: jest.fn().mockResolvedValue({
            body: {
              [target]: {
                mappings: SEARCH_INDEX_DEFINITION_V4.mappings,
              },
            },
          }),
          putSettings: jest.fn().mockResolvedValue({ body: {} }),
          refresh: jest.fn().mockResolvedValue({ body: {} }),
        },
        count: jest.fn().mockResolvedValue({ body: { count: 6 } }),
      },
      repository,
    );
    const onProgress = jest.fn();

    await expect(
      service.projectFreshV4(target, {
        cursor: { source: 'sentencias', after: 123 },
        counts: { corpus: 1, jurisprudencia: 2, sentencias: 3, total: 6 },
        onProgress,
      }),
    ).resolves.toMatchObject({
      corpus: 1,
      jurisprudencia: 2,
      sentencias: 3,
      total: 6,
      state: 'PROJECTED',
    });
    expect(repository.corpusPage).not.toHaveBeenCalled();
    expect(repository.jurisprudenciaPage).not.toHaveBeenCalled();
    expect(repository.sentenciaPage).toHaveBeenCalledWith(
      expect.anything(),
      123,
      10,
    );
    expect(onProgress).toHaveBeenCalledWith({
      cursor: { source: 'complete' },
      counts: { corpus: 1, jurisprudencia: 2, sentencias: 3, total: 6 },
    });
  });

  it('certifies exact ID parity from a full source comparison and the indexed count', async () => {
    const repository = {
      withReadSnapshot: jest.fn(async (run: (pg: never) => Promise<unknown>) =>
        run({} as never),
      ),
      corpusPage: jest.fn().mockResolvedValue([]),
      jurisprudenciaPage: jest.fn().mockResolvedValue([]),
      sentenciaPage: jest.fn().mockResolvedValue([]),
    };
    const count = jest.fn().mockResolvedValue({ body: { count: 0 } });
    const service = makeService(
      {
        indices: {
          exists: jest.fn().mockResolvedValue({ body: true }),
          getMapping: jest.fn().mockResolvedValue({
            body: {
              [target]: { mappings: SEARCH_INDEX_DEFINITION_V4.mappings },
            },
          }),
        },
        count,
      },
      repository,
    );

    await expect(
      service.verifyFreshV4SourceParity(target, 10),
    ).resolves.toMatchObject({
      target,
      expectedIds: 0,
      indexedIds: 0,
      missing: 0,
      extra: 0,
      exactIdEquality: true,
      pass: true,
    });
    expect(count).toHaveBeenCalledWith({
      index: target,
      body: { query: { match_all: {} } },
    });
  });

  it('rejects exact ID parity when the fresh index contains extra IDs', async () => {
    const repository = {
      withReadSnapshot: jest.fn(async (run: (pg: never) => Promise<unknown>) =>
        run({} as never),
      ),
      corpusPage: jest.fn().mockResolvedValue([]),
      jurisprudenciaPage: jest.fn().mockResolvedValue([]),
      sentenciaPage: jest.fn().mockResolvedValue([]),
    };
    const service = makeService(
      {
        indices: {
          exists: jest.fn().mockResolvedValue({ body: true }),
          getMapping: jest.fn().mockResolvedValue({
            body: {
              [target]: { mappings: SEARCH_INDEX_DEFINITION_V4.mappings },
            },
          }),
        },
        count: jest.fn().mockResolvedValue({ body: { count: 1 } }),
      },
      repository,
    );

    await expect(
      service.verifyFreshV4SourceParity(target, 10),
    ).resolves.toMatchObject({
      expectedIds: 0,
      indexedIds: 1,
      missing: 0,
      extra: 1,
      exactIdEquality: false,
      pass: false,
    });
  });

  it('resumes source parity from the saved source cursor and counters', async () => {
    const repository = {
      withReadSnapshot: jest.fn(async (run: (pg: never) => Promise<unknown>) =>
        run({} as never),
      ),
      corpusPage: jest.fn(),
      jurisprudenciaPage: jest.fn(),
      sentenciaPage: jest.fn().mockResolvedValue([]),
    };
    const onProgress = jest.fn();
    const service = makeService(
      {
        indices: {
          exists: jest.fn().mockResolvedValue({ body: true }),
          getMapping: jest.fn().mockResolvedValue({
            body: {
              [target]: { mappings: SEARCH_INDEX_DEFINITION_V4.mappings },
            },
          }),
        },
        count: jest.fn().mockResolvedValue({ body: { count: 10 } }),
      },
      repository,
    );

    await expect(
      service.verifyFreshV4SourceParity(target, 100, {
        cursor: { source: 'sentencias', after: 2 },
        progress: {
          corpusCompared: 5,
          sumariosCompared: 3,
          sentenciasCompared: 2,
          missing: 0,
          sourceDifferences: 0,
          samples: [],
        },
        onProgress,
      }),
    ).resolves.toMatchObject({
      corpusCompared: 5,
      sumariosCompared: 3,
      sentenciasCompared: 2,
      expectedIds: 10,
      indexedIds: 10,
      exactIdEquality: true,
      pass: true,
    });
    expect(repository.corpusPage).not.toHaveBeenCalled();
    expect(repository.jurisprudenciaPage).not.toHaveBeenCalled();
    expect(repository.sentenciaPage).toHaveBeenCalledWith(
      expect.anything(),
      2,
      100,
    );
    expect(onProgress).toHaveBeenCalledWith({
      cursor: { source: 'complete' },
      progress: {
        corpusCompared: 5,
        sumariosCompared: 3,
        sentenciasCompared: 2,
        missing: 0,
        sourceDifferences: 0,
        samples: [],
      },
    });
  });

  it('captures H_BOOT under the existing mutation barrier without modifying outbox state', async () => {
    const withMutationBarrier = jest.fn(
      async (run: (pg: never, watermark: string) => Promise<unknown>) =>
        run({} as never, '218900'),
    );
    const service = makeService({}, { withMutationBarrier });
    await expect(service.captureFreshV4HighWatermark()).resolves.toBe('218900');
    expect(withMutationBarrier).toHaveBeenCalledTimes(1);
  });

  it('adds the fresh alias only after a verified zero-backlog replay under the barrier', async () => {
    const order: string[] = [];
    const repository = {
      withMutationBarrier: jest.fn(
        async (run: (pg: never, watermark: string) => Promise<unknown>) => {
          order.push('LOCKED');
          const result = await run({} as never, '218910');
          order.push('RELEASED');
          return result;
        },
      ),
      outboxChangesPage: jest.fn().mockResolvedValue([]),
      outboxSnapshotThrough: jest
        .fn()
        .mockResolvedValue({ pending: 0, failed: 0 }),
    };
    let aliasActive = false;
    const updateAliases = jest.fn(async () => {
      order.push('ALIAS_CREATED');
      aliasActive = true;
      return { body: { acknowledged: true } };
    });
    const getAlias = jest.fn(async () => ({
      body: aliasActive ? { [target]: {} } : {},
    }));
    const client = {
      indices: {
        exists: jest.fn().mockResolvedValue({ body: true }),
        getMapping: jest.fn().mockResolvedValue({
          body: {
            [target]: {
              mappings: SEARCH_INDEX_DEFINITION_V4.mappings,
            },
          },
        }),
        getSettings: canonicalPipelineSettings(),
        refresh: jest.fn().mockResolvedValue({ body: {} }),
        getAlias,
        updateAliases,
      },
      transport: { request: canonicalPipelineRequest() },
    };
    const service = makeService(client, repository);
    jest.spyOn(service, 'verifyPhysical').mockResolvedValue({
      exactIdEquality: true,
      expectedIds: 69313,
      indexedIds: 69313,
      missing: [],
      extra: [],
      duplicates: 0,
    } as never);

    const checkpoint = await service.reconcileAndActivateFreshV4(
      target,
      '218900',
      async () => {
        expect(order).toEqual(['LOCKED']);
        order.push('PRECONDITIONS_VERIFIED');
      },
    );
    expect(checkpoint.highWatermark).toBe('218910');
    expect(checkpoint.pendingThrough).toBe(0);
    expect(checkpoint.failedThrough).toBe(0);
    expect(updateAliases).toHaveBeenCalledWith({
      body: {
        actions: [
          {
            add: {
              index: target,
              alias,
              is_write_index: true,
            },
          },
        ],
      },
    });
    expect(order).toEqual([
      'LOCKED',
      'PRECONDITIONS_VERIFIED',
      'ALIAS_CREATED',
      'RELEASED',
    ]);
  });
});

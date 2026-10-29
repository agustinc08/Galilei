import { OpenSearchDocumentRepository } from './opensearch-document.repository';

describe('OpenSearchDocumentRepository mutation barrier', () => {
  it('locks all source tables and the outbox before capturing the high-water mark', async () => {
    const queries: string[] = [];
    const client = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        if (sql.includes('pg_advisory_lock'))
          return Promise.resolve({ rows: [{ acquired: true }] });
        if (sql.includes('MAX("id")'))
          return Promise.resolve({ rows: [{ watermark: '218842' }] });
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    const repository = Object.create(
      OpenSearchDocumentRepository.prototype,
    ) as OpenSearchDocumentRepository;
    Object.defineProperty(repository, 'pool', {
      value: { connect: jest.fn().mockResolvedValue(client) },
    });

    await expect(
      repository.withMutationBarrier((_connection, watermark) =>
        Promise.resolve(watermark),
      ),
    ).resolves.toBe('218842');

    const lock = queries.find((sql) => sql.startsWith('LOCK TABLE'));
    expect(lock).toContain('"CorpusDocument"');
    expect(lock).toContain('"Sentencia"');
    expect(lock).toContain('"Sumario"');
    expect(lock).toContain('"SearchIndexOutbox"');
    expect(
      queries.findIndex((sql) => sql.startsWith('LOCK TABLE')),
    ).toBeLessThan(queries.findIndex((sql) => sql.includes('MAX("id")')));
    expect(queries).toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('OpenSearchDocumentRepository stale Corpus deletes', () => {
  it('queues deduplicated exact deletes through the outbox', async () => {
    const query = jest
      .fn()
      .mockResolvedValue({ rows: [{ id: '41' }], rowCount: 1 });
    const repository = Object.create(
      OpenSearchDocumentRepository.prototype,
    ) as OpenSearchDocumentRepository;
    Object.defineProperty(repository, 'pool', { value: { query } });

    await expect(
      repository.enqueueDeleteForMissingCorpusDocuments([
        'cmvssujtj0009igic2xfqdxmx',
        'cmvssujtj0009igic2xfqdxmx',
      ]),
    ).resolves.toBe(1);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "SearchIndexOutbox"'),
      [['cmvssujtj0009igic2xfqdxmx']],
    );
  });

  it('rejects non-Corpus IDs without writing to the outbox', async () => {
    const query = jest.fn();
    const repository = Object.create(
      OpenSearchDocumentRepository.prototype,
    ) as OpenSearchDocumentRepository;
    Object.defineProperty(repository, 'pool', { value: { query } });

    await expect(
      repository.enqueueDeleteForMissingCorpusDocuments([
        'JURISPRUDENCIA:SENTENCIA:41889',
      ]),
    ).rejects.toThrow('SEARCH_ORPHAN_CORPUS_ID_INVALID');
    expect(query).not.toHaveBeenCalled();
  });
});

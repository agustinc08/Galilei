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

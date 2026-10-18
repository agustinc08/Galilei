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
});

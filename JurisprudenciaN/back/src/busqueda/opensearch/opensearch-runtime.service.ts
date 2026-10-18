import { Client } from '@opensearch-project/opensearch';
import { OpenSearchDocumentRepository } from './opensearch-document.repository';
import { OpenSearchIndexService } from './opensearch-index.service';
import { readOpenSearchConfig } from './opensearch-config';
import {
  OpenSearchSearchSourceAdapter,
  type SearchCandidateHydrator,
} from './opensearch-search-source.adapter';
import { OpenSearchSyncWorker } from './opensearch-sync.worker';
import type { SearchSourceAdapter } from '../adapters/search-source.adapter';

export class OpenSearchRuntimeService {
  readonly config = readOpenSearchConfig();
  readonly client = new Client(this.config.clientOptions);
  readonly repository = new OpenSearchDocumentRepository();
  readonly index = new OpenSearchIndexService(
    this.client,
    this.repository,
    this.config.alias,
    this.config.indexPrefix,
  );
  readonly syncWorker = new OpenSearchSyncWorker(this.repository, this.index);

  async isReady() {
    try {
      const [healthResult, aliasResult] = await Promise.all([
        this.client.cluster.health({ local: true, timeout: '1s' }),
        this.client.indices.existsAlias({ name: this.config.alias }),
      ]);
      const health =
        (healthResult as unknown as { body?: { status?: string } }).body ??
        (healthResult as unknown as { status?: string });
      const aliasBody =
        (aliasResult as unknown as { body?: boolean }).body ??
        (aliasResult as unknown as boolean);
      return (
        ['green', 'yellow'].includes(health.status ?? '') && aliasBody === true
      );
    } catch {
      return false;
    }
  }

  async activeSchemaVersion(): Promise<number | null> {
    try {
      const response = await this.client.indices.getMapping({
        index: this.config.alias,
      });
      const body =
        (response as unknown as { body?: Record<string, unknown> }).body ??
        (response as unknown as Record<string, unknown>);
      const versions = Object.values(body).flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const mappings = (entry as { mappings?: { _meta?: unknown } }).mappings;
        const meta = mappings?._meta;
        if (!meta || typeof meta !== 'object') return [];
        const version = (meta as { galileiSearchSchemaVersion?: unknown })
          .galileiSearchSchemaVersion;
        return typeof version === 'number' ? [version] : [];
      });
      return versions.length &&
        versions.every((version) => version === versions[0])
        ? versions[0]
        : null;
    } catch {
      return null;
    }
  }

  onModuleInit() {
    this.syncWorker.start();
  }

  createSource(
    source: 'CORPUS' | 'JURISPRUDENCIA',
    hydrate: SearchCandidateHydrator,
    closeHydrator?: () => Promise<void>,
  ): SearchSourceAdapter {
    return new OpenSearchSearchSourceAdapter(
      this.client,
      this.config.alias,
      source,
      hydrate,
      closeHydrator,
    );
  }

  async onModuleDestroy() {
    await this.syncWorker.stop();
    await this.index.close();
    await this.client.close();
  }
}

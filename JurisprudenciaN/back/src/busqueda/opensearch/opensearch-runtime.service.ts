import { Client } from '@opensearch-project/opensearch';
import type { ApprovedRuntimePgConfig } from '../../config/runtime-database-config';
import { getRuntimeDatabasePoolConfig } from '../../config/runtime-database-config';
import type { SearchSourceAdapter } from '../adapters/search-source.adapter';
import { OpenSearchDocumentRepository } from './opensearch-document.repository';
import { OpenSearchIndexService } from './opensearch-index.service';
import { readOpenSearchConfig } from './opensearch-config';
import {
  OpenSearchSearchSourceAdapter,
  type SearchCandidateHydrator,
} from './opensearch-search-source.adapter';
import { OpenSearchSyncWorker } from './opensearch-sync.worker';

function responseBody<T>(response: unknown): T {
  if (typeof response === 'object' && response !== null && 'body' in response) {
    return (response as { body: T }).body;
  }
  return response as T;
}

export class OpenSearchRuntimeService {
  readonly config = readOpenSearchConfig();
  readonly client = new Client(this.config.clientOptions);
  readonly repository: OpenSearchDocumentRepository;
  readonly index: OpenSearchIndexService;
  readonly syncWorker: OpenSearchSyncWorker;

  constructor(
    databaseConfig: ApprovedRuntimePgConfig = getRuntimeDatabasePoolConfig(),
  ) {
    this.repository = new OpenSearchDocumentRepository(databaseConfig);
    this.index = new OpenSearchIndexService(
      this.client,
      this.repository,
      this.config.alias,
      this.config.indexPrefix,
      this.config.searchSchemaVersion,
      this.config.readOnlyCandidate,
      this.config.searchTarget,
      this.config.trustedPhysicalWriter,
    );
    this.syncWorker = new OpenSearchSyncWorker(this.repository, this.index);
  }

  async isReady() {
    try {
      const [healthResult, aliasResult] = await Promise.all([
        this.client.cluster.health({ local: true, timeout: '1s' }),
        this.config.readOnlyCandidate
          ? this.client.indices.exists({ index: this.config.searchTarget })
          : this.config.trustedPhysicalWriter
            ? this.client.indices.getAlias({ name: this.config.alias })
            : this.client.indices.existsAlias({ name: this.config.alias }),
      ]);
      const health = responseBody<{ status?: string }>(healthResult);
      const aliasReady: boolean = Boolean(
        this.config.trustedPhysicalWriter
          ? Object.keys(responseBody<Record<string, unknown>>(aliasResult))
              .length === 1 &&
              Object.prototype.hasOwnProperty.call(
                responseBody<Record<string, unknown>>(aliasResult),
                this.config.searchTarget,
              )
          : responseBody<boolean>(aliasResult) === true,
      );
      return Boolean(
        ['green', 'yellow'].includes(health.status ?? '') &&
        aliasReady &&
        (await this.activeSchemaVersion()) === this.config.searchSchemaVersion,
      );
    } catch {
      return false;
    }
  }

  async activeSchemaVersion(): Promise<number | null> {
    try {
      const response = await this.client.indices.getMapping({
        index: this.config.searchTarget,
      });
      const body = responseBody<Record<string, unknown>>(response);
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

  async onModuleInit() {
    if (this.config.readOnlyCandidate) return;
    if (this.config.trustedPhysicalWriter && !(await this.isReady())) {
      throw new Error('OPENSEARCH_TRUSTED_WRITER_TARGET_NOT_ACTIVE');
    }
    this.syncWorker.start();
  }

  createSource(
    source: 'CORPUS' | 'JURISPRUDENCIA',
    hydrate: SearchCandidateHydrator,
    closeHydrator?: () => Promise<void>,
  ): SearchSourceAdapter {
    return new OpenSearchSearchSourceAdapter(
      this.client,
      this.config.searchTarget,
      source,
      hydrate,
      closeHydrator,
      this.config.searchSchemaVersion,
    );
  }

  async onModuleDestroy() {
    await this.syncWorker.stop();
    await this.index.close();
    await this.client.close();
  }
}

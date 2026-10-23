import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Client } from '@opensearch-project/opensearch';
import { OpenSearchDocumentRepository } from './opensearch-document.repository';
import {
  SEARCH_INDEX_DEFINITIONS,
  SEARCH_INDEX_SCHEMA_VERSION,
  SEARCH_V4_COLLATION_PIPELINE,
  SEARCH_V4_COLLATION_PIPELINE_ID,
  type SearchIndexSchemaVersion,
  type SearchIndexDocument,
} from './opensearch-mapping';
import {
  projectCorpusSearchDocument,
  projectJurisprudenciaSearchDocument,
  projectSentenciaSearchDocument,
} from './opensearch-search-document';
import {
  buildAtomicAliasSwapActions,
  resolveManagedAliasTarget,
} from './opensearch-alias-safety';

const BULK_LIMIT_BYTES = 4 * 1024 * 1024;
const FRESH_V4_PROJECTION_PAGE_SIZE = 10;

/**
 * OpenSearch omits several mapping defaults from GET _mapping responses. Treat
 * those omissions as equivalent to the canonical mapping while keeping every
 * non-default mapping choice (including V4 collation settings) strict.
 */
function normalizeOpenSearchMappingDefaults(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeOpenSearchMappingDefaults);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      normalizeOpenSearchMappingDefaults(child),
    ]),
  ) as Record<string, unknown>;
  const type = normalized.type;

  // Object is the implicit type for a property container in OpenSearch.
  if (type === 'object' && normalized.properties !== undefined) {
    delete normalized.type;
  }
  if (type === 'text') {
    if (normalized.index_options === 'positions') {
      delete normalized.index_options;
    }
    if (
      normalized.search_analyzer !== undefined &&
      normalized.search_analyzer === normalized.analyzer
    ) {
      delete normalized.search_analyzer;
    }
  }
  if (
    type === 'date' &&
    normalized.format === 'strict_date_optional_time||epoch_millis'
  ) {
    delete normalized.format;
  }
  if (type === 'icu_collation_keyword') {
    if (normalized.case_level === false) {
      delete normalized.case_level;
    }
    if (normalized.numeric === false) {
      delete normalized.numeric;
    }
    if (normalized.doc_values === true) {
      delete normalized.doc_values;
    }
  }
  if (
    (type === 'keyword' || type === 'date') &&
    normalized.doc_values === true
  ) {
    delete normalized.doc_values;
  }
  if (type === 'wildcard' && normalized.doc_values === false) {
    delete normalized.doc_values;
  }

  return normalized;
}

type SearchHitsResponse = {
  hits?: {
    total?: { value: number; relation: 'eq' | 'gte' };
    hits?: Array<{
      _id: string;
      sort?: unknown[];
      _source?: { publicationStatus?: string };
    }>;
  };
};

export type SearchReplayCheckpoint = {
  target: string;
  schemaVersion: SearchIndexSchemaVersion;
  afterWatermark: string;
  highWatermark: string;
  changedKeys: number;
  pendingThrough: number;
  failedThrough: number;
  verification: {
    expectedIds: number;
    indexedIds: number;
    missing: number;
    extra: number;
    duplicates: number;
  };
};

export type SearchReplayOptions = {
  requireOutboxClear?: boolean;
  beforeBarrierRelease?: (checkpoint: SearchReplayCheckpoint) => Promise<void>;
};

export type SearchProjectionCounts = {
  corpus: number;
  jurisprudencia: number;
  sentencias: number;
  total: number;
};

export type FreshV4ProjectionCursor =
  | { source: 'corpus'; after: string }
  | { source: 'jurisprudencia'; after: number }
  | { source: 'sentencias'; after: number }
  | { source: 'complete' };

export type FreshV4ProjectionProgress = {
  cursor: FreshV4ProjectionCursor;
  counts: SearchProjectionCounts;
};

export type FreshV4ProjectionOptions = {
  cursor?: FreshV4ProjectionCursor;
  counts?: SearchProjectionCounts;
  onProgress?: (progress: FreshV4ProjectionProgress) => void | Promise<void>;
};

export type SearchSourceParityResult = {
  target: string;
  schemaVersion: 4;
  corpusCompared: number;
  sumariosCompared: number;
  sentenciasCompared: number;
  expectedIds: number;
  indexedIds: number;
  missing: number;
  extra: number;
  exactIdEquality: boolean;
  sourceDifferences: number;
  samples: string[];
  pass: boolean;
};

export type FreshV4SourceParityCursor =
  | { source: 'corpus'; after: string }
  | { source: 'jurisprudencia'; after: number }
  | { source: 'sentencias'; after: number }
  | { source: 'complete' };

export type FreshV4SourceParityProgress = Pick<
  SearchSourceParityResult,
  | 'corpusCompared'
  | 'sumariosCompared'
  | 'sentenciasCompared'
  | 'missing'
  | 'sourceDifferences'
  | 'samples'
>;

export type FreshV4SourceParityOptions = {
  cursor?: FreshV4SourceParityCursor;
  progress?: FreshV4SourceParityProgress;
  onProgress?: (progress: {
    cursor: FreshV4SourceParityCursor;
    progress: FreshV4SourceParityProgress;
  }) => void | Promise<void>;
};

export class OpenSearchIndexService {
  constructor(
    private readonly client: Client,
    private readonly repository: OpenSearchDocumentRepository,
    readonly alias: string,
    private readonly indexPrefix = 'galilei-search',
    private readonly schemaVersion: SearchIndexSchemaVersion = SEARCH_INDEX_SCHEMA_VERSION,
    private readonly readOnlyCandidate = false,
    readonly searchTarget = alias,
    private readonly trustedPhysicalWriter = false,
    private readonly allowSchema4AliasWriter = false,
  ) {}

  async rebuild() {
    this.assertMutable('REBUILD');
    if (this.schemaVersion === 4 || this.trustedPhysicalWriter) {
      throw new Error('SEARCH_PHYSICAL_REBUILD_REQUIRES_OPERATOR_REVIEW');
    }
    const buildStarted = Date.now();
    const startWatermark = await this.repository.withMutationBarrier(
      (_client, watermark) => Promise.resolve(watermark),
    );
    const managedIndexPrefix = `${this.indexPrefix}-v`;
    const physicalIndex = `${managedIndexPrefix}${String(this.schemaVersion).padStart(3, '0')}-${new Date().toISOString().replace(/[-:.]/gu, '').toLowerCase()}-${randomUUID().slice(0, 8)}`;
    let indexCreated = false;
    let promoted = false;
    let indexedCorpus = 0;
    let indexedJurisprudencia = 0;
    let indexedSentencias = 0;
    try {
      const mapping = JSON.parse(
        JSON.stringify(SEARCH_INDEX_DEFINITIONS[this.schemaVersion]),
      ) as Record<string, unknown>;
      const settings = mapping.settings as Record<string, unknown>;
      settings.refresh_interval = '-1';
      await this.client.indices.create({ index: physicalIndex, body: mapping });
      indexCreated = true;

      const projected = await this.projectCurrentState(physicalIndex);
      indexedCorpus = projected.corpus;
      indexedJurisprudencia = projected.jurisprudencia;
      indexedSentencias = projected.sentencias;

      await this.client.indices.putSettings({
        index: physicalIndex,
        body: { index: { refresh_interval: '1s' } },
      });
      await this.client.indices.refresh({ index: physicalIndex });

      let verification: Awaited<
        ReturnType<OpenSearchIndexService['verifyPhysical']>
      >;
      await this.repository.withMutationBarrier(async (pg, highWatermark) => {
        const changedKeys = await this.repository.outboxChangesAfter(
          pg,
          startWatermark,
        );
        for (let offset = 0; offset < changedKeys.length; offset += 250) {
          const batch = changedKeys.slice(offset, offset + 250);
          const docs = await Promise.all(
            batch.map((key) => this.resolveKey(key)),
          );
          await this.applyResolutions(physicalIndex, batch, docs);
        }
        await this.client.indices.refresh({ index: physicalIndex });
        verification = await this.verifyPhysical(
          physicalIndex,
          this.schemaVersion,
        );
        if (
          !verification.exactIdEquality ||
          verification.missing.length ||
          verification.extra.length
        ) {
          throw new Error('SEARCH_REBUILD_INTEGRITY_FAILED');
        }
        if (
          !this.readOnlyCandidate &&
          process.env.OPENSEARCH_CANDIDATE_ONLY !== 'true'
        ) {
          await this.swapAlias(physicalIndex);
          promoted = true;
          await this.repository.markOutboxThrough(pg, highWatermark);
        }
      });

      return {
        physicalIndex,
        alias: this.alias,
        indexedCorpus,
        indexedJurisprudencia,
        indexedSentencias,
        totalIndexed: verification!.indexedIds,
        idSetSha256: verification!.indexedIdSetSha256,
        corpusIdSetSha256: verification!.corpusIdSetSha256,
        integrity: {
          schemaVersion: verification!.schemaVersion,
          expectedIds: verification!.expectedIds,
          indexedIds: verification!.indexedIds,
          actualDistinctIds: verification!.actualDistinctIds,
          missing: verification!.missing.length,
          extra: verification!.extra.length,
          duplicates: verification!.duplicates,
          corpusEligibleIds: verification!.corpusEligibleIds,
          corpusIndexedIds: verification!.corpusIndexedIds,
          corpusMissing: verification!.corpusMissing,
          corpusExtra: verification!.corpusExtra,
          sumarioEligibleIds: verification!.sumarioEligibleIds,
          sumarioIndexedIds: verification!.sumarioIndexedIds,
          sumarioMissing: verification!.sumarioMissing,
          sumarioExtra: verification!.sumarioExtra,
          sentenciaEligibleIds: verification!.sentenciaEligibleIds,
          sentenciaIndexedIds: verification!.sentenciaIndexedIds,
          sentenciaMissing: verification!.sentenciaMissing,
          sentenciaExtra: verification!.sentenciaExtra,
          publishedSentenciasEligibleIds:
            verification!.publishedSentenciasEligibleIds,
          publishedSentenciasIndexedIds:
            verification!.publishedSentenciasIndexedIds,
          publishedSentenciasMissing: verification!.publishedSentenciasMissing,
          publishedSentenciasExtra: verification!.publishedSentenciasExtra,
        },
        elapsedMs: Date.now() - buildStarted,
        concurrentChangesReplayed: true,
        startWatermark,
        candidateReady: true,
        aliasPromoted: promoted,
      };
    } catch (error) {
      if (
        indexCreated &&
        !promoted &&
        !this.readOnlyCandidate &&
        process.env.OPENSEARCH_CANDIDATE_ONLY !== 'true' &&
        (await this.indexExists(physicalIndex).catch(() => false))
      ) {
        await this.client.indices
          .delete({ index: physicalIndex })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  /** Capture a stable starting point before projecting a clean V4 target. */
  async captureFreshV4HighWatermark() {
    this.assertFreshV4OperatorTarget(this.searchTarget);
    return this.repository.withMutationBarrier((_client, watermark) =>
      Promise.resolve(watermark),
    );
  }

  /** Create only the canonical schema-4 index; the operator owns empty-cluster checks. */
  async createFreshV4Index(target: string) {
    this.assertFreshV4OperatorTarget(target);
    if ((await this.aliasTargets()).length !== 0) {
      throw new Error('SEARCH_FRESH_V4_ALIAS_MUST_BE_ABSENT');
    }
    if (await this.indexExists(target)) {
      throw new Error('SEARCH_FRESH_V4_TARGET_ALREADY_EXISTS');
    }
    const pipeline = await this.ensureFreshV4CollationPipeline();
    const mapping = JSON.parse(
      JSON.stringify(SEARCH_INDEX_DEFINITIONS[4]),
    ) as Record<string, unknown>;
    const settings = mapping.settings as Record<string, unknown>;
    settings.refresh_interval = '-1';
    await this.client.indices.create({ index: target, body: mapping });
    return {
      target,
      schemaVersion: 4 as const,
      state: 'INDEX_CREATED' as const,
      collationPipeline: pipeline.id,
      collationPipelineCreated: pipeline.created,
    };
  }

  /** Validate an interrupted projection target without deleting or recreating it. */
  async assertFreshV4ResumeTarget(target: string) {
    this.assertFreshV4OperatorTarget(target);
    if ((await this.aliasTargets()).length !== 0) {
      throw new Error('SEARCH_FRESH_V4_RESUME_ALIAS_MUST_BE_ABSENT');
    }
    await this.assertPhysicalSchema(target, 4);
    const pipeline = await this.assertFreshV4PipelineSetting(target);
    return {
      target,
      schemaVersion: 4 as const,
      state: 'INDEX_CREATED' as const,
      collationPipeline: pipeline.id,
      collationPipelineCreated: pipeline.created,
    };
  }

  /** Project current PostgreSQL state in bounded pages using the canonical document builders. */
  async projectFreshV4(target: string, options: FreshV4ProjectionOptions = {}) {
    this.assertFreshV4OperatorTarget(target);
    await this.assertPhysicalSchema(target, 4);
    const counts = await this.projectCurrentState(
      target,
      FRESH_V4_PROJECTION_PAGE_SIZE,
      options,
    );
    await this.client.indices.putSettings({
      index: target,
      body: { index: { refresh_interval: '1s' } },
    });
    await this.client.indices.refresh({ index: target });
    const countResponse = await this.client.count({
      index: target,
      body: { query: { match_all: {} } },
    });
    const indexedIds = bodyOf<{ count: number }>(countResponse).count;
    if (indexedIds !== counts.total)
      throw new Error('SEARCH_FRESH_V4_ID_COUNT_PARITY_FAILED');
    return {
      target,
      ...counts,
      countCheck: {
        expectedIds: counts.total,
        indexedIds,
        pass: true,
      },
      state: 'PROJECTED' as const,
    };
  }

  /** Compare each PostgreSQL source page to the indexed V4 source without retaining the full corpus. */
  async verifyFreshV4SourceParity(
    target: string,
    pageSize = 250,
    options: FreshV4SourceParityOptions = {},
  ): Promise<SearchSourceParityResult> {
    this.assertFreshV4OperatorTarget(target);
    await this.assertPhysicalSchema(target, 4);
    const result: SearchSourceParityResult = {
      target,
      schemaVersion: 4,
      corpusCompared: options.progress?.corpusCompared ?? 0,
      sumariosCompared: options.progress?.sumariosCompared ?? 0,
      sentenciasCompared: options.progress?.sentenciasCompared ?? 0,
      expectedIds: 0,
      indexedIds: 0,
      missing: options.progress?.missing ?? 0,
      extra: 0,
      exactIdEquality: false,
      sourceDifferences: options.progress?.sourceDifferences ?? 0,
      samples: options.progress?.samples ?? [],
      pass: false,
    };
    const cursor = options.cursor ?? { source: 'corpus', after: '' };
    const sourceRank = {
      corpus: 0,
      jurisprudencia: 1,
      sentencias: 2,
      complete: 3,
    } as const;
    const shouldCompare = (source: keyof typeof sourceRank) =>
      sourceRank[source] >= sourceRank[cursor.source] &&
      cursor.source !== 'complete';
    const reportProgress = async (next: FreshV4SourceParityCursor) => {
      await options.onProgress?.({
        cursor: next,
        progress: {
          corpusCompared: result.corpusCompared,
          sumariosCompared: result.sumariosCompared,
          sentenciasCompared: result.sentenciasCompared,
          missing: result.missing,
          sourceDifferences: result.sourceDifferences,
          samples: [...result.samples],
        },
      });
    };
    await this.repository.withReadSnapshot(async (pg) => {
      if (shouldCompare('corpus')) {
        let afterCorpus = cursor.source === 'corpus' ? cursor.after : '';
        for (;;) {
          const rows = await this.repository.corpusPage(
            pg,
            afterCorpus,
            pageSize,
          );
          if (!rows.length) break;
          const docs = rows.map((row) => projectCorpusSearchDocument(row, 4));
          await this.compareSourcePage(target, docs, result);
          result.corpusCompared += docs.length;
          afterCorpus = rows[rows.length - 1].id;
          await reportProgress({ source: 'corpus', after: afterCorpus });
        }
        await reportProgress({ source: 'jurisprudencia', after: 0 });
      }
      if (shouldCompare('jurisprudencia')) {
        let afterSumario =
          cursor.source === 'jurisprudencia' ? cursor.after : 0;
        for (;;) {
          const rows = await this.repository.jurisprudenciaPage(
            pg,
            afterSumario,
            pageSize,
          );
          if (!rows.length) break;
          const docs = rows
            .map((row) => projectJurisprudenciaSearchDocument(row, 4))
            .filter((doc): doc is SearchIndexDocument => doc !== null);
          await this.compareSourcePage(target, docs, result);
          result.sumariosCompared += docs.length;
          afterSumario = rows[rows.length - 1].id;
          await reportProgress({
            source: 'jurisprudencia',
            after: afterSumario,
          });
        }
        await reportProgress({ source: 'sentencias', after: 0 });
      }
      if (shouldCompare('sentencias')) {
        let afterSentencia = cursor.source === 'sentencias' ? cursor.after : 0;
        for (;;) {
          const rows = await this.repository.sentenciaPage(
            pg,
            afterSentencia,
            pageSize,
          );
          if (!rows.length) break;
          const docs = rows
            .map((row) => projectSentenciaSearchDocument(row, 4))
            .filter((doc): doc is SearchIndexDocument => doc !== null);
          await this.compareSourcePage(target, docs, result);
          result.sentenciasCompared += docs.length;
          afterSentencia = rows[rows.length - 1].id;
          await reportProgress({ source: 'sentencias', after: afterSentencia });
        }
      }
      await reportProgress({ source: 'complete' });
    });
    result.expectedIds =
      result.corpusCompared +
      result.sumariosCompared +
      result.sentenciasCompared;
    const countResponse = await this.client.count({
      index: target,
      body: { query: { match_all: {} } },
    });
    result.indexedIds = bodyOf<{ count: number }>(countResponse).count;
    result.extra = Math.max(0, result.indexedIds - result.expectedIds);
    result.exactIdEquality =
      result.indexedIds === result.expectedIds && result.missing === 0;
    result.pass = result.exactIdEquality && result.sourceDifferences === 0;
    return result;
  }

  /** Reconcile writes since H_BOOT and add the fresh alias only while the mutation barrier is held. */
  async reconcileAndActivateFreshV4(
    target: string,
    highWatermark: string,
    beforeActivation?: () => Promise<void>,
  ) {
    this.assertFreshV4OperatorTarget(target);
    await this.assertPhysicalSchema(target, 4);
    await this.assertFreshV4PipelineSetting(target);
    let aliasActivated = false;
    const checkpoint = await this.replayPhysicalChanges(target, highWatermark, {
      requireOutboxClear: true,
      beforeBarrierRelease: async (reconciled) => {
        if (reconciled.pendingThrough !== 0 || reconciled.failedThrough !== 0) {
          throw new Error('SEARCH_FRESH_V4_OUTBOX_NOT_CLEAR');
        }
        if ((await this.aliasTargets()).length !== 0) {
          throw new Error('SEARCH_FRESH_V4_ALIAS_MUST_BE_ABSENT');
        }
        await beforeActivation?.();
        const actions = buildAtomicAliasSwapActions(
          [],
          target,
          this.alias,
          this.indexPrefix,
          4,
        );
        await this.client.indices.updateAliases({ body: { actions } });
        const activated = await this.aliasTargets();
        if (activated.length !== 1 || activated[0] !== target) {
          throw new Error('SEARCH_FRESH_V4_ALIAS_POSTCONDITION_FAILED');
        }
        aliasActivated = true;
      },
    });
    if (!aliasActivated) throw new Error('SEARCH_FRESH_V4_ALIAS_NOT_ACTIVATED');
    return { ...checkpoint, alias: this.alias, aliasTarget: target };
  }

  async verifyActive() {
    const active = await this.activePhysicalIndex();
    if (!active) throw new Error('SEARCH_ACTIVE_ALIAS_MISSING');
    return {
      activeAlias: this.alias,
      physicalIndex: active,
      ...(await this.verifyPhysical(active)),
    };
  }

  async verifyTarget(target: string) {
    return {
      target,
      ...(await this.verifyPhysical(target, this.schemaVersion)),
    };
  }

  async replayShadowChanges(
    target: string,
    afterWatermark: string,
    options: SearchReplayOptions = {},
  ): Promise<SearchReplayCheckpoint> {
    if (this.schemaVersion !== 4 || !this.isPhysicalIndex(target, 4)) {
      throw new Error('SEARCH_SHADOW_TARGET_INVALID');
    }
    return this.replayPhysicalChanges(target, afterWatermark, options);
  }

  async replayPhysicalChanges(
    target: string,
    afterWatermark: string,
    options: SearchReplayOptions = {},
  ): Promise<SearchReplayCheckpoint> {
    if (
      !this.trustedPhysicalWriter ||
      !this.isPhysicalIndex(target, this.schemaVersion)
    ) {
      throw new Error('SEARCH_PHYSICAL_REPLAY_TARGET_INVALID');
    }
    const start = parseOutboxWatermark(afterWatermark);
    if (!(await this.indexExists(target))) {
      throw new Error('SEARCH_PHYSICAL_REPLAY_TARGET_MISSING');
    }
    const mappingResponse = await this.client.indices.getMapping({
      index: target,
    });
    const mappings = bodyOf<Record<string, unknown>>(mappingResponse);
    const targetMapping = mappings[target] as
      | { mappings?: { _meta?: { galileiSearchSchemaVersion?: unknown } } }
      | undefined;
    if (
      targetMapping?.mappings?._meta?.galileiSearchSchemaVersion !==
      this.schemaVersion
    ) {
      throw new Error('SEARCH_PHYSICAL_REPLAY_SCHEMA_MISMATCH');
    }
    return this.repository.withMutationBarrier(async (pg, highWatermark) => {
      const end = parseOutboxWatermark(highWatermark);
      if (end < start) throw new Error('SEARCH_OUTBOX_WATERMARK_REGRESSION');
      let changedKeys = 0;
      let afterDocumentKey = '';
      for (;;) {
        const keys = await this.repository.outboxChangesPage(
          pg,
          start.toString(),
          end.toString(),
          afterDocumentKey,
          250,
        );
        if (!keys.length) break;
        const documents = await Promise.all(
          keys.map((key) => this.resolveKey(key, this.schemaVersion)),
        );
        await this.applyResolutions(target, keys, documents);
        changedKeys += keys.length;
        afterDocumentKey = keys[keys.length - 1];
      }
      await this.client.indices.refresh({ index: target });
      const verification = await this.verifyPhysical(
        target,
        this.schemaVersion,
      );
      if (
        !verification.exactIdEquality ||
        verification.missing.length ||
        verification.extra.length
      ) {
        throw new Error('SEARCH_SHADOW_CATCHUP_INTEGRITY_FAILED');
      }
      const outbox = await this.repository.outboxSnapshotThrough(
        pg,
        end.toString(),
      );
      const checkpoint: SearchReplayCheckpoint = {
        target,
        schemaVersion: this.schemaVersion,
        afterWatermark: start.toString(),
        highWatermark: end.toString(),
        changedKeys,
        pendingThrough: outbox.pending,
        failedThrough: outbox.failed,
        verification: {
          expectedIds: verification.expectedIds,
          indexedIds: verification.indexedIds,
          missing: verification.missing.length,
          extra: verification.extra.length,
          duplicates: verification.duplicates,
        },
      };
      if (
        options.requireOutboxClear &&
        (checkpoint.pendingThrough !== 0 || checkpoint.failedThrough !== 0)
      ) {
        throw new Error('SEARCH_OUTBOX_NOT_CLEAR_THROUGH_CUT');
      }
      // This callback deliberately runs before the PostgreSQL table locks and
      // advisory lock are released. A future cutover may put its atomic alias
      // action here after the application and projector have been quiesced.
      await options.beforeBarrierRelease?.(checkpoint);
      return checkpoint;
    });
  }

  async hasActiveIndex() {
    return (await this.activePhysicalIndex()) !== null;
  }

  async status() {
    const aliasTarget = this.readOnlyCandidate
      ? null
      : await this.activePhysicalIndex();
    const target = this.readOnlyCandidate ? this.searchTarget : aliasTarget;
    const [healthResult, outbox, integrity] = await Promise.all([
      this.client.cluster.health(target ? { index: target } : {}),
      this.repository.outboxStatus(),
      target
        ? this.verifyPhysical(target, this.schemaVersion)
        : Promise.resolve(null),
    ]);
    const health =
      bodyOf<{ status?: string }>(healthResult).status ?? 'unknown';
    return {
      healthy: Boolean(target) && ['green', 'yellow'].includes(health),
      clusterHealth: health,
      activeAlias: this.readOnlyCandidate ? null : this.alias,
      physicalIndex: this.readOnlyCandidate ? this.searchTarget : aliasTarget,
      searchTarget: target,
      schemaVersion: this.schemaVersion,
      outbox,
      index: integrity
        ? {
            count: integrity.indexedIds,
            missing: integrity.missing.length,
            extra: integrity.extra.length,
            duplicates: integrity.duplicates,
            exactIdEquality: integrity.exactIdEquality,
          }
        : null,
    };
  }

  async indexKey(key: string) {
    this.assertMutable('INDEX_DOCUMENT');
    const destination = this.trustedPhysicalWriter
      ? this.searchTarget
      : this.alias;
    if (this.trustedPhysicalWriter) {
      if (!this.isPhysicalIndex(destination, this.schemaVersion)) {
        throw new Error('SEARCH_PHYSICAL_WRITE_TARGET_INVALID');
      }
      if (!(await this.indexExists(destination))) {
        throw new Error('SEARCH_PHYSICAL_WRITE_TARGET_MISSING');
      }
    } else if (!(await this.activePhysicalIndex())) {
      throw new Error('SEARCH_ACTIVE_ALIAS_MISSING');
    }
    const document = await this.resolveKey(key);
    if (document) {
      await this.client.index({
        index: destination,
        id: document.id,
        body: document,
        refresh: false,
      });
    } else {
      try {
        await this.client.delete({
          index: destination,
          id: key.startsWith('CORPUS:') ? key.slice('CORPUS:'.length) : key,
          refresh: false,
        });
      } catch (error) {
        if (statusCode(error) !== 404) throw error;
      }
    }
  }

  async cleanupOldIndexes(retentionDays = 7, keepPrevious = 1) {
    this.assertMutable('CLEANUP');
    const active = await this.activePhysicalIndex();
    const response = await this.client.cat.indices({
      index: `${this.indexPrefix}-v*`,
      format: 'json',
    });
    const rows = bodyOf<Array<{ index?: string; creation?: string }>>(response);
    const owned = rows
      .filter(
        (row) =>
          row.index?.startsWith(`${this.indexPrefix}-v`) &&
          row.index !== active,
      )
      .map((row) => ({
        index: row.index!,
        createdAt: parseIndexDate(row.index!),
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const remove = owned
      .slice(keepPrevious)
      .filter((row) => row.createdAt.getTime() < cutoff);
    for (const row of remove)
      await this.client.indices.delete({ index: row.index });
    return {
      activeIndexRetained: active,
      removed: remove.map((row) => row.index),
      retainedPrevious: owned.length - remove.length,
    };
  }

  async verifyPhysical(
    index: string,
    expectedSchemaVersion: number | undefined = this.schemaVersion,
  ) {
    const [mappingResponse, countResponse] = await Promise.all([
      this.client.indices.getMapping({ index }),
      this.client.count({ index, body: { query: { match_all: {} } } }),
    ]);
    const mappingBody =
      bodyOf<
        Record<
          string,
          { mappings?: { _meta?: { galileiSearchSchemaVersion?: number } } }
        >
      >(mappingResponse);
    const schemaVersion =
      mappingBody[index]?.mappings?._meta?.galileiSearchSchemaVersion;
    if (
      expectedSchemaVersion !== undefined &&
      schemaVersion !== expectedSchemaVersion
    )
      throw new Error('SEARCH_INDEX_SCHEMA_VERSION_MISMATCH');
    const count = bodyOf<{ count: number }>(countResponse).count;
    const actual = await this.readAllIds(index);
    const expected = await this.expectedIds();
    const expectedSet = new Set(expected.all);
    const actualSet = new Set(actual.all);
    const missing = [...expectedSet].filter((id) => !actualSet.has(id));
    const extra = [...actualSet].filter((id) => !expectedSet.has(id));
    const corpusExpected = new Set(expected.corpus);
    const corpusActual = new Set(actual.corpus);
    const sumariosExpected = new Set(expected.sumarios);
    const sumariosActual = new Set(actual.sumarios);
    const sentenciasExpected = new Set(expected.sentencias);
    const sentenciasActual = new Set(actual.sentencias);
    const publishedSentenciasExpected = new Set(expected.publishedSentencias);
    const publishedSentenciasActual = new Set(actual.publishedSentencias);
    const corpusIdSetSha256 = hashIds(corpusExpected);
    const indexedIdSetSha256 = hashIds(actualSet);
    return {
      schemaVersion,
      expectedIds: expectedSet.size,
      indexedIds: count,
      actualDistinctIds: actualSet.size,
      missing,
      extra,
      duplicates: actual.all.length - actualSet.size,
      exactIdEquality:
        count === expectedSet.size &&
        actualSet.size === expectedSet.size &&
        missing.length === 0 &&
        extra.length === 0,
      corpusEligibleIds: corpusExpected.size,
      corpusIndexedIds: corpusActual.size,
      corpusMissing: [...corpusExpected].filter((id) => !corpusActual.has(id))
        .length,
      corpusExtra: [...corpusActual].filter((id) => !corpusExpected.has(id))
        .length,
      sumarioEligibleIds: sumariosExpected.size,
      sumarioIndexedIds: sumariosActual.size,
      sumarioMissing: [...sumariosExpected].filter(
        (id) => !sumariosActual.has(id),
      ).length,
      sumarioExtra: [...sumariosActual].filter(
        (id) => !sumariosExpected.has(id),
      ).length,
      sentenciaEligibleIds: sentenciasExpected.size,
      sentenciaIndexedIds: sentenciasActual.size,
      sentenciaMissing: [...sentenciasExpected].filter(
        (id) => !sentenciasActual.has(id),
      ).length,
      sentenciaExtra: [...sentenciasActual].filter(
        (id) => !sentenciasExpected.has(id),
      ).length,
      publishedSentenciasEligibleIds: publishedSentenciasExpected.size,
      publishedSentenciasIndexedIds: publishedSentenciasActual.size,
      publishedSentenciasMissing: [...publishedSentenciasExpected].filter(
        (id) => !publishedSentenciasActual.has(id),
      ).length,
      publishedSentenciasExtra: [...publishedSentenciasActual].filter(
        (id) => !publishedSentenciasExpected.has(id),
      ).length,
      corpusIdSetSha256,
      indexedIdSetSha256,
    };
  }

  async close() {
    await this.repository.close();
  }

  private async projectCurrentState(
    index: string,
    pageSize = 500,
    options: FreshV4ProjectionOptions = {},
  ): Promise<SearchProjectionCounts> {
    const counts: SearchProjectionCounts = {
      corpus: options.counts?.corpus ?? 0,
      jurisprudencia: options.counts?.jurisprudencia ?? 0,
      sentencias: options.counts?.sentencias ?? 0,
      total: options.counts?.total ?? 0,
    };
    const initialSource = options.cursor?.source ?? 'corpus';
    const sourceRank = {
      corpus: 0,
      jurisprudencia: 1,
      sentencias: 2,
      complete: 3,
    } as const;
    const shouldProject = (source: keyof typeof sourceRank) =>
      sourceRank[source] >= sourceRank[initialSource] &&
      initialSource !== 'complete';
    const reportProgress = async (cursor: FreshV4ProjectionCursor) => {
      counts.total = counts.corpus + counts.jurisprudencia + counts.sentencias;
      await options.onProgress?.({ cursor, counts: { ...counts } });
    };
    await this.repository.withReadSnapshot(async (pg) => {
      if (shouldProject('corpus')) {
        let afterCorpus =
          options.cursor?.source === 'corpus' ? options.cursor.after : '';
        for (;;) {
          const rows = await this.repository.corpusPage(
            pg,
            afterCorpus,
            pageSize,
          );
          if (!rows.length) break;
          const docs = rows.map((row) =>
            projectCorpusSearchDocument(row, this.schemaVersion),
          );
          await this.bulkIndex(index, docs);
          counts.corpus += docs.length;
          afterCorpus = rows[rows.length - 1].id;
          await reportProgress({ source: 'corpus', after: afterCorpus });
        }
        await reportProgress({ source: 'jurisprudencia', after: 0 });
      }
      if (shouldProject('jurisprudencia')) {
        let afterSumario =
          options.cursor?.source === 'jurisprudencia'
            ? options.cursor.after
            : 0;
        for (;;) {
          const rows = await this.repository.jurisprudenciaPage(
            pg,
            afterSumario,
            pageSize,
          );
          if (!rows.length) break;
          const docs = rows
            .map((row) =>
              projectJurisprudenciaSearchDocument(row, this.schemaVersion),
            )
            .filter((doc): doc is SearchIndexDocument => doc !== null);
          await this.bulkIndex(index, docs);
          counts.jurisprudencia += docs.length;
          afterSumario = rows[rows.length - 1].id;
          await reportProgress({
            source: 'jurisprudencia',
            after: afterSumario,
          });
        }
        await reportProgress({ source: 'sentencias', after: 0 });
      }
      if (shouldProject('sentencias')) {
        let afterSentencia =
          options.cursor?.source === 'sentencias' ? options.cursor.after : 0;
        for (;;) {
          const rows = await this.repository.sentenciaPage(
            pg,
            afterSentencia,
            pageSize,
          );
          if (!rows.length) break;
          const docs = rows
            .map((row) =>
              projectSentenciaSearchDocument(row, this.schemaVersion),
            )
            .filter((doc): doc is SearchIndexDocument => doc !== null);
          await this.bulkIndex(index, docs);
          counts.sentencias += docs.length;
          afterSentencia = rows[rows.length - 1].id;
          await reportProgress({ source: 'sentencias', after: afterSentencia });
        }
      }
      await reportProgress({ source: 'complete' });
    });
    return counts;
  }

  private async compareSourcePage(
    target: string,
    expected: SearchIndexDocument[],
    result: SearchSourceParityResult,
  ) {
    if (!expected.length) return;
    const response = await this.client.mget({
      index: target,
      body: { ids: expected.map((document) => document.id) },
    });
    const body = bodyOf<{
      docs?: Array<{
        _id?: string;
        found?: boolean;
        _source?: Record<string, unknown>;
      }>;
    }>(response);
    const actual = body.docs ?? [];
    if (actual.length !== expected.length) {
      throw new Error('SEARCH_FRESH_V4_MGET_CARDINALITY_MISMATCH');
    }
    for (let index = 0; index < expected.length; index += 1) {
      const wanted = expected[index];
      const found = actual[index];
      if (found?._id !== wanted.id) {
        throw new Error('SEARCH_FRESH_V4_MGET_ORDER_MISMATCH');
      }
      if (!found.found || !found._source) {
        result.missing += 1;
        if (result.samples.length < 20) result.samples.push(wanted.id);
        continue;
      }
      if (!isDeepStrictEqual(found._source, wanted)) {
        result.sourceDifferences += 1;
        if (result.samples.length < 20) result.samples.push(wanted.id);
      }
    }
  }

  private assertFreshV4OperatorTarget(target: string) {
    if (
      this.schemaVersion !== 4 ||
      this.readOnlyCandidate ||
      !this.trustedPhysicalWriter ||
      this.searchTarget !== target ||
      this.alias !== `${this.indexPrefix}-active` ||
      !this.isPhysicalIndex(target, 4)
    ) {
      throw new Error('SEARCH_FRESH_V4_OPERATOR_SCOPE_REJECTED');
    }
  }

  private async assertPhysicalSchema(index: string, expectedSchemaVersion: 4) {
    if (!this.isPhysicalIndex(index, expectedSchemaVersion)) {
      throw new Error('SEARCH_FRESH_V4_TARGET_INVALID');
    }
    if (!(await this.indexExists(index))) {
      throw new Error('SEARCH_FRESH_V4_TARGET_MISSING');
    }
    const response = await this.client.indices.getMapping({ index });
    const body =
      bodyOf<Record<string, { mappings?: Record<string, unknown> }>>(response);
    const actualMapping = body[index]?.mappings;
    const expectedMapping = (
      SEARCH_INDEX_DEFINITIONS[expectedSchemaVersion] as {
        mappings: Record<string, unknown>;
      }
    ).mappings;
    if (
      actualMapping?._meta === undefined ||
      actualMapping._meta === null ||
      typeof actualMapping._meta !== 'object' ||
      (actualMapping._meta as Record<string, unknown>)
        .galileiSearchSchemaVersion !== expectedSchemaVersion
    ) {
      throw new Error('SEARCH_FRESH_V4_TARGET_SCHEMA_MISMATCH');
    }
    if (
      !isDeepStrictEqual(
        normalizeOpenSearchMappingDefaults(actualMapping),
        normalizeOpenSearchMappingDefaults(expectedMapping),
      )
    ) {
      throw new Error('SEARCH_FRESH_V4_CANONICAL_MAPPING_MISMATCH');
    }
  }

  private async assertFreshV4PipelineSetting(index: string) {
    const response = await this.client.indices.getSettings({
      index,
      flat_settings: true,
    });
    const body =
      bodyOf<Record<string, { settings?: Record<string, unknown> }>>(response);
    const settings = body[index]?.settings;
    const nestedIndexSettings = settings?.index;
    const finalPipeline =
      settings?.['index.final_pipeline'] ??
      (nestedIndexSettings && typeof nestedIndexSettings === 'object'
        ? (nestedIndexSettings as Record<string, unknown>).final_pipeline
        : undefined);
    if (finalPipeline !== SEARCH_V4_COLLATION_PIPELINE_ID) {
      throw new Error('SEARCH_FRESH_V4_COLLATION_PIPELINE_SETTING_MISMATCH');
    }
    return this.ensureFreshV4CollationPipeline();
  }

  private async ensureFreshV4CollationPipeline() {
    const path = `/_ingest/pipeline/${SEARCH_V4_COLLATION_PIPELINE_ID}`;
    let existing: Record<string, unknown> | undefined;
    try {
      const response = await this.client.transport.request({
        method: 'GET',
        path,
      });
      existing =
        bodyOf<Record<string, Record<string, unknown>>>(response)[
          SEARCH_V4_COLLATION_PIPELINE_ID
        ];
    } catch (error) {
      if (statusCode(error) !== 404) throw error;
    }
    if (existing) {
      if (!isCanonicalFreshV4Pipeline(existing)) {
        throw new Error('SEARCH_FRESH_V4_COLLATION_PIPELINE_MISMATCH');
      }
      return { created: false, id: SEARCH_V4_COLLATION_PIPELINE_ID };
    }
    await this.client.transport.request({
      method: 'PUT',
      path,
      body: SEARCH_V4_COLLATION_PIPELINE,
    });
    const verifiedResponse = await this.client.transport.request({
      method: 'GET',
      path,
    });
    const verified =
      bodyOf<Record<string, Record<string, unknown>>>(verifiedResponse)[
        SEARCH_V4_COLLATION_PIPELINE_ID
      ];
    if (!verified || !isCanonicalFreshV4Pipeline(verified)) {
      throw new Error(
        'SEARCH_FRESH_V4_COLLATION_PIPELINE_POSTCONDITION_FAILED',
      );
    }
    return { created: true, id: SEARCH_V4_COLLATION_PIPELINE_ID };
  }

  private async expectedIds() {
    const all: string[] = [];
    const corpus: string[] = [];
    const sumarios: string[] = [];
    const sentencias: string[] = [];
    const publishedSentencias: string[] = [];
    await this.repository.withReadSnapshot(async (pg) => {
      let after = '';
      for (;;) {
        const ids = await this.repository.corpusEligibleIdPage(pg, after, 1000);
        if (!ids.length) break;
        corpus.push(...ids);
        after = ids[ids.length - 1];
      }
      let afterSumario = 0;
      for (;;) {
        const ids = await this.repository.jurisprudenciaEligibleIdPage(
          pg,
          afterSumario,
          1000,
        );
        if (!ids.length) break;
        const logicalIds = ids.map((id) => `JURISPRUDENCIA:SUMARIO:${id}`);
        sumarios.push(...logicalIds);
        all.push(...logicalIds);
        afterSumario = ids[ids.length - 1];
      }
      let afterSentencia = 0;
      for (;;) {
        const rows = await this.repository.sentenciaEligibleIdPage(
          pg,
          afterSentencia,
          1000,
        );
        if (!rows.length) break;
        const ids = rows.map((row) => `JURISPRUDENCIA:SENTENCIA:${row.id}`);
        sentencias.push(...ids);
        rows.forEach((row, index) => {
          if (row.publicado && row.estadoCarga === 'PUBLICADA')
            publishedSentencias.push(ids[index]);
        });
        all.push(...ids);
        afterSentencia = rows[rows.length - 1].id;
      }
    });
    all.push(...corpus);
    return { all, corpus, sumarios, sentencias, publishedSentencias };
  }

  private async readAllIds(index: string) {
    const all: string[] = [];
    const corpus: string[] = [];
    const sumarios: string[] = [];
    const sentencias: string[] = [];
    const publishedSentencias: string[] = [];
    let searchAfter: unknown[] | undefined;
    for (;;) {
      const response = await this.client.search({
        index,
        body: {
          size: 1000,
          track_total_hits: true,
          _source: ['sourceSystem', 'sourceType', 'publicationStatus'],
          sort: [{ id: { order: 'asc' } }],
          ...(searchAfter ? { search_after: searchAfter } : {}),
        },
      });
      const body = bodyOf<SearchHitsResponse>(response);
      if (body.hits?.total?.relation !== 'eq')
        throw new Error('SEARCH_VERIFY_NON_EXACT_TOTAL');
      const hits = body.hits.hits ?? [];
      if (!hits.length) break;
      for (const hit of hits) {
        all.push(hit._id);
        if (hit._id.startsWith('JURISPRUDENCIA:SUMARIO:'))
          sumarios.push(hit._id);
        else if (hit._id.startsWith('JURISPRUDENCIA:SENTENCIA:')) {
          sentencias.push(hit._id);
          if (hit._source?.publicationStatus === 'PUBLISHED')
            publishedSentencias.push(hit._id);
        } else corpus.push(hit._id);
      }
      searchAfter = hits[hits.length - 1].sort;
      if (!searchAfter) throw new Error('SEARCH_VERIFY_SORT_VALUE_MISSING');
    }
    return { all, corpus, sumarios, sentencias, publishedSentencias };
  }

  private async resolveKey(
    key: string,
    schemaVersion: SearchIndexSchemaVersion = this.schemaVersion,
  ): Promise<SearchIndexDocument | null> {
    if (key.startsWith('CORPUS:')) {
      const row = await this.repository.getCorpusDocument(
        key.slice('CORPUS:'.length),
      );
      return row ? projectCorpusSearchDocument(row, schemaVersion) : null;
    }
    if (key.startsWith('JURISPRUDENCIA:SUMARIO:')) {
      const id = Number(key.slice('JURISPRUDENCIA:SUMARIO:'.length));
      if (!Number.isSafeInteger(id) || id <= 0)
        throw new Error('SEARCH_OUTBOX_KEY_INVALID');
      const row = await this.repository.getJurisprudenciaDocument(id);
      return row
        ? projectJurisprudenciaSearchDocument(row, schemaVersion)
        : null;
    }
    if (key.startsWith('JURISPRUDENCIA:SENTENCIA:')) {
      const id = Number(key.slice('JURISPRUDENCIA:SENTENCIA:'.length));
      if (!Number.isSafeInteger(id) || id <= 0)
        throw new Error('SEARCH_OUTBOX_KEY_INVALID');
      const row = await this.repository.getSentenciaDocument(id);
      return row ? projectSentenciaSearchDocument(row, schemaVersion) : null;
    }
    throw new Error('SEARCH_OUTBOX_KEY_INVALID');
  }

  private async applyResolutions(
    index: string,
    keys: string[],
    documents: Array<SearchIndexDocument | null>,
  ) {
    const actions: Array<Record<string, unknown>> = [];
    for (let position = 0; position < keys.length; position += 1) {
      const document = documents[position];
      if (document) {
        actions.push({ index: { _index: index, _id: document.id } }, document);
      } else {
        actions.push({
          delete: { _index: index, _id: this.toIndexId(keys[position]) },
        });
      }
    }
    if (!actions.length) return;
    const response = await this.client.bulk({ body: actions });
    const body = bodyOf<{
      errors?: boolean;
      items?: Array<Record<string, { status?: number; error?: unknown }>>;
    }>(response);
    if (body.errors) {
      const failed = (body.items ?? []).some((item) =>
        Object.values(item).some(
          (op) => op.status !== 404 && (op.status ?? 200) >= 300,
        ),
      );
      if (failed) throw createBulkFailure(body.items ?? []);
    }
  }

  private async bulkIndex(index: string, documents: SearchIndexDocument[]) {
    let actions: Array<Record<string, unknown>> = [];
    let bytes = 0;
    const flush = async () => {
      if (!actions.length) return;
      const response = await this.client.bulk({ body: actions });
      const body = bodyOf<{
        errors?: boolean;
        items?: Array<Record<string, { status?: number }>>;
      }>(response);
      if (
        body.errors ||
        body.items?.some((item) =>
          Object.values(item).some((op) => (op.status ?? 200) >= 300),
        )
      ) {
        throw createBulkFailure(body.items ?? []);
      }
      actions = [];
      bytes = 0;
    };
    for (const document of documents) {
      const action = { index: { _index: index, _id: document.id } };
      const documentBytes =
        Buffer.byteLength(JSON.stringify(action)) +
        Buffer.byteLength(JSON.stringify(document)) +
        2;
      if (actions.length && bytes + documentBytes > BULK_LIMIT_BYTES)
        await flush();
      actions.push(action, document);
      bytes += documentBytes;
    }
    await flush();
  }

  private async swapAlias(index: string) {
    const current = await this.aliasTargets();
    const actions = buildAtomicAliasSwapActions(
      current,
      index,
      this.alias,
      this.indexPrefix,
      this.schemaVersion,
    );
    await this.client.indices.updateAliases({ body: { actions } });
    const promotedTargets = await this.aliasTargets();
    if (promotedTargets.length !== 1 || promotedTargets[0] !== index) {
      throw new Error('SEARCH_ALIAS_PROMOTION_POSTCONDITION_FAILED');
    }
  }

  private async activePhysicalIndex(): Promise<string | null> {
    return resolveManagedAliasTarget(
      await this.aliasTargets(),
      this.indexPrefix,
    );
  }

  private async aliasTargets(): Promise<string[]> {
    try {
      const response = await this.client.indices.getAlias({ name: this.alias });
      const body = bodyOf<Record<string, unknown>>(response);
      return Object.keys(body);
    } catch (error) {
      if (statusCode(error) === 404) return [];
      throw error;
    }
  }

  private async indexExists(index: string) {
    const response = await this.client.indices.exists({ index });
    return bodyOf<boolean>(response);
  }

  private assertMutable(operation: string) {
    if (this.readOnlyCandidate)
      throw new Error(`OPENSEARCH_READ_ONLY_CANDIDATE_${operation}_REJECTED`);
    if (
      this.schemaVersion === 4 &&
      !this.trustedPhysicalWriter &&
      !this.allowSchema4AliasWriter
    ) {
      throw new Error(
        `OPENSEARCH_V4_WRITER_${operation}_REQUIRES_OPERATOR_MODE`,
      );
    }
    if (this.searchTarget !== this.alias && !this.trustedPhysicalWriter) {
      throw new Error(
        `OPENSEARCH_PHYSICAL_WRITER_${operation}_REQUIRES_OPERATOR_MODE`,
      );
    }
  }

  private isPhysicalIndex(index: string, schemaVersion: number) {
    const escapedPrefix = this.indexPrefix.replace(
      /[.*+?^${}()|[\]\\]/gu,
      '\\$&',
    );
    return new RegExp(
      `^${escapedPrefix}-v${String(schemaVersion).padStart(3, '0')}-\\d{8}t\\d{9}z-[a-f0-9]{8}$`,
      'u',
    ).test(index);
  }

  private toIndexId(key: string) {
    return key.startsWith('CORPUS:') ? key.slice('CORPUS:'.length) : key;
  }
}

function parseOutboxWatermark(value: string) {
  if (!/^(?:0|[1-9]\d{0,18})$/u.test(value)) {
    throw new Error('SEARCH_OUTBOX_WATERMARK_INVALID');
  }
  const parsed = BigInt(value);
  if (parsed > 9_223_372_036_854_775_807n) {
    throw new Error('SEARCH_OUTBOX_WATERMARK_INVALID');
  }
  return parsed;
}

function bodyOf<T>(response: unknown): T {
  return response && typeof response === 'object' && 'body' in response
    ? (response as { body: T }).body
    : (response as T);
}

function createBulkFailure(
  items: Array<Record<string, { status?: number; error?: unknown }>>,
) {
  const failures = items.flatMap((item) =>
    Object.values(item).flatMap((operation) => {
      if ((operation.status ?? 200) < 300) return [];
      const queue = [operation.error];
      const types = new Set<string>();
      const fields = new Set<string>();
      const categories = new Set<string>();
      while (queue.length) {
        const value = queue.pop();
        if (typeof value !== 'object' || value === null) continue;
        const error = value as {
          type?: unknown;
          reason?: unknown;
          caused_by?: unknown;
          root_cause?: unknown;
        };
        if (
          typeof error.type === 'string' &&
          /^[a-z0-9_]{1,80}$/iu.test(error.type)
        ) {
          types.add(error.type);
        }
        const reason = typeof error.reason === 'string' ? error.reason : '';
        const field = reason.match(
          /(?:field|property) \[([^\]]{1,120})\]/iu,
        )?.[1];
        if (field) fields.add(field);
        if (/failed to parse|cannot parse/iu.test(reason))
          categories.add('parse');
        else if (/unknown parameter|unknown setting/iu.test(reason))
          categories.add('unknown-parameter');
        else if (/strict_dynamic_mapping|mapping.*not allowed/iu.test(reason))
          categories.add('strict-mapping');
        else if (/content.?type|media type/iu.test(reason))
          categories.add('content-type');
        else if (/no handler|unsupported operation/iu.test(reason))
          categories.add('unsupported-operation');
        else if (reason) categories.add('other');
        if (error.caused_by) queue.push(error.caused_by);
        if (Array.isArray(error.root_cause)) queue.push(...error.root_cause);
      }
      return [
        {
          status: Number(operation.status ?? 0),
          types: [...types].slice(0, 4),
          categories: [...categories].slice(0, 4),
          fields: [...fields].slice(0, 4),
        },
      ];
    }),
  );
  const unique = [
    ...new Map(
      failures.map((failure) => [JSON.stringify(failure), failure]),
    ).values(),
  ].slice(0, 5);
  const error = new Error('SEARCH_INDEX_BULK_FAILED') as Error & {
    safeDetails?: { failedOperations: number; samples: typeof unique };
  };
  error.safeDetails = { failedOperations: failures.length, samples: unique };
  return error;
}

function isCanonicalFreshV4Pipeline(value: Record<string, unknown>) {
  return (
    value.description === SEARCH_V4_COLLATION_PIPELINE.description &&
    isDeepStrictEqual(value.processors, SEARCH_V4_COLLATION_PIPELINE.processors)
  );
}

function statusCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : 0;
}

function hashIds(ids: Set<string>) {
  return createHash('sha256')
    .update([...ids].sort().join('\n'))
    .digest('hex');
}

function parseIndexDate(index: string) {
  const match = index.match(/v\d{3}-(\d{8}t\d{9}z)-/u);
  if (!match) return new Date(0);
  const stamp = match[1];
  return new Date(
    `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}.${stamp.slice(15, 18)}Z`,
  );
}

import { createHash, randomUUID } from 'node:crypto';
import type { Client } from '@opensearch-project/opensearch';
import { OpenSearchDocumentRepository } from './opensearch-document.repository';
import {
  SEARCH_INDEX_DEFINITIONS,
  SEARCH_INDEX_SCHEMA_VERSION,
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

      await this.repository.withReadSnapshot(async (pg) => {
        let after = '';
        for (;;) {
          const rows = await this.repository.corpusPage(pg, after, 500);
          if (!rows.length) break;
          const docs = rows.map((row) =>
            projectCorpusSearchDocument(row, this.schemaVersion),
          );
          await this.bulkIndex(physicalIndex, docs);
          indexedCorpus += docs.length;
          after = rows[rows.length - 1].id;
        }
        let afterSumario = 0;
        for (;;) {
          const rows = await this.repository.jurisprudenciaPage(
            pg,
            afterSumario,
            500,
          );
          if (!rows.length) break;
          const docs = rows
            .map((row) =>
              projectJurisprudenciaSearchDocument(row, this.schemaVersion),
            )
            .filter((doc): doc is SearchIndexDocument => doc !== null);
          await this.bulkIndex(physicalIndex, docs);
          indexedJurisprudencia += docs.length;
          afterSumario = rows[rows.length - 1].id;
        }
        let afterSentencia = 0;
        for (;;) {
          const rows = await this.repository.sentenciaPage(
            pg,
            afterSentencia,
            500,
          );
          if (!rows.length) break;
          const docs = rows
            .map((row) =>
              projectSentenciaSearchDocument(row, this.schemaVersion),
            )
            .filter((doc): doc is SearchIndexDocument => doc !== null);
          await this.bulkIndex(physicalIndex, docs);
          indexedSentencias += docs.length;
          afterSentencia = rows[rows.length - 1].id;
        }
      });

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
      if (failed) throw new Error('SEARCH_INDEX_BULK_FAILED');
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
        throw new Error('SEARCH_INDEX_BULK_FAILED');
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
    if (this.schemaVersion === 4 && !this.trustedPhysicalWriter) {
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

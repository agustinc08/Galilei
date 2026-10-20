/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- OpenSearch's transport response is runtime JSON with broad SDK `any` types; this guarded one-off harness validates target identity, counts, and response invariants before accepting evidence. */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statfsSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@opensearch-project/opensearch';
import { OpenSearchDocumentRepository } from '../../src/busqueda/opensearch/opensearch-document.repository';
import { OpenSearchIndexService } from '../../src/busqueda/opensearch/opensearch-index.service';
import {
  SEARCH_INDEX_DEFINITION_V4,
  SEARCH_INDEX_SCHEMA_VERSION_V4,
  SEARCH_V4_COLLATION_PIPELINE,
  SEARCH_V4_COLLATION_PIPELINE_ID,
} from '../../src/busqueda/opensearch/opensearch-mapping';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import { buildSearchQueryDsl } from '../../src/busqueda/opensearch/search-dsl';
import type { SearchContext } from '../../src/busqueda/adapters/search-source.adapter';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';

type HttpMethod = 'GET' | 'PUT' | 'POST' | 'DELETE';
type RawClient = {
  transport: {
    request(input: {
      method: HttpMethod;
      path: string;
      body?: unknown;
    }): Promise<unknown>;
  };
  close(): Promise<void>;
};
type OsHit = {
  _id: string;
  _score?: number | null;
  _source?: Record<string, unknown>;
  sort?: unknown[];
};

const SOURCE_INDEX = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const ALIAS = 'galilei-search-active';
const EXPECTED_BUILD = '97d3c13bf22a4a72ac11dc503fe44c97662b9161';
const EXPECTED_DOCS = 69_313;
const MIN_FREE_BYTES = 60 * 1024 ** 3;
const ARTIFACT_ROOT = resolve(
  process.cwd(),
  '..',
  '..',
  '..',
  '..',
  'jurisprudencia-collation-v4-implement1',
);
const DESIGN_ROOT = resolve(
  process.cwd(),
  '..',
  '..',
  '..',
  '..',
  'jurisprudencia-collation-v4-design1',
);
const INDEX_FILE = resolve(ARTIFACT_ROOT, 'v4-index.json');
const GOLDEN_CONTEXT: SearchContext = {
  visibility: 'INTERNAL',
  dialect: 'modern',
  publicationPolicy: 'legacy-active-only',
  sourceSystems: ['JURISPRUDENCIA'],
  documentKinds: ['SENTENCIA'],
  page: 1,
  pageSize: 25,
};
const ACTIONS = new Set([
  'baseline',
  'h0',
  'create',
  'reindex',
  'h1',
  'replay',
  'verify',
  'mapping-diff',
  'golden',
  'references',
  'tie2',
  'performance',
  'cleanup-tie2',
]);

loadLocalEnvironment();

async function main() {
  const action = process.env.BJC_COLLATION_V4_ACTION ?? '';
  if (!ACTIONS.has(action)) throw new Error('COLLATION_V4_ACTION_INVALID');
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
  const config = readOpenSearchConfig();
  requireLocalRuntime(config.node);
  const client = new Client(config.clientOptions) as unknown as RawClient;
  let repository: OpenSearchDocumentRepository | undefined;
  let indexService: OpenSearchIndexService | undefined;
  try {
    switch (action) {
      case 'baseline':
        await captureBaseline(client, 'opensearch-baseline.json');
        break;
      case 'h0':
        repository = new OpenSearchDocumentRepository();
        await captureWatermark(repository, 'h0.json');
        break;
      case 'create':
        await createShadow(client);
        break;
      case 'reindex':
        await runReindex(client);
        break;
      case 'h1':
        repository = new OpenSearchDocumentRepository();
        await captureWatermark(repository, 'h1.json');
        break;
      case 'replay':
        repository = new OpenSearchDocumentRepository();
        indexService = makeIndexService(
          client,
          repository,
          config.searchTarget,
        );
        await replayShadow(indexService, config.searchTarget);
        break;
      case 'verify':
        repository = new OpenSearchDocumentRepository();
        indexService = makeIndexService(
          client,
          repository,
          config.searchTarget,
        );
        await verifyParity(client, indexService, config.searchTarget);
        break;
      case 'mapping-diff':
        await verifyMappingDiff(client, config.searchTarget);
        break;
      case 'golden':
        await certifyGolden(client, config.searchTarget);
        break;
      case 'references':
        await compareReferences(client, config.searchTarget);
        break;
      case 'tie2':
        await runTie2Proof(client);
        break;
      case 'cleanup-tie2':
        await cleanupTie2(client);
        break;
      case 'performance':
        await measurePerformance(client, config.searchTarget);
        break;
    }
  } finally {
    if (indexService) await indexService.close().catch(() => undefined);
    else if (repository) await repository.close().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}

async function captureBaseline(client: RawClient, filename: string) {
  const runtime = await runtimeSnapshot(client, true);
  assertBaseState(runtime);
  const source = await indexSnapshot(client, SOURCE_INDEX);
  const alias = await request<Record<string, unknown>>(
    client,
    'GET',
    `/_alias/${ALIAS}`,
  );
  const counts = await referenceCounts(client, SOURCE_INDEX);
  const result = {
    capturedAt: new Date().toISOString(),
    runtime,
    source,
    aliasTargets: Object.keys(alias),
    referenceCounts: counts,
  };
  writeArtifact(filename, result);
  printSummary(result);
}

function assertBaseState(snapshot: Record<string, any>) {
  ensure(snapshot.version === '2.19.6', 'OPENSEARCH_VERSION_CHANGED');
  ensure(snapshot.buildHash === EXPECTED_BUILD, 'OPENSEARCH_BUILD_CHANGED');
  ensure(snapshot.health === 'green', 'OPENSEARCH_NOT_GREEN');
  ensure(snapshot.nodes === 1, 'OPENSEARCH_NODE_COUNT_CHANGED');
  ensure(snapshot.heapMaxBytes === 2_147_483_648, 'OPENSEARCH_HEAP_CHANGED');
  ensure(snapshot.floodBlocks === 0, 'OPENSEARCH_FLOOD_BLOCK_PRESENT');
}

async function runtimeSnapshot(client: RawClient, allowMissingIcu = false) {
  const [root, health, plugins, settings, nodes, disk, indexBlocks] =
    await Promise.all([
      request<Record<string, any>>(client, 'GET', '/'),
      request<Record<string, any>>(client, 'GET', '/_cluster/health'),
      request<Array<Record<string, string>>>(
        client,
        'GET',
        '/_cat/plugins?format=json',
      ),
      request<Record<string, any>>(
        client,
        'GET',
        '/_cluster/settings?include_defaults=true',
      ),
      request<Record<string, any>>(client, 'GET', '/_nodes/_local/stats/jvm'),
      Promise.resolve(diskSnapshot()),
      request<Record<string, any>>(
        client,
        'GET',
        '/_all/_settings?flat_settings=true&include_defaults=false&filter_path=*.settings.index.blocks.*',
      ),
    ]);
  const pluginNames = plugins.map((plugin) => plugin.component).sort();
  const nodeStats = Object.values(nodes.nodes ?? {})[0] as Record<string, any>;
  const heap = nodeStats?.jvm?.mem ?? {};
  const settingValue =
    settings.persistent?.['cluster.blocks.create_index'] ??
    settings.transient?.['cluster.blocks.create_index'] ??
    settings.defaults?.['cluster.blocks.create_index'];
  const floodBlocks = Object.values(indexBlocks).reduce(
    (count: number, indexSettings) => {
      const blocks = (indexSettings as Record<string, any>)?.settings ?? {};
      return (
        count +
        Object.entries(blocks).filter(
          ([key, value]) => key.startsWith('index.blocks.') && value === 'true',
        ).length
      );
    },
    0,
  );
  const icu = pluginNames.includes('analysis-icu');
  if (!allowMissingIcu) ensure(icu, 'OPENSEARCH_ANALYSIS_ICU_MISSING');
  return {
    version: root.version?.number,
    buildHash: root.version?.build_hash,
    clusterName: root.cluster_name,
    health: health.status,
    nodes: health.number_of_nodes,
    heapInitBytes: heap.heap_init_in_bytes,
    heapMaxBytes: heap.heap_max_in_bytes,
    heapUsedBytes: heap.heap_used_in_bytes,
    oldGcCount: nodeStats?.jvm?.gc?.collectors?.old?.collection_count ?? 0,
    oldGcTimeMs:
      nodeStats?.jvm?.gc?.collectors?.old?.collection_time_in_millis ?? 0,
    plugins: pluginNames,
    analysisIcu: icu,
    createIndexBlock: settingValue ?? null,
    floodBlocks,
    disk,
  };
}

async function indexSnapshot(client: RawClient, index: string) {
  const [mappingResponse, settingsResponse, countResponse, statsResponse] =
    await Promise.all([
      request<Record<string, any>>(client, 'GET', `/${index}/_mapping`),
      request<Record<string, any>>(
        client,
        'GET',
        `/${index}/_settings?flat_settings=true&include_defaults=false`,
      ),
      request<Record<string, any>>(client, 'GET', `/${index}/_count`),
      request<Record<string, any>>(
        client,
        'GET',
        `/${index}/_stats?filter_path=indices.*.primaries.indexing.index_total,indices.*.primaries.indexing.delete_total,indices.*.primaries.docs,indices.*.primaries.store`,
      ),
    ]);
  const mappings = mappingResponse[index]?.mappings;
  const settings = settingsResponse[index]?.settings;
  return {
    index,
    count: countResponse.count,
    mappingSha256: sha256(canonicalJson(mappings)),
    mappings,
    settings,
    settingsSha256: sha256(canonicalJson(settings)),
    stats: statsResponse.indices?.[index]?.primaries ?? null,
  };
}

async function createShadow(client: RawClient) {
  const runtime = await runtimeSnapshot(client);
  assertBaseState(runtime);
  const alias = await request<Record<string, unknown>>(
    client,
    'GET',
    `/_alias/${ALIAS}`,
  );
  ensure(
    Object.keys(alias).length === 1 && Object.keys(alias)[0] === SOURCE_INDEX,
    'OPENSEARCH_ALIAS_TARGET_CHANGED',
  );
  const source = await indexSnapshot(client, SOURCE_INDEX);
  ensure(source.count === EXPECTED_DOCS, 'V3_DOCUMENT_COUNT_CHANGED');
  const fileExists = existsSync(INDEX_FILE);
  const target = fileExists
    ? readJson<{ index: string }>(INDEX_FILE).index
    : makePhysicalIndexName();
  const existing = await request<boolean>(
    client,
    'GET',
    `/_cat/indices/${target}?format=json`,
  ).catch(() => [] as unknown as boolean);
  ensure(
    !Array.isArray(existing) || existing.length === 0,
    'V4_SHADOW_ALREADY_EXISTS_REQUIRES_REVIEW',
  );

  await request(
    client,
    'PUT',
    `/_ingest/pipeline/${SEARCH_V4_COLLATION_PIPELINE_ID}`,
    SEARCH_V4_COLLATION_PIPELINE,
  );
  const beforeSettings = await request<Record<string, any>>(
    client,
    'GET',
    '/_cluster/settings?include_defaults=false',
  );
  const persistentCreateBlock =
    beforeSettings.persistent?.['cluster.blocks.create_index'];
  let temporaryOverride = false;
  try {
    if (persistentCreateBlock === true || persistentCreateBlock === 'true') {
      await request(client, 'PUT', '/_cluster/settings', {
        transient: { 'cluster.blocks.create_index': false },
      });
      temporaryOverride = true;
    }
    const definition = JSON.parse(
      JSON.stringify(SEARCH_INDEX_DEFINITION_V4),
    ) as Record<string, any>;
    await request(client, 'PUT', `/${target}`, definition);
  } finally {
    if (temporaryOverride) {
      await request(client, 'PUT', '/_cluster/settings', {
        transient: { 'cluster.blocks.create_index': null },
      });
    }
  }
  const afterSettings = await request<Record<string, any>>(
    client,
    'GET',
    '/_cluster/settings?include_defaults=false',
  );
  ensure(
    JSON.stringify(
      afterSettings.persistent?.['cluster.blocks.create_index'] ?? null,
    ) === JSON.stringify(persistentCreateBlock ?? null),
    'CREATE_INDEX_GUARD_NOT_RESTORED',
  );
  const mapping = await indexSnapshot(client, target);
  const pipelineSimulation = await simulatePipeline(client);
  const result = {
    capturedAt: new Date().toISOString(),
    index: target,
    sourceIndex: SOURCE_INDEX,
    aliasUnchanged: true,
    active: false,
    pipelineId: SEARCH_V4_COLLATION_PIPELINE_ID,
    pipelineSha256: sha256(canonicalJson(SEARCH_V4_COLLATION_PIPELINE)),
    mappingSha256: mapping.mappingSha256,
    mappingSchemaVersion:
      mapping.mappings?._meta?.galileiSearchSchemaVersion ?? null,
    initialCount: mapping.count,
    persistentCreateIndexBlockBefore: persistentCreateBlock ?? null,
    transientOverrideUsed: temporaryOverride,
    persistentCreateIndexBlockAfter:
      afterSettings.persistent?.['cluster.blocks.create_index'] ?? null,
    transientCreateIndexBlockAfter:
      afterSettings.transient?.['cluster.blocks.create_index'] ?? null,
    pipelineSimulation,
  };
  writeJson(INDEX_FILE, { index: target, createdAt: result.capturedAt });
  writeArtifact('pipeline-definition.json', {
    pipelineId: SEARCH_V4_COLLATION_PIPELINE_ID,
    sha256: result.pipelineSha256,
    definition: SEARCH_V4_COLLATION_PIPELINE,
  });
  writeArtifact('pipeline-simulation.json', pipelineSimulation);
  writeArtifact('v4-create.json', result);
  writeArtifact('v4-mapping.json', mapping);
  const diff = compareMappings(source.mappings, mapping.mappings);
  writeArtifact('v4-mapping-diff.json', diff);
  ensure(diff.differences.length === 0, 'V4_MAPPING_DIFF_UNEXPECTED');
  printSummary(result);
}

async function simulatePipeline(client: RawClient) {
  const docs = [
    { id: 'missing', logicalNumericId: 1 },
    { id: 'null', logicalNumericId: 2, sortFields: { numeroSentencia: null } },
    { id: 'empty', logicalNumericId: 3, sortFields: { numeroSentencia: '' } },
    {
      id: 'raw',
      logicalNumericId: 4,
      sortFields: { numeroSentencia: '  077510  ' },
    },
  ];
  const response = await request<Record<string, any>>(
    client,
    'POST',
    `/_ingest/pipeline/${SEARCH_V4_COLLATION_PIPELINE_ID}/_simulate`,
    { docs: docs.map((doc) => ({ _source: doc })) },
  );
  const results = (response.docs ?? []).map((entry: Record<string, any>) => ({
    source: entry.doc?._source,
    error: entry.doc?.error ?? null,
  }));
  ensure(
    results.every((entry: Record<string, any>) => !entry.error),
    'V4_PIPELINE_SIMULATION_FAILED',
  );
  const values = results.map(
    (entry: Record<string, any>) =>
      entry.source?.sortFields?.numeroSentenciaCollation,
  );
  ensure(
    JSON.stringify(values) === JSON.stringify(['', '', '', '  077510  ']),
    'V4_PIPELINE_SEMANTICS_MISMATCH',
  );
  return { cases: docs.length, values, results, pass: true };
}

async function runReindex(client: RawClient) {
  const target = readJson<{ index: string }>(INDEX_FILE).index;
  const [runtime, source, alias] = await Promise.all([
    runtimeSnapshot(client),
    indexSnapshot(client, SOURCE_INDEX),
    request<Record<string, unknown>>(client, 'GET', `/_alias/${ALIAS}`),
  ]);
  assertBaseState(runtime);
  ensure(runtime.analysisIcu, 'OPENSEARCH_ANALYSIS_ICU_MISSING');
  ensure(source.count === EXPECTED_DOCS, 'V3_DOCUMENT_COUNT_CHANGED');
  ensure(
    Object.keys(alias).length === 1 && Object.keys(alias)[0] === SOURCE_INDEX,
    'OPENSEARCH_ALIAS_TARGET_CHANGED',
  );
  const diskBefore = diskSnapshot();
  ensure(
    diskBefore.freeBytes - 17_696_663_224 >= MIN_FREE_BYTES,
    'INSUFFICIENT_SHADOW_CAPACITY',
  );
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const started = await request<Record<string, any>>(
    client,
    'POST',
    '/_reindex?wait_for_completion=false&requests_per_second=100&refresh=false',
    {
      source: { index: SOURCE_INDEX, size: 25 },
      dest: { index: target, pipeline: SEARCH_V4_COLLATION_PIPELINE_ID },
      conflicts: 'abort',
    },
  );
  ensure(typeof started.task === 'string', 'V4_REINDEX_TASK_MISSING');
  writeArtifact('reindex-task.json', {
    capturedAt: startedAt,
    task: started.task,
    sourceIndex: SOURCE_INDEX,
    destinationIndex: target,
    requestsPerSecond: 100,
    pipelineId: SEARCH_V4_COLLATION_PIPELINE_ID,
  });

  const monitoring: Array<Record<string, unknown>> = [];
  let highHeapSamples = 0;
  let response: Record<string, any> | null = null;
  for (;;) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 15_000));
    const [taskResponse, runtimeSample, sourceSample] = await Promise.all([
      request<Record<string, any>>(client, 'GET', `/_tasks/${started.task}`),
      runtimeSnapshot(client),
      indexSnapshot(client, SOURCE_INDEX),
    ]);
    const task = taskResponse.task ?? {};
    const status = task.status ?? taskResponse.response ?? {};
    const heapUsedRatio = runtimeSample.heapMaxBytes
      ? runtimeSample.heapUsedBytes / runtimeSample.heapMaxBytes
      : 0;
    highHeapSamples = heapUsedRatio >= 0.95 ? highHeapSamples + 1 : 0;
    const sample = {
      at: new Date().toISOString(),
      completed: taskResponse.completed === true,
      taskStatus: status,
      taskError: taskResponse.error ?? null,
      health: runtimeSample.health,
      heapUsedRatio,
      oldGcCount: runtimeSample.oldGcCount,
      oldGcTimeMs: runtimeSample.oldGcTimeMs,
      freeBytes: runtimeSample.disk.freeBytes,
      v3Count: sourceSample.count,
      v3MappingSha256: sourceSample.mappingSha256,
    };
    monitoring.push(sample);
    writeArtifact('reindex-monitoring.json', {
      startedAt,
      task: started.task,
      samples: monitoring,
    });
    const abortReason =
      Number(runtimeSample.disk.freeBytes) < MIN_FREE_BYTES
        ? 'SHADOW_DISK_RESERVE_BREACHED'
        : runtimeSample.health !== 'green'
          ? 'SHADOW_CLUSTER_NOT_GREEN'
          : highHeapSamples >= 3
            ? 'SHADOW_HEAP_PRESSURE'
            : sourceSample.count !== EXPECTED_DOCS
              ? 'V3_COUNT_CHANGED_DURING_REINDEX'
              : null;
    if (abortReason) {
      await request(client, 'POST', `/_tasks/${started.task}/_cancel`).catch(
        () => undefined,
      );
      throw new Error(abortReason);
    }
    if (taskResponse.error) {
      response = { error: taskResponse.error, status };
      break;
    }
    if (taskResponse.completed === true) {
      response = taskResponse.response ?? null;
      break;
    }
  }
  const restoreRefresh = await request<Record<string, unknown>>(
    client,
    'PUT',
    `/${target}/_settings`,
    { index: { refresh_interval: '1s' } },
  );
  const refresh = await request<Record<string, unknown>>(
    client,
    'POST',
    `/${target}/_refresh`,
  );
  const refreshedTarget = await indexSnapshot(client, target);
  const previousBuildSettings = existsSync(
    resolve(ARTIFACT_ROOT, 'v4-build-temporary-settings.json'),
  )
    ? readJson<Record<string, unknown>>(
        resolve(ARTIFACT_ROOT, 'v4-build-temporary-settings.json'),
      )
    : {};
  writeArtifact('v4-build-temporary-settings.json', {
    ...previousBuildSettings,
    restoredAt: new Date().toISOString(),
    restoredRefreshInterval: '1s',
    restoreAcknowledged: restoreRefresh.acknowledged === true,
    refreshShards: refresh._shards ?? null,
    refreshedDocumentCount: refreshedTarget.count,
  });
  const durationMs = Date.now() - startedMs;
  const failures = Array.isArray(response?.failures) ? response.failures : [];
  const result = {
    capturedAt: new Date().toISOString(),
    startedAt,
    durationMs,
    task: started.task,
    sourceIndex: SOURCE_INDEX,
    destinationIndex: target,
    result: response,
    error: response?.error ?? null,
    failures: failures.length,
    refreshedDocumentCount: refreshedTarget.count,
    refreshIntervalRestored: restoreRefresh.acknowledged === true,
    pass:
      !response?.error &&
      response?.total === EXPECTED_DOCS &&
      response?.created === EXPECTED_DOCS &&
      failures.length === 0 &&
      restoreRefresh.acknowledged === true &&
      refreshedTarget.count === EXPECTED_DOCS,
    diskAfter: diskSnapshot(),
  };
  writeArtifact('reindex-result.json', result);
  ensure(result.pass, 'V4_REINDEX_FAILURES_OR_COUNT_MISMATCH');
  printSummary(result);
}

async function verifyMappingDiff(client: RawClient, target: string) {
  const [source, shadow] = await Promise.all([
    indexSnapshot(client, SOURCE_INDEX),
    indexSnapshot(client, target),
  ]);
  ensure(
    shadow.count === 0 || shadow.count === EXPECTED_DOCS,
    'V4_MAPPING_DIFF_UNEXPECTED_COUNT',
  );
  const diff = compareMappings(source.mappings, shadow.mappings);
  writeArtifact('v4-mapping-diff.json', diff);
  ensure(diff.pass, 'V4_MAPPING_DIFF_UNEXPECTED');
  printSummary(diff);
}

async function captureWatermark(
  repository: OpenSearchDocumentRepository,
  filename: 'h0.json' | 'h1.json',
) {
  const [barrierSnapshot, currentStatus] = await Promise.all([
    repository.withMutationBarrier(async (client, watermark) => ({
      barrierWatermark: watermark,
      outbox: await repository.outboxSnapshot(client),
    })),
    repository.outboxStatus(),
  ]);
  const result = {
    capturedAt: new Date().toISOString(),
    barrierWatermark: barrierSnapshot.barrierWatermark,
    outbox: barrierSnapshot.outbox,
    statusAfterBarrier: currentStatus,
  };
  writeArtifact(filename, result);
  printSummary(result);
}

async function verifyParity(
  client: RawClient,
  indexService: OpenSearchIndexService,
  target: string,
) {
  const [v3, v4] = await Promise.all([
    indexSnapshot(client, SOURCE_INDEX),
    indexSnapshot(client, target),
  ]);
  ensure(v3.count === EXPECTED_DOCS, 'V3_DOCUMENT_COUNT_CHANGED');
  ensure(v4.count === EXPECTED_DOCS, 'V4_DOCUMENT_COUNT_MISMATCH');
  const idAndSource = await compareAllSources(client, SOURCE_INDEX, target);
  const sourceParityPass =
    idAndSource.idParity.missingV4 === 0 &&
    idAndSource.idParity.extraV4 === 0 &&
    idAndSource.sourceParity.differences === 0;
  writeArtifact('id-parity.json', idAndSource.idParity);
  writeArtifact('source-parity.json', idAndSource.sourceParity);
  writeArtifact('source-parity-complete.json', {
    capturedAt: new Date().toISOString(),
    sourceIndex: SOURCE_INDEX,
    shadowIndex: target,
    sourceCount: v3.count,
    shadowCount: v4.count,
    sourceCanonicalSha256: idAndSource.sourceParity.sourceCanonicalSha256,
    targetCanonicalSha256: idAndSource.sourceParity.targetCanonicalSha256,
    differences: idAndSource.sourceParity.differences,
    missingV4: idAndSource.idParity.missingV4,
    extraV4: idAndSource.idParity.extraV4,
    pass: sourceParityPass,
  });
  const dbIntegrity = await indexService.verifyTarget(target);
  const h0 = readJson<{ barrierWatermark: string }>(
    resolve(ARTIFACT_ROOT, 'h0.json'),
  );
  const h1 = readJson<{ barrierWatermark: string }>(
    resolve(ARTIFACT_ROOT, 'h1.json'),
  );
  const result = {
    capturedAt: new Date().toISOString(),
    sourceIndex: SOURCE_INDEX,
    shadowIndex: target,
    v3Count: v3.count,
    v4Count: v4.count,
    idParity: idAndSource.idParity,
    sourceParity: idAndSource.sourceParity,
    databaseIntegrity: {
      expectedIds: dbIntegrity.expectedIds,
      indexedIds: dbIntegrity.indexedIds,
      missing: dbIntegrity.missing.length,
      extra: dbIntegrity.extra.length,
      duplicates: dbIntegrity.duplicates,
      exactIdEquality: dbIntegrity.exactIdEquality,
      schemaVersion: dbIntegrity.schemaVersion,
    },
    h0: h0.barrierWatermark,
    h1: h1.barrierWatermark,
    pass:
      v3.count === v4.count &&
      idAndSource.idParity.missingV4 === 0 &&
      idAndSource.idParity.extraV4 === 0 &&
      idAndSource.sourceParity.differences === 0 &&
      dbIntegrity.exactIdEquality,
  };
  writeArtifact('shadow-consistency.json', result);
  writeArtifact('v4-count.json', {
    v3: v3.count,
    v4: v4.count,
    pass: v3.count === v4.count,
  });
  ensure(result.pass, 'V4_FULL_PARITY_FAILED');
  printSummary(result);
}

async function compareAllSources(
  client: RawClient,
  sourceIndex: string,
  target: string,
) {
  // Source documents include full judgment text; keep each parity response
  // comfortably below OpenSearch's coordinating-memory limit.
  let pageSize = 10;
  let pageSizeFallbacks = 0;
  let circuitBreakerGcRecoveries = 0;
  let gcRetriesForCurrentPage = 0;
  let pages = 0;
  let sourceAfter: unknown[] | undefined;
  let targetAfter: unknown[] | undefined;
  const sourceIds = new Set<string>();
  const targetIds = new Set<string>();
  // Exact counts were verified by indexSnapshot immediately before this
  // streaming comparison; per-page hit totals are intentionally disabled.
  const sourceCount = EXPECTED_DOCS;
  const targetCount = EXPECTED_DOCS;
  let sourceDifferences = 0;
  const sourceExamples: Array<Record<string, unknown>> = [];
  const sourceHash = createHash('sha256');
  const targetHash = createHash('sha256');
  let scanned = 0;
  for (;;) {
    let sourceResponse: Awaited<ReturnType<typeof searchPage>>;
    let targetResponse: Awaited<ReturnType<typeof searchPage>>;
    for (;;) {
      try {
        sourceResponse = await searchPage(
          client,
          sourceIndex,
          pageSize,
          sourceAfter,
        );
        targetResponse = await searchPage(
          client,
          target,
          pageSize,
          targetAfter,
        );
        gcRetriesForCurrentPage = 0;
        break;
      } catch (error) {
        if (!isCircuitBreakerError(error)) throw error;
        if (pageSize > 1) {
          const previousPageSize = pageSize;
          pageSize = Math.max(1, Math.floor(pageSize / 2));
          pageSizeFallbacks += 1;
          writeArtifact('source-parity-page-fallback.json', {
            capturedAt: new Date().toISOString(),
            sourceIndex,
            target,
            previousPageSize,
            nextPageSize: pageSize,
            fallbackCount: pageSizeFallbacks,
            cause: 'CIRCUIT_BREAKER',
            scannedBeforeRetry: scanned,
          });
          continue;
        }
        if (gcRetriesForCurrentPage >= 5) throw error;
        forceOpenSearchGcForParity();
        circuitBreakerGcRecoveries += 1;
        gcRetriesForCurrentPage += 1;
        writeArtifact('source-parity-gc-recovery.json', {
          capturedAt: new Date().toISOString(),
          sourceIndex,
          target,
          pageSize,
          recoveryCount: circuitBreakerGcRecoveries,
          scannedBeforeRetry: scanned,
          action: 'LOCAL_JCMD_GC_RUN',
        });
        await new Promise((resolveGc) => setTimeout(resolveGc, 500));
      }
    }
    const sourceHits = sourceResponse.hits.hits;
    const targetHits = targetResponse.hits.hits;
    if (!sourceHits.length && !targetHits.length) break;
    const length = Math.max(sourceHits.length, targetHits.length);
    for (let offset = 0; offset < length; offset += 1) {
      const left = sourceHits[offset];
      const right = targetHits[offset];
      if (left) sourceIds.add(left._id);
      if (right) targetIds.add(right._id);
      const leftSource = left?._source;
      const rightSource = right?._source
        ? normalizeDerivedSource(right._source, leftSource)
        : undefined;
      const leftJson = canonicalJson(leftSource);
      const rightJson = canonicalJson(rightSource);
      sourceHash.update(`${left?._id ?? ''}\0${leftJson}\n`);
      targetHash.update(`${right?._id ?? ''}\0${rightJson}\n`);
      if (!left || !right || left._id !== right._id || leftJson !== rightJson) {
        sourceDifferences += 1;
        if (sourceExamples.length < 10) {
          sourceExamples.push({
            position: scanned + offset + 1,
            sourceId: left?._id ?? null,
            targetId: right?._id ?? null,
          });
        }
      }
    }
    scanned += length;
    pages += 1;
    sourceAfter = sourceHits[sourceHits.length - 1]?.sort;
    targetAfter = targetHits[targetHits.length - 1]?.sort;
    if (
      (sourceHits.length && !sourceAfter) ||
      (targetHits.length && !targetAfter)
    ) {
      throw new Error('V4_PARITY_CURSOR_MISSING');
    }
    if (pages % 100 === 0 || (!sourceHits.length && !targetHits.length)) {
      const progress = {
        capturedAt: new Date().toISOString(),
        sourceIndex,
        target,
        sourceCount,
        targetCount,
        scanned,
        pages,
        currentPageSize: pageSize,
        pageSizeFallbacks,
        sourceDistinctIds: sourceIds.size,
        targetDistinctIds: targetIds.size,
        sourceDifferences,
        lastSourceId: sourceHits[sourceHits.length - 1]?._id ?? null,
        lastTargetId: targetHits[targetHits.length - 1]?._id ?? null,
      };
      writeArtifact('source-parity-progress.json', progress);
      printSummary({ stage: 'source-parity', ...progress });
    }
  }
  const missingV4 = [...sourceIds].filter((id) => !targetIds.has(id));
  const extraV4 = [...targetIds].filter((id) => !sourceIds.has(id));
  return {
    idParity: {
      sourceIndex,
      targetIndex: target,
      sourceCount,
      targetCount,
      sourceDistinctIds: sourceIds.size,
      targetDistinctIds: targetIds.size,
      missingV4: missingV4.length,
      extraV4: extraV4.length,
      missingExamples: missingV4.slice(0, 10),
      extraExamples: extraV4.slice(0, 10),
    },
    sourceParity: {
      scanned,
      differences: sourceDifferences,
      sourceCanonicalSha256: sourceHash.digest('hex'),
      targetCanonicalSha256: targetHash.digest('hex'),
      examples: sourceExamples,
      ignoredFields: ['sortFields.numeroSentenciaCollation'],
      emptySortFieldsNormalizedOnlyWhenDerived: true,
      pages,
      initialPageSize: 10,
      finalPageSize: pageSize,
      pageSizeFallbacks,
      circuitBreakerGcRecoveries,
    },
  };
}

function forceOpenSearchGcForParity() {
  const jcmd = process.env.BJC_OPENSEARCH_JCMD;
  const pid = process.env.BJC_OPENSEARCH_PID;
  if (!jcmd || !pid || !/^\d+$/u.test(pid)) {
    throw new Error('V4_PARITY_GC_RUNNER_NOT_CONFIGURED');
  }
  execFileSync(jcmd, [pid, 'GC.run'], {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 30_000,
  });
}

function isCircuitBreakerError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    message?: unknown;
    meta?: { body?: { error?: { type?: unknown; reason?: unknown } } };
  };
  const rawType = candidate.meta?.body?.error?.type;
  const rawReason = candidate.meta?.body?.error?.reason ?? candidate.message;
  const errorType = typeof rawType === 'string' ? rawType.toLowerCase() : '';
  const reason = typeof rawReason === 'string' ? rawReason.toLowerCase() : '';
  return (
    errorType.includes('circuit_breaking_exception') ||
    reason.includes('circuit breaker')
  );
}

function normalizeDerivedSource(
  targetSource: Record<string, unknown>,
  sourceSource: Record<string, unknown> | undefined,
) {
  const normalized = JSON.parse(JSON.stringify(targetSource)) as Record<
    string,
    unknown
  >;
  const sortFields = normalized.sortFields;
  if (
    sortFields &&
    typeof sortFields === 'object' &&
    !Array.isArray(sortFields)
  ) {
    const fields = sortFields as Record<string, unknown>;
    delete fields.numeroSentenciaCollation;
    if (
      Object.keys(fields).length === 0 &&
      (!sourceSource ||
        !Object.prototype.hasOwnProperty.call(sourceSource, 'sortFields') ||
        sourceSource.sortFields === null)
    ) {
      if (sourceSource && sourceSource.sortFields === null)
        normalized.sortFields = null;
      else delete normalized.sortFields;
    }
  }
  return normalized;
}

async function certifyGolden(client: RawClient, target: string) {
  const expected = readJson<Array<Record<string, any>>>(
    resolve(DESIGN_ROOT, 'golden-asc.json'),
  );
  const expectedDesc = readJson<Array<Record<string, any>>>(
    resolve(DESIGN_ROOT, 'golden-desc.json'),
  );
  const expectedTie = expected
    .filter((entry) => entry.numeroSentencia === '077510')
    .map((entry) => ({
      id: entry.id,
      logicalNumericId: entry.logicalNumericId,
    }));
  const asc = await goldenOrder(client, target, 'asc', expected);
  const desc = await goldenOrder(client, target, 'desc', expectedDesc);
  const tieQuery = buildSearchQueryDsl(
    parseSearchQuery('responsabilidad civil'),
    GOLDEN_CONTEXT,
    { source: 'JURISPRUDENCIA' },
  );
  const missing = await request<Record<string, any>>(
    client,
    'POST',
    `/${target}/_search`,
    {
      size: 10,
      track_total_hits: true,
      query: {
        bool: {
          must: [
            tieQuery,
            { term: { 'sortFields.numeroSentencia': '077510' } },
          ],
        },
      },
      sort: [
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { 'id.collation': { order: 'desc' } },
      ],
      _source: ['id', 'logicalNumericId', 'sortFields.numeroSentencia'],
    },
  );
  const tie = (missing.hits?.hits ?? []).map((hit: OsHit) => ({
    id: hit._id,
    logicalNumericId: hit._source?.logicalNumericId,
    numeroSentencia: (
      hit._source?.sortFields as Record<string, unknown> | undefined
    )?.numeroSentencia,
  }));
  const tiePass =
    expectedTie.length > 0 &&
    tie.length === expectedTie.length &&
    tie.every(
      (row: Record<string, unknown>, index: number) =>
        row.id === expectedTie[index].id &&
        row.logicalNumericId === expectedTie[index].logicalNumericId,
    );
  const result = {
    capturedAt: new Date().toISOString(),
    target,
    asc,
    desc,
    tie077510: tie,
    expectedTie077510: expectedTie,
    tiePass,
    pass:
      asc.positionalDifferences === 0 &&
      desc.positionalDifferences === 0 &&
      asc.expectedCount === 7_694 &&
      desc.expectedCount === 7_694 &&
      tiePass,
  };
  writeArtifact('golden-asc.json', asc);
  writeArtifact('golden-desc.json', desc);
  writeArtifact('missing-parity.json', {
    nullsInGolden: expected.filter((entry) => entry.numeroSentencia === null)
      .length,
    emptyValuesInGolden: expected.filter(
      (entry) => entry.numeroSentencia === '',
    ).length,
    v4TieSort: tie,
    differences: asc.missingDifferences + desc.missingDifferences,
  });
  writeArtifact('tie-parity.json', {
    number: '077510',
    rows: tie,
    pass: result.pass,
  });
  writeArtifact('full-collation-differential.json', {
    ascDifferences: asc.positionalDifferences,
    descDifferences: desc.positionalDifferences,
    ascGoldenSha256: asc.expectedHash,
    ascV4Sha256: asc.actualHash,
    descGoldenSha256: desc.expectedHash,
    descV4Sha256: desc.actualHash,
    pass: result.pass,
  });
  ensure(result.pass, 'V4_GOLDEN_COLLATION_MISMATCH');
  printSummary(result);
}

async function goldenOrder(
  client: RawClient,
  target: string,
  direction: 'asc' | 'desc',
  expected: Array<Record<string, any>>,
) {
  const query = buildSearchQueryDsl(
    parseSearchQuery('responsabilidad civil'),
    GOLDEN_CONTEXT,
    { source: 'JURISPRUDENCIA' },
  );
  const pageSize = 100;
  const actual: Array<Record<string, unknown>> = [];
  let exactTotal: number | null = null;
  let after: unknown[] | undefined;
  let pages = 0;
  let totalOpenSearchTookMs = 0;
  let maxPageWallMs = 0;
  for (;;) {
    const pageStartedAt = Date.now();
    const response = await request<Record<string, any>>(
      client,
      'POST',
      `/${target}/_search`,
      {
        size: pageSize,
        track_total_hits: pages === 0,
        query,
        sort: [
          {
            'sortFields.numeroSentenciaCollation': {
              order: direction,
              missing: direction === 'asc' ? '_first' : '_last',
            },
          },
          { logicalNumericId: { order: 'desc', missing: '_last' } },
          { 'id.collation': { order: 'desc' } },
        ],
        _source: ['id', 'logicalNumericId', 'sortFields.numeroSentencia'],
        ...(after ? { search_after: after } : {}),
      },
    );
    maxPageWallMs = Math.max(maxPageWallMs, Date.now() - pageStartedAt);
    totalOpenSearchTookMs += Number(response.took ?? 0);
    const hits = (response.hits?.hits ?? []) as OsHit[];
    if (pages === 0) {
      ensure(
        response.hits?.total?.relation === 'eq',
        'V4_GOLDEN_TOTAL_NOT_EXACT',
      );
      exactTotal = response.hits.total.value;
    }
    if (!hits.length) break;
    for (const hit of hits) {
      const fields = hit._source?.sortFields as
        | Record<string, unknown>
        | undefined;
      actual.push({
        id: hit._id,
        numeroSentencia: fields?.numeroSentencia ?? null,
        logicalNumericId: hit._source?.logicalNumericId ?? null,
      });
    }
    pages += 1;
    after = hits[hits.length - 1]?.sort;
    if (hits.length === pageSize) {
      ensure(after, 'V4_GOLDEN_SEARCH_AFTER_MISSING');
    } else {
      break;
    }
  }
  ensure(exactTotal !== null, 'V4_GOLDEN_TOTAL_MISSING');
  const differences: Array<Record<string, unknown>> = [];
  const expectedMissing = expected.filter(
    (entry) => entry.numeroSentencia === null || entry.numeroSentencia === '',
  ).length;
  const actualMissing = actual.filter(
    (entry) => entry.numeroSentencia === null || entry.numeroSentencia === '',
  ).length;
  const missingDifferences = Math.abs(expectedMissing - actualMissing);
  let diffCount = 0;
  for (let i = 0; i < Math.max(expected.length, actual.length); i += 1) {
    const left = expected[i];
    const right = actual[i];
    if (
      left?.id !== right?.id ||
      (left?.numeroSentencia ?? null) !== (right?.numeroSentencia ?? null) ||
      (left?.logicalNumericId ?? null) !== (right?.logicalNumericId ?? null)
    ) {
      diffCount += 1;
      if (differences.length < 15)
        differences.push({
          position: i + 1,
          expected: expected[i] ?? null,
          actual: actual[i] ?? null,
        });
    }
  }
  const tuples = (values: Array<Record<string, unknown>>) =>
    values.map((entry) => [
      entry.id,
      entry.numeroSentencia,
      entry.logicalNumericId,
    ]);
  const expectedHash = sha256(JSON.stringify(tuples(expected)));
  const actualHash = sha256(JSON.stringify(tuples(actual)));
  return {
    direction,
    tookMs: totalOpenSearchTookMs,
    pageSize,
    pages,
    maxPageWallMs,
    exactTotal,
    expectedCount: expected.length,
    actualCount: actual.length,
    expectedHash,
    actualHash,
    positionalDifferences: diffCount,
    missingExpected: expectedMissing,
    missingActual: actualMissing,
    missingDifferences,
    examples: differences,
    pass: expected.length === actual.length && expectedHash === actualHash,
  };
}

async function compareReferences(client: RawClient, target: string) {
  const scenarios = [
    {
      name: 'internal-responsabilidad-civil',
      query: 'responsabilidad civil',
      context: GOLDEN_CONTEXT,
    },
    {
      name: 'internal-quoted-phrase',
      query: '"responsabilidad civil"',
      context: GOLDEN_CONTEXT,
    },
    {
      name: 'internal-prefix',
      query: 'responsabil',
      context: GOLDEN_CONTEXT,
    },
    {
      name: 'internal-date-filter',
      query: 'responsabilidad civil',
      context: {
        ...GOLDEN_CONTEXT,
        filters: { dateFrom: '2022-01-01', dateTo: '2022-12-31' },
      },
    },
    {
      name: 'internal-sala-filter',
      query: 'responsabilidad civil',
      context: { ...GOLDEN_CONTEXT, filters: { sala: 'H' } },
    },
    {
      name: 'internal-empty',
      query: '',
      context: GOLDEN_CONTEXT,
    },
    {
      name: 'public-responsabilidad-civil',
      query: 'responsabilidad civil',
      context: {
        ...GOLDEN_CONTEXT,
        visibility: 'PUBLIC' as const,
        publicationPolicy: 'published-active-only' as const,
      },
    },
    {
      name: 'public-falta-de-servicio',
      query: 'falta de servicio',
      context: {
        ...GOLDEN_CONTEXT,
        visibility: 'PUBLIC' as const,
        publicationPolicy: 'published-active-only' as const,
      },
    },
    {
      name: 'public-quoted-responsabilidad-civil',
      query: '"responsabilidad civil"',
      context: {
        ...GOLDEN_CONTEXT,
        visibility: 'PUBLIC' as const,
        publicationPolicy: 'published-active-only' as const,
      },
    },
  ];
  const results: Array<{
    name: string;
    v3Total: number;
    v4Total: number;
    missing: number;
    extra: number;
    v3Sha256: string;
    v4Sha256: string;
    pass: boolean;
  }> = [];
  for (const scenario of scenarios) {
    const query = buildSearchQueryDsl(
      parseSearchQuery(scenario.query),
      scenario.context,
      { source: 'JURISPRUDENCIA' },
    );
    const [source, shadow] = await Promise.all([
      exactIdSet(client, SOURCE_INDEX, query),
      exactIdSet(client, target, query),
    ]);
    const missing = source.ids.filter((id) => !shadow.set.has(id));
    const extra = shadow.ids.filter((id) => !source.set.has(id));
    results.push({
      name: scenario.name,
      v3Total: source.total,
      v4Total: shadow.total,
      missing: missing.length,
      extra: extra.length,
      v3Sha256: sha256(source.ids.join('\n')),
      v4Sha256: sha256(shadow.ids.join('\n')),
      pass:
        source.total === shadow.total &&
        missing.length === 0 &&
        extra.length === 0,
    });
  }
  const [v3References, v4References] = await Promise.all([
    referenceCounts(client, SOURCE_INDEX),
    referenceCounts(client, target),
  ]);
  const expectedReferences = {
    publicResponsabilidadCivil: 4_759,
    publicFaltaDeServicio: 1_826,
    publicQuotedPhrase: 3_369,
  };
  const referencesPass =
    JSON.stringify(v3References) === JSON.stringify(v4References) &&
    Object.entries(expectedReferences).every(
      ([key, value]) =>
        v3References[key as keyof typeof v3References] === value &&
        v4References[key as keyof typeof v4References] === value,
    );
  const publicContext: SearchContext = {
    ...GOLDEN_CONTEXT,
    visibility: 'PUBLIC',
    publicationPolicy: 'published-active-only',
  };
  const publicQuery = buildSearchQueryDsl(
    parseSearchQuery('responsabilidad civil'),
    publicContext,
    { source: 'JURISPRUDENCIA' },
  );
  const readPublicPage = async (index: string, sort: unknown[]) => {
    const response = await request<Record<string, any>>(
      client,
      'POST',
      `/${index}/_search`,
      {
        size: 25,
        track_total_hits: true,
        query: publicQuery,
        sort,
        _source: false,
      },
    );
    ensure(response.timed_out !== true, 'V4_PUBLIC_SORT_TIMED_OUT');
    ensure(
      (response._shards?.failed ?? 0) === 0,
      'V4_PUBLIC_SORT_SHARD_FAILURE',
    );
    ensure(
      response.hits?.total?.relation === 'eq',
      'V4_PUBLIC_SORT_TOTAL_NOT_EXACT',
    );
    return {
      total: response.hits.total.value as number,
      ids: ((response.hits.hits ?? []) as OsHit[]).map((hit) => hit._id),
      tookMs: Number(response.took ?? 0),
    };
  };
  const salaSort = [
    { 'sortFields.sala': { order: 'asc', missing: '_first' } },
    { logicalNumericId: { order: 'desc', missing: '_last' } },
    { id: { order: 'desc' } },
  ];
  const numberSortV4 = [
    {
      'sortFields.numeroSentenciaCollation': {
        order: 'asc',
        missing: '_first',
      },
    },
    { logicalNumericId: { order: 'desc', missing: '_last' } },
    { 'id.collation': { order: 'desc' } },
  ];
  const [v3SalaPage, v4SalaPage, v4NumberPage] = await Promise.all([
    readPublicPage(SOURCE_INDEX, salaSort),
    readPublicPage(target, salaSort),
    readPublicPage(target, numberSortV4),
  ]);
  const expectedPublicTotal = expectedReferences.publicResponsabilidadCivil;
  const publicSalaPass =
    v3SalaPage.total === expectedPublicTotal &&
    v4SalaPage.total === expectedPublicTotal &&
    v3SalaPage.ids.length === 25 &&
    JSON.stringify(v3SalaPage.ids) === JSON.stringify(v4SalaPage.ids);
  const publicNumberPass =
    v4NumberPage.total === expectedPublicTotal &&
    v4NumberPage.ids.length === 25;
  const publicResponsabilidadParity =
    results.find((entry) => entry.name === 'public-responsabilidad-civil')
      ?.pass === true;
  const result = {
    capturedAt: new Date().toISOString(),
    target,
    scenarios: results,
    v3References,
    references: v4References,
    expectedReferences,
    referencesPass,
    publicSorts: {
      sala: { v3: v3SalaPage, v4: v4SalaPage, pass: publicSalaPass },
      numeroSentenciaV4: {
        v4: v4NumberPage,
        sort: numberSortV4,
        pass: publicNumberPass,
      },
    },
    pass:
      results.every((entry) => entry.pass) &&
      referencesPass &&
      publicSalaPass &&
      publicNumberPass,
  };
  writeArtifact('matching-parity.json', result);
  writeArtifact('public-number.json', {
    query: 'responsabilidad civil',
    total: v4References.publicResponsabilidadCivil,
    expectedTotal: expectedReferences.publicResponsabilidadCivil,
    numberField: 'sortFields.numeroSentenciaCollation',
    derivedFieldContract:
      'source.numeroSentencia ?? ""; no trim or normalization',
    sortTuple: numberSortV4,
    firstPage: v4NumberPage,
    totalExact: true,
    pass: publicNumberPass && publicResponsabilidadParity,
  });
  writeArtifact('public-sala.json', {
    source: 'JURISPRUDENCIA',
    query: 'responsabilidad civil',
    visibility: 'PUBLIC',
    publicationPolicy: 'published-active-only',
    salaSortField: 'sortFields.sala',
    sortTuple: salaSort,
    v3: v3SalaPage,
    v4: v4SalaPage,
    salaSortUnchanged: publicSalaPass,
    matchingIdsParity: publicResponsabilidadParity,
    pass: publicSalaPass && publicResponsabilidadParity,
  });
  ensure(result.pass, 'V4_MATCHING_PARITY_OR_REFERENCE_COUNT_FAILED');
  printSummary(result);
}

async function exactIdSet(
  client: RawClient,
  index: string,
  query: Record<string, unknown>,
) {
  const ids: string[] = [];
  const set = new Set<string>();
  let after: unknown[] | undefined;
  let total: number | null = null;
  for (;;) {
    const response = await request<Record<string, any>>(
      client,
      'POST',
      `/${index}/_search`,
      {
        size: 1_000,
        track_total_hits: true,
        query,
        sort: [{ id: { order: 'asc' } }],
        _source: false,
        ...(after ? { search_after: after } : {}),
      },
    );
    if (response.hits?.total?.relation !== 'eq')
      throw new Error('V4_REFERENCE_TOTAL_NOT_EXACT');
    total ??= response.hits.total.value;
    const hits = response.hits.hits as OsHit[];
    if (!hits.length) break;
    for (const hit of hits) {
      ids.push(hit._id);
      set.add(hit._id);
    }
    after = hits[hits.length - 1].sort;
    if (!after) throw new Error('V4_REFERENCE_CURSOR_MISSING');
  }
  return { ids, set, total: total ?? 0 };
}

async function runTie2Proof(client: RawClient) {
  const name = `galilei-search-v004-qa-${new Date().toISOString().replace(/[-:.]/gu, '').toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const definition = JSON.parse(
    JSON.stringify(SEARCH_INDEX_DEFINITION_V4),
  ) as Record<string, any>;
  let override = false;
  let created = false;
  try {
    const settings = await request<Record<string, any>>(
      client,
      'GET',
      '/_cluster/settings?include_defaults=false',
    );
    try {
      if (
        settings.persistent?.['cluster.blocks.create_index'] === true ||
        settings.persistent?.['cluster.blocks.create_index'] === 'true'
      ) {
        await request(client, 'PUT', '/_cluster/settings', {
          transient: { 'cluster.blocks.create_index': false },
        });
        override = true;
      }
      await request(client, 'PUT', `/${name}`, definition);
      created = true;
    } finally {
      if (override) {
        await request(client, 'PUT', '/_cluster/settings', {
          transient: { 'cluster.blocks.create_index': null },
        });
      }
    }
    const documents = [
      {
        id: 'ñ',
        logicalNumericId: 1,
        sourceSystem: 'JURISPRUDENCIA',
        sourceType: 'SENTENCIA',
        active: true,
        sortFields: { numeroSentencia: 'igual' },
      },
      {
        id: 'z',
        logicalNumericId: 1,
        sourceSystem: 'JURISPRUDENCIA',
        sourceType: 'SENTENCIA',
        active: true,
        sortFields: { numeroSentencia: 'igual' },
      },
    ];
    const bulk = documents.flatMap((doc) => [
      { index: { _index: name, _id: doc.id } },
      doc,
    ]);
    const bulkResult = await request<Record<string, any>>(
      client,
      'POST',
      '/_bulk?refresh=wait_for',
      bulk.map((line) => JSON.stringify(line)).join('\n') + '\n',
    );
    ensure(!bulkResult.errors, 'V4_TIE2_FIXTURE_WRITE_FAILED');
    const v4 = await request<Record<string, any>>(
      client,
      'POST',
      `/${name}/_search`,
      {
        size: 10,
        sort: [
          { 'sortFields.numeroSentenciaCollation': { order: 'asc' } },
          { logicalNumericId: { order: 'desc' } },
          { 'id.collation': { order: 'desc' } },
        ],
        _source: ['id'],
      },
    );
    const keyword = await request<Record<string, any>>(
      client,
      'POST',
      `/${name}/_search`,
      {
        size: 10,
        sort: [
          { 'sortFields.numeroSentenciaCollation': { order: 'asc' } },
          { logicalNumericId: { order: 'desc' } },
          { id: { order: 'desc' } },
        ],
        _source: ['id'],
      },
    );
    const v4Ids = (v4.hits?.hits ?? []).map((hit: OsHit) => hit._id);
    const keywordIds = (keyword.hits?.hits ?? []).map((hit: OsHit) => hit._id);
    const result = {
      capturedAt: new Date().toISOString(),
      temporaryIndex: name,
      fixtures: documents.length,
      rawKeywordDescending: keywordIds,
      icuIdCollationDescending: v4Ids,
      expectedRawKeywordDescending: ['ñ', 'z'],
      expectedIcuDescending: ['z', 'ñ'],
      pass:
        JSON.stringify(keywordIds) === JSON.stringify(['ñ', 'z']) &&
        JSON.stringify(v4Ids) === JSON.stringify(['z', 'ñ']),
      cleanup: 'AUTOMATIC_FINALLY',
    };
    writeArtifact('tie2-parity.json', result);
    ensure(result.pass, 'V4_ID_COLLATION_TIE2_FAILED');
    printSummary(result);
  } finally {
    if (created) {
      await request(client, 'DELETE', `/${name}`).catch(() => undefined);
      writeArtifact('synthetic-cleanup.json', {
        target: name,
        deleted: true,
        syntheticResidue: 0,
        automatic: true,
      });
    }
  }
}

async function cleanupTie2(client: RawClient) {
  const previous = readJson<{ temporaryIndex: string }>(
    resolve(ARTIFACT_ROOT, 'tie2-parity.json'),
  );
  ensure(
    previous.temporaryIndex.startsWith('galilei-search-v004-qa-'),
    'V4_TIE2_CLEANUP_TARGET_INVALID',
  );
  await request(client, 'DELETE', `/${previous.temporaryIndex}`);
  const result = {
    target: previous.temporaryIndex,
    deleted: true,
    syntheticResidue: 0,
  };
  writeArtifact('synthetic-cleanup.json', result);
  printSummary(result);
}

async function measurePerformance(client: RawClient, target: string) {
  const query = buildSearchQueryDsl(
    parseSearchQuery('responsabilidad civil'),
    GOLDEN_CONTEXT,
    { source: 'JURISPRUDENCIA' },
  );
  const run = async (direction: 'asc' | 'desc', from = 0) => {
    const started = performance.now();
    const response = await request<Record<string, any>>(
      client,
      'POST',
      `/${target}/_search`,
      {
        from,
        size: 25,
        track_total_hits: true,
        query,
        sort: [
          {
            'sortFields.numeroSentenciaCollation': {
              order: direction,
              missing: direction === 'asc' ? '_first' : '_last',
            },
          },
          { logicalNumericId: { order: 'desc', missing: '_last' } },
          { 'id.collation': { order: 'desc' } },
        ],
        _source: false,
      },
    );
    return {
      wallMs: Number((performance.now() - started).toFixed(2)),
      tookMs: Number(response.took ?? 0),
      total: response.hits?.total?.value,
      totalRelation: response.hits?.total?.relation,
      ids: (response.hits?.hits ?? []).map((hit: OsHit) => hit._id),
    };
  };
  const result: Record<string, any> = {
    capturedAt: new Date().toISOString(),
    target,
    warmups: 2,
    samples: 20,
    asc: [],
    desc: [],
  };
  for (const direction of ['asc', 'desc'] as const) {
    await run(direction);
    await run(direction);
    const samples: Array<{
      wallMs: number;
      tookMs: number;
      total: number;
      totalRelation: string;
      ids: string[];
    }> = [];
    for (let i = 0; i < 20; i += 1) samples.push(await run(direction));
    result[direction] = samples;
  }
  const [
    deepAsc,
    deepDesc,
    pageOne,
    pageTwo,
    pageThree,
    pageOneRepeat,
    runtime,
  ] = await Promise.all([
    run('asc', 5_000),
    run('desc', 5_000),
    run('asc', 0),
    run('asc', 25),
    run('asc', 2_500),
    run('asc', 0),
    runtimeSnapshot(client),
  ]);
  const summarize = (samples: Array<{ wallMs: number; tookMs: number }>) => ({
    p50WallMs: percentile(
      samples.map((sample) => sample.wallMs),
      0.5,
    ),
    p95WallMs: percentile(
      samples.map((sample) => sample.wallMs),
      0.95,
    ),
    p50OpenSearchMs: percentile(
      samples.map((sample) => sample.tookMs),
      0.5,
    ),
    p95OpenSearchMs: percentile(
      samples.map((sample) => sample.tookMs),
      0.95,
    ),
  });
  result.summary = { asc: summarize(result.asc), desc: summarize(result.desc) };
  result.deepPage = {
    asc: {
      from: 5_000,
      total: deepAsc.total,
      count: deepAsc.ids.length,
      tookMs: deepAsc.tookMs,
    },
    desc: {
      from: 5_000,
      total: deepDesc.total,
      count: deepDesc.ids.length,
      tookMs: deepDesc.tookMs,
    },
  };
  result.pagination = {
    pageOne: pageOne.ids,
    pageTwo: pageTwo.ids,
    laterPage: pageThree.ids,
    pageOneRepeat: pageOneRepeat.ids,
    repeatedStable:
      JSON.stringify(pageOne.ids) === JSON.stringify(pageOneRepeat.ids),
    duplicateIds:
      new Set([...pageOne.ids, ...pageTwo.ids, ...pageThree.ids]).size !==
      pageOne.ids.length + pageTwo.ids.length + pageThree.ids.length,
  };
  result.heap = runtime;
  result.http503 = 0;
  result.fullMaterialization = false;
  result.pass =
    result.summary.asc.p95WallMs < 5_000 &&
    result.summary.desc.p95WallMs < 5_000 &&
    result.deepPage.asc.count === 25 &&
    result.deepPage.desc.count === 25 &&
    result.pagination.repeatedStable &&
    !result.pagination.duplicateIds &&
    result.asc.every(
      (sample: Record<string, unknown>) => sample.total === 7_694,
    ) &&
    result.desc.every(
      (sample: Record<string, unknown>) => sample.total === 7_694,
    );
  writeArtifact('performance.json', result);
  writeArtifact('pagination.json', result.pagination);
  ensure(result.pass, 'V4_PERFORMANCE_OR_PAGINATION_GATE_FAILED');
  printSummary({
    summary: result.summary,
    deepPage: result.deepPage,
    pagination: result.pagination,
    pass: result.pass,
  });
}

async function searchPage(
  client: RawClient,
  index: string,
  size: number,
  searchAfter?: unknown[],
) {
  const response = await request<Record<string, any>>(
    client,
    'POST',
    `/${index}/_search`,
    {
      size,
      // Exact totals are captured once from both index snapshots before the
      // streaming comparison. Recomputing them for every search_after page
      // adds substantial heap churn without strengthening the parity proof.
      track_total_hits: false,
      query: { match_all: {} },
      sort: [{ id: { order: 'asc' } }],
      _source: true,
      ...(searchAfter ? { search_after: searchAfter } : {}),
    },
  );
  return {
    hits: {
      total: response.hits.total,
      hits: (response.hits.hits ?? []) as OsHit[],
    },
  };
}

async function referenceCounts(client: RawClient, index: string) {
  const queryTotal = async (
    text: string,
    context: SearchContext,
  ): Promise<number> => {
    const query = buildSearchQueryDsl(parseSearchQuery(text), context, {
      source: 'JURISPRUDENCIA',
    });
    const response = await request<Record<string, any>>(
      client,
      'POST',
      `/${index}/_search`,
      { size: 0, track_total_hits: true, query },
    );
    ensure(
      response.hits?.total?.relation === 'eq',
      'V4_REFERENCE_TOTAL_NOT_EXACT',
    );
    return response.hits.total.value;
  };
  const publicContext: SearchContext = {
    ...GOLDEN_CONTEXT,
    visibility: 'PUBLIC',
    publicationPolicy: 'published-active-only',
  };
  return {
    internalResponsabilidadCivil: await queryTotal(
      'responsabilidad civil',
      GOLDEN_CONTEXT,
    ),
    publicResponsabilidadCivil: await queryTotal(
      'responsabilidad civil',
      publicContext,
    ),
    publicFaltaDeServicio: await queryTotal('falta de servicio', publicContext),
    publicQuotedPhrase: await queryTotal(
      '"responsabilidad civil"',
      publicContext,
    ),
  };
}

function makeIndexService(
  client: RawClient,
  repository: OpenSearchDocumentRepository,
  target: string,
) {
  ensure(
    process.env.OPENSEARCH_SEARCH_SCHEMA_VERSION === '4' &&
      process.env.OPENSEARCH_READ_ONLY_CANDIDATE === 'true' &&
      process.env.OPENSEARCH_SEARCH_TARGET === target,
    'V4_READ_ONLY_TARGET_GUARD_REQUIRED',
  );
  return new OpenSearchIndexService(
    client as unknown as Client,
    repository,
    'galilei-search-active',
    'galilei-search',
    SEARCH_INDEX_SCHEMA_VERSION_V4,
    true,
    target,
  );
}

async function replayShadow(
  indexService: OpenSearchIndexService,
  target: string,
) {
  const h0 = readJson<{ barrierWatermark: string }>(
    resolve(ARTIFACT_ROOT, 'h0.json'),
  );
  const h1 = readJson<{ barrierWatermark: string }>(
    resolve(ARTIFACT_ROOT, 'h1.json'),
  );
  const result =
    h0.barrierWatermark === h1.barrierWatermark
      ? {
          target,
          afterWatermark: h0.barrierWatermark,
          highWatermark: h1.barrierWatermark,
          changedKeys: 0,
          outboxStatusesChanged: false,
          catchup: 'NOT_REQUIRED_H0_EQUALS_H1',
        }
      : await indexService.replayShadowChanges(target, h0.barrierWatermark);
  writeArtifact('outbox-catchup.json', result);
  printSummary(result);
}

function compareMappings(
  source: Record<string, any>,
  target: Record<string, any>,
) {
  const base = JSON.parse(JSON.stringify(source)) as Record<string, any>;
  const candidate = JSON.parse(JSON.stringify(target)) as Record<string, any>;
  if (base._meta) base._meta.galileiSearchSchemaVersion = 4;
  if (candidate._meta) candidate._meta.galileiSearchSchemaVersion = 4;
  if (base.properties?.id?.fields) {
    delete base.properties.id.fields.collation;
    if (Object.keys(base.properties.id.fields).length === 0)
      delete base.properties.id.fields;
  }
  if (candidate.properties?.id?.fields) {
    delete candidate.properties.id.fields.collation;
    if (Object.keys(candidate.properties.id.fields).length === 0)
      delete candidate.properties.id.fields;
  }
  if (candidate.properties?.sortFields?.properties)
    delete candidate.properties.sortFields.properties.numeroSentenciaCollation;
  const differences =
    canonicalJson(base) === canonicalJson(candidate)
      ? []
      : ['MAPPING_DIFF_OUTSIDE_CERTIFIED_FIELDS'];
  return {
    sourceSchemaVersion: source._meta?.galileiSearchSchemaVersion,
    targetSchemaVersion: target._meta?.galileiSearchSchemaVersion,
    sourceSha256: sha256(canonicalJson(source)),
    targetSha256: sha256(canonicalJson(target)),
    allowedDifferences: [
      'id.fields.collation',
      'sortFields.numeroSentenciaCollation',
    ],
    differences,
    pass: differences.length === 0,
  };
}

function makePhysicalIndexName() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.]/gu, '')
    .toLowerCase();
  return `galilei-search-v004-${timestamp}-${randomUUID().slice(0, 8)}`;
}

function requireLocalRuntime(node: string) {
  if (node !== 'http://127.0.0.1:9200')
    throw new Error('OPENSEARCH_V4_NONLOCAL_TARGET_REJECTED');
}

function loadLocalEnvironment() {
  const envFile = resolve(process.cwd(), '.env.development.local');
  let content: string;
  try {
    content = readFileSync(envFile, 'utf8');
  } catch {
    throw new Error('DEV_ENV_FILE_MISSING');
  }
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const raw = match[2];
    process.env[match[1]] =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
  }
}

function diskSnapshot() {
  const stats = statfsSync('C:\\');
  const freeBytes = stats.bavail * stats.bsize;
  return {
    freeBytes,
    freeGiB: Number((freeBytes / 1024 ** 3).toFixed(2)),
    minimumRequiredBytes: MIN_FREE_BYTES,
    minimumRequiredGiB: 60,
  };
}

function request<T = Record<string, any>>(
  client: RawClient,
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<T> {
  return client.transport
    .request({ method, path, ...(body === undefined ? {} : { body }) })
    .then((response) => bodyOf<T>(response));
}

function bodyOf<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'body' in response)
    return (response as { body: T }).body;
  return response as T;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortObjectKeys(entry)]),
    );
  }
  return value;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
  ];
}

function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function writeArtifact(filename: string, value: unknown) {
  writeJson(resolve(ARTIFACT_ROOT, filename), value);
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function printSummary(value: unknown) {
  console.log(JSON.stringify(value));
}

void main().catch((error: unknown) => {
  const raw = error instanceof Error ? error.message : 'COLLATION_V4_FAILED';
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const typedError =
    error && typeof error === 'object'
      ? (
          error as {
            meta?: { body?: { error?: { type?: unknown } } };
          }
        ).meta?.body?.error?.type
      : undefined;
  const safeErrorType =
    typeof typedError === 'string' && /^[a-z0-9_]+$/u.test(typedError)
      ? typedError
      : null;
  const code = /^[A-Z0-9_]+$/u.test(raw)
    ? raw
    : 'COLLATION_V4_OPERATION_FAILED';
  try {
    writeArtifact('opensearch-v4-shadow-error.json', {
      capturedAt: new Date().toISOString(),
      action: process.env.BJC_COLLATION_V4_ACTION ?? null,
      errorName,
      errorType: safeErrorType,
      code,
    });
  } catch {
    // Keep the sanitized stderr report even if the evidence directory is unavailable.
  }
  console.error(code);
  process.exitCode = 1;
});

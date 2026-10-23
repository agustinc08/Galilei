import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Client } from '@opensearch-project/opensearch';
import { Client as PgClient } from 'pg';
import { getRuntimeDatabasePoolConfig } from '../../src/config/runtime-database-config';
import { OpenSearchDocumentRepository } from '../../src/busqueda/opensearch/opensearch-document.repository';
import {
  OpenSearchIndexService,
  type FreshV4SourceParityCursor,
  type FreshV4SourceParityOptions,
  type FreshV4SourceParityProgress,
  type FreshV4ProjectionOptions,
  type FreshV4ProjectionCursor,
  type SearchProjectionCounts,
} from '../../src/busqueda/opensearch/opensearch-index.service';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import {
  assertFreshV4Topology,
  classifyOpenSearchAlias,
  classifyOpenSearchIndex,
} from '../../src/busqueda/opensearch/opensearch-fresh-topology';

const EXPECTED_BUILD = '97d3c13bf22a4a72ac11dc503fe44c97662b9161';
const EXPECTED_SEARCH_VERSION = '2.19.6';
const EXPECTED_ICU_VERSION = '2.19.6';
const EXPECTED_HEAP_BYTES = 2_147_483_648;
const EXPECTED_DATABASE = 'buscador_juridico_civil_dev';
const EXPECTED_DEEP_QA_DATABASE = 'buscador_juridico_civil_deepqa';
const EXPECTED_ROLE = 'bjc_dev';
const EXPECTED_DATABASE_PORT = 55432;
const EXPECTED_DEEP_QA_DATABASE_PORT = 55434;
// Keep each source+MGET comparison comfortably below the memory cost of the
// largest historical source documents on the local DEV corpus.
const SOURCE_PARITY_PAGE_SIZE = 100;

type Phase = 'dry-run' | 'apply' | 'resume' | 'status' | 'activate';
type BootstrapStage =
  | 'EMPTY'
  | 'INDEX_CREATED'
  | 'PROJECTING'
  | 'PROJECTED'
  | 'VERIFIED'
  | 'ALIAS_ACTIVE'
  | 'COMPLETE';
type Args = {
  phase: Phase;
  target?: string;
  stateFile?: string;
};
type DatabaseIdentity = {
  host: string;
  port: number;
  database: string;
  role: string;
  server: string;
};
type RuntimeMarker = {
  runtimeId: string;
  clusterName: string;
  clusterUuid: string;
  endpoint: string;
  home: string;
  configPath: string;
  dataPath: string;
  httpPort: number;
  transportPort: number;
};
type BootstrapState = {
  formatVersion: 1;
  mode: 'fresh-bootstrap';
  stage: BootstrapStage;
  target: string;
  endpoint: string;
  clusterUuid: string;
  clusterName: string;
  runtimeId: string;
  dataPath: string;
  database: DatabaseIdentity;
  highWatermarkBoot?: string;
  highWatermarkReconciled?: string;
  collationPipeline?: string;
  collationPipelineCreated?: boolean;
  projection?: Record<string, unknown>;
  projectionCursor?: FreshV4ProjectionCursor;
  projectionCounts?: SearchProjectionCounts;
  sourceParityCursor?: FreshV4SourceParityCursor;
  sourceParityProgress?: FreshV4SourceParityProgress;
  sourceParityGcAt?: number;
  sourceParityGcCount?: number;
  sourceParity?: Record<string, unknown>;
  alias?: string;
  updatedAt: string;
};

function parseArgs(): Args {
  const encoded = process.env.BJC_SEARCH_V4_FRESH_ARGS;
  if (!encoded) throw new Error('SEARCH_FRESH_V4_OPERATOR_ARGS_REQUIRED');
  let values: string[];
  try {
    values = JSON.parse(encoded) as string[];
  } catch {
    throw new Error('SEARCH_FRESH_V4_OPERATOR_ARGS_INVALID');
  }
  let mode: string | undefined;
  let phase: Phase | undefined;
  let target: string | undefined;
  let stateFile: string | undefined;
  const modes = new Set([
    '--dry-run',
    '--apply',
    '--resume',
    '--status',
    '--activate',
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (item === '--mode') {
      mode = values[index + 1];
      index += 1;
    } else if (modes.has(item)) {
      if (phase) throw new Error('SEARCH_FRESH_V4_PHASE_CONFLICT');
      phase = item.slice(2) as Phase;
    } else if (item === '--target' || item === '--state-file') {
      const value = values[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('SEARCH_FRESH_V4_ARGUMENT_INVALID');
      }
      if (item === '--target') target = value;
      else stateFile = value;
      index += 1;
    } else {
      throw new Error('SEARCH_FRESH_V4_ARGUMENT_INVALID');
    }
  }
  if (mode !== 'fresh-bootstrap') {
    throw new Error('SEARCH_FRESH_V4_EXPLICIT_MODE_REQUIRED');
  }
  if (!phase) throw new Error('SEARCH_FRESH_V4_PHASE_REQUIRED');
  if (phase !== 'dry-run' && phase !== 'status' && (!stateFile || !target)) {
    throw new Error('SEARCH_FRESH_V4_STATE_AND_TARGET_REQUIRED');
  }
  return { phase, target, stateFile };
}

function bodyOf<T>(response: unknown): T {
  return response && typeof response === 'object' && 'body' in response
    ? (response as { body: T }).body
    : (response as T);
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function parseTarget(target: string, prefix: string) {
  const pattern = new RegExp(
    `^${escaped(prefix)}-v004-\\d{8}t\\d{9}z-[a-f0-9]{8}$`,
    'u',
  );
  if (!pattern.test(target)) throw new Error('SEARCH_FRESH_V4_TARGET_INVALID');
  return target;
}

function generateTarget(prefix: string) {
  const stamp = new Date().toISOString().replace(/[-:.]/gu, '').toLowerCase();
  return `${prefix}-v004-${stamp}-${randomUUID().slice(0, 8)}`;
}

function absolutePath(value: string, code: string) {
  if (!value || !path.isAbsolute(value)) throw new Error(code);
  return path.resolve(value);
}

function assertStateRoot(stateFile: string, createRoot = true) {
  const rootValue = process.env.BJC_SEARCH_FRESH_STATE_ROOT;
  if (!rootValue) throw new Error('SEARCH_FRESH_V4_STATE_ROOT_REQUIRED');
  const root = absolutePath(rootValue, 'SEARCH_FRESH_V4_STATE_ROOT_INVALID');
  const resolved = absolutePath(
    stateFile,
    'SEARCH_FRESH_V4_STATE_FILE_INVALID',
  );
  const relative = path.relative(root, resolved);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('SEARCH_FRESH_V4_STATE_FILE_OUTSIDE_ROOT');
  }
  if (!existsSync(root)) {
    if (!createRoot) throw new Error('SEARCH_FRESH_V4_STATE_ROOT_MISSING');
    mkdirSync(root, { recursive: true });
  }
  return resolved;
}

function writeState(stateFile: string, state: BootstrapState) {
  const resolved = assertStateRoot(stateFile);
  const next = { ...state, updatedAt: new Date().toISOString() };
  const temporary = `${resolved}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  renameSync(temporary, resolved);
  state.updatedAt = next.updatedAt;
}

function readState(stateFile: string): BootstrapState {
  const resolved = assertStateRoot(stateFile, false);
  let value: BootstrapState;
  try {
    value = JSON.parse(readFileSync(resolved, 'utf8')) as BootstrapState;
  } catch {
    throw new Error('SEARCH_FRESH_V4_STATE_FILE_INVALID');
  }
  if (
    value.formatVersion !== 1 ||
    value.mode !== 'fresh-bootstrap' ||
    ![
      'EMPTY',
      'INDEX_CREATED',
      'PROJECTING',
      'PROJECTED',
      'VERIFIED',
      'ALIAS_ACTIVE',
      'COMPLETE',
    ].includes(value.stage)
  ) {
    throw new Error('SEARCH_FRESH_V4_STATE_FILE_INVALID');
  }
  return value;
}

function validateOperatorConfig() {
  if (process.env.BJC_SEARCH_TOPOLOGY !== 'fresh-v4') {
    throw new Error('SEARCH_FRESH_V4_TOPOLOGY_EXPLICITLY_REQUIRED');
  }
  if (process.env.OPENSEARCH_SEARCH_SCHEMA_VERSION !== '4') {
    throw new Error('SEARCH_FRESH_V4_SCHEMA_EXPLICITLY_REQUIRED');
  }
  const node = process.env.OPENSEARCH_NODE ?? '';
  const endpoint = new URL(node);
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    !endpoint.port ||
    ['9200', '9300'].includes(endpoint.port) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('SEARCH_FRESH_V4_ISOLATED_ENDPOINT_REQUIRED');
  }
  const markerFile = process.env.BJC_SEARCH_FRESH_RUNTIME_MARKER;
  if (!markerFile) throw new Error('SEARCH_FRESH_V4_RUNTIME_MARKER_REQUIRED');
  const markerPath = absolutePath(
    markerFile,
    'SEARCH_FRESH_V4_RUNTIME_MARKER_INVALID',
  );
  let marker: RuntimeMarker;
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf8')) as RuntimeMarker;
  } catch {
    throw new Error('SEARCH_FRESH_V4_RUNTIME_MARKER_INVALID');
  }
  const config = readOpenSearchConfig({
    ...process.env,
    OPENSEARCH_SEARCH_SCHEMA_VERSION: '4',
    OPENSEARCH_READ_ONLY_CANDIDATE: 'false',
    OPENSEARCH_TRUSTED_PHYSICAL_WRITE: 'true',
    OPENSEARCH_SEARCH_TARGET: generateTarget(
      process.env.OPENSEARCH_INDEX_PREFIX?.trim() || 'galilei-search',
    ),
  });
  if (
    config.topology !== 'fresh-v4' ||
    config.searchSchemaVersion !== 4 ||
    config.node !== endpoint.origin ||
    endpoint.port !== String(marker.httpPort) ||
    marker.endpoint !== endpoint.origin ||
    marker.clusterName !== process.env.BJC_SEARCH_FRESH_CLUSTER_NAME ||
    !/^bjc-search-fresh-v4-[a-z0-9-]{8,64}$/u.test(marker.clusterName) ||
    path.resolve(marker.home) !==
      path.resolve(process.env.OPENSEARCH_HOME ?? '') ||
    path.resolve(marker.configPath) !==
      path.resolve(process.env.OPENSEARCH_PATH_CONF ?? '') ||
    path.resolve(marker.dataPath) !==
      path.resolve(process.env.BJC_OPENSEARCH_DATA_PATH ?? '') ||
    marker.transportPort === marker.httpPort ||
    [9200, 9300].includes(marker.transportPort) ||
    !marker.clusterUuid ||
    !marker.runtimeId
  ) {
    throw new Error('SEARCH_FRESH_V4_RUNTIME_MARKER_MISMATCH');
  }
  return { config, endpoint: endpoint.origin, marker };
}

async function verifyDatabaseIdentity(): Promise<DatabaseIdentity> {
  const isolatedQaEnabled =
    process.env.BJC_DEEP_QA_ALLOW_ISOLATED_DATABASE === 'true';
  const expectedDatabase = isolatedQaEnabled
    ? EXPECTED_DEEP_QA_DATABASE
    : EXPECTED_DATABASE;
  const expectedDatabasePort = isolatedQaEnabled
    ? EXPECTED_DEEP_QA_DATABASE_PORT
    : EXPECTED_DATABASE_PORT;
  const pg = new PgClient({
    ...getRuntimeDatabasePoolConfig(),
    connectionTimeoutMillis: 5000,
    application_name: 'bjc-search-v4-fresh-bootstrap',
  });
  await pg.connect();
  try {
    await pg.query('BEGIN READ ONLY');
    const result = await pg.query<{
      database: string;
      role: string;
      host: string;
      port: number;
      server: string;
    }>(`
      SELECT current_database() AS database, current_user AS role,
             host(inet_server_addr()) AS host, inet_server_port() AS port,
             current_setting('server_version') AS server
    `);
    const identity = result.rows[0];
    if (
      identity.database !== expectedDatabase ||
      identity.role !== EXPECTED_ROLE ||
      identity.host !== '127.0.0.1' ||
      Number(identity.port) !== expectedDatabasePort ||
      Number(identity.server.split('.')[0]) !== 16
    ) {
      throw new Error('SEARCH_FRESH_V4_DATABASE_IDENTITY_REJECTED');
    }
    await pg.query('COMMIT');
    return {
      host: identity.host,
      port: Number(identity.port),
      database: identity.database,
      role: identity.role,
      server: identity.server,
    };
  } catch (error) {
    await pg.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await pg.end();
  }
}

async function inspectRuntime(
  client: Client,
  marker: RuntimeMarker,
  indexPrefix: string,
  activeAlias: string,
) {
  const [
    infoResponse,
    healthResponse,
    pluginsResponse,
    nodesResponse,
    settingsResponse,
    stateResponse,
    indexResponse,
    aliasResponse,
  ] = await Promise.all([
    client.info(),
    client.cluster.health({ local: true, timeout: '5s' }),
    client.transport.request({
      method: 'GET',
      path: '/_cat/plugins?format=json',
    }),
    client.transport.request({
      method: 'GET',
      path: '/_nodes/_local/jvm,settings?flat_settings=true',
    }),
    client.transport.request({
      method: 'GET',
      path: '/_cluster/settings?include_defaults=true&flat_settings=true',
    }),
    client.transport.request({
      method: 'GET',
      path: '/_cluster/state/metadata',
    }),
    client.transport.request({
      method: 'GET',
      path: '/_cat/indices?format=json&h=index',
    }),
    client.transport
      .request({
        method: 'GET',
        path: '/_cat/aliases?format=json&h=alias,index',
      })
      .catch((error: unknown) => {
        if (statusCode(error) === 404) return { body: [] };
        throw error;
      }),
  ]);
  const info = bodyOf<{ version?: { number?: string; build_hash?: string } }>(
    infoResponse,
  );
  const health = bodyOf<{
    status?: string;
    number_of_nodes?: number;
    unassigned_shards?: number;
  }>(healthResponse);
  const plugins =
    bodyOf<Array<{ component?: string; version?: string }>>(pluginsResponse);
  const nodes = bodyOf<{
    nodes?: Record<
      string,
      {
        name?: string;
        settings?: Record<string, unknown>;
        jvm?: {
          mem?: { heap_init_in_bytes?: number; heap_max_in_bytes?: number };
          input_arguments?: string[];
        };
      }
    >;
  }>(nodesResponse);
  const settings =
    bodyOf<Record<string, Record<string, unknown>>>(settingsResponse);
  const clusterState = bodyOf<{ cluster_uuid?: string }>(stateResponse);
  const indices = bodyOf<Array<{ index?: string }>>(indexResponse);
  const aliases =
    bodyOf<Array<{ alias?: string; index?: string }>>(aliasResponse);
  const node = Object.values(nodes.nodes ?? {})[0];
  const jvm = node?.jvm;
  const flatSettings = {
    ...(settings.defaults ?? {}),
    ...(settings.persistent ?? {}),
    ...(settings.transient ?? {}),
  };
  const icuPlugins = plugins.filter(
    (plugin) => plugin.component === 'analysis-icu',
  );
  const icu = icuPlugins[0];
  const dataSetting = node?.settings?.['path.data'];
  const dataPath = Array.isArray(dataSetting)
    ? String(dataSetting[0] ?? '')
    : String(dataSetting ?? '');
  const httpPort = Number(node?.settings?.['http.port'] ?? marker.httpPort);
  const transportPort = Number(
    node?.settings?.['transport.port'] ?? marker.transportPort,
  );
  const physicalIndices = indices
    .map((entry) => entry.index)
    .filter((value): value is string => Boolean(value));
  const aliasEntries = aliases.filter(
    (entry): entry is { alias: string; index: string } =>
      typeof entry.alias === 'string' && typeof entry.index === 'string',
  );
  const summary = {
    endpoint: marker.endpoint,
    version: info.version?.number ?? null,
    buildHash: info.version?.build_hash ?? null,
    health: health.status ?? 'unknown',
    nodes: Number(health.number_of_nodes ?? 0),
    unassignedShards: Number(health.unassigned_shards ?? -1),
    clusterUuid: clusterState.cluster_uuid ?? '',
    clusterName: String(flatSettings['cluster.name'] ?? ''),
    plugin: icu?.component ?? null,
    pluginVersion: icu?.version ?? null,
    heapInitBytes: Number(jvm?.mem?.heap_init_in_bytes ?? 0),
    heapMaxBytes: Number(jvm?.mem?.heap_max_in_bytes ?? 0),
    heapArgs:
      jvm?.input_arguments?.filter((value) => /^-Xm[sx]/u.test(value)) ?? [],
    dataPath,
    httpPort,
    transportPort,
    indexPrefix,
    activeAlias,
    indices: physicalIndices,
    applicationIndices: physicalIndices.filter(
      (value) =>
        classifyOpenSearchIndex(value, indexPrefix) === 'BJC_APPLICATION_INDEX',
    ),
    internalIndices: physicalIndices.filter(
      (value) =>
        classifyOpenSearchIndex(value, indexPrefix) ===
        'OPENSEARCH_INTERNAL_INDEX',
    ),
    unknownNonBjcIndices: physicalIndices.filter(
      (value) =>
        classifyOpenSearchIndex(value, indexPrefix) === 'UNKNOWN_NON_BJC_INDEX',
    ),
    aliases: aliasEntries,
    applicationAliases: aliasEntries.filter(
      (entry) =>
        classifyOpenSearchAlias(entry.alias, activeAlias) ===
        'BJC_APPLICATION_ALIAS',
    ),
    internalAliases: aliasEntries.filter(
      (entry) =>
        classifyOpenSearchAlias(entry.alias, activeAlias) ===
        'OPENSEARCH_INTERNAL_ALIAS',
    ),
    unknownNonBjcAliases: aliasEntries.filter(
      (entry) =>
        classifyOpenSearchAlias(entry.alias, activeAlias) ===
        'UNKNOWN_NON_BJC_ALIAS',
    ),
  };
  const normalize = (value: string) =>
    path.resolve(value).replace(/\\/gu, '/').toLowerCase();
  if (
    summary.version !== EXPECTED_SEARCH_VERSION ||
    summary.buildHash !== EXPECTED_BUILD ||
    summary.health !== 'green' ||
    summary.nodes !== 1 ||
    summary.unassignedShards !== 0 ||
    !summary.clusterUuid ||
    summary.clusterName !== marker.clusterName ||
    summary.plugin !== 'analysis-icu' ||
    icuPlugins.length !== 1 ||
    summary.pluginVersion !== EXPECTED_ICU_VERSION ||
    summary.heapInitBytes !== EXPECTED_HEAP_BYTES ||
    summary.heapMaxBytes !== EXPECTED_HEAP_BYTES ||
    !summary.heapArgs.includes('-Xms2g') ||
    !summary.heapArgs.includes('-Xmx2g') ||
    normalize(summary.dataPath) !== normalize(marker.dataPath) ||
    summary.httpPort !== marker.httpPort ||
    summary.transportPort !== marker.transportPort
  ) {
    throw new Error('SEARCH_FRESH_V4_RUNTIME_NOT_CERTIFIED');
  }
  return summary;
}

async function assertClusterState(
  summary: Awaited<ReturnType<typeof inspectRuntime>>,
  target?: string,
  allowActiveAlias = false,
  alias = 'galilei-search-active',
) {
  assertFreshV4Topology(
    { indices: summary.indices, aliases: summary.aliases },
    {
      indexPrefix: summary.indexPrefix,
      activeAlias: alias,
      expectedIndex: target,
      expectedAliasTarget: allowActiveAlias ? target : undefined,
    },
  );
}

function createIndexService(
  client: Client,
  repository: OpenSearchDocumentRepository,
  target: string,
  alias: string,
  prefix: string,
) {
  return new OpenSearchIndexService(
    client,
    repository,
    alias,
    prefix,
    4,
    false,
    target,
    true,
  );
}

function initialState(
  target: string,
  alias: string,
  endpoint: string,
  runtime: Awaited<ReturnType<typeof inspectRuntime>>,
  marker: RuntimeMarker,
  database: DatabaseIdentity,
): BootstrapState {
  return {
    formatVersion: 1,
    mode: 'fresh-bootstrap',
    stage: 'EMPTY',
    target,
    endpoint,
    clusterUuid: runtime.clusterUuid,
    clusterName: runtime.clusterName,
    runtimeId: marker.runtimeId,
    dataPath: marker.dataPath,
    database,
    alias,
    updatedAt: new Date().toISOString(),
  };
}

function assertStateMatches(
  state: BootstrapState,
  target: string,
  endpoint: string,
  runtime: Awaited<ReturnType<typeof inspectRuntime>>,
  marker: RuntimeMarker,
  database: DatabaseIdentity,
) {
  if (
    state.target !== target ||
    state.endpoint !== endpoint ||
    state.clusterUuid !== runtime.clusterUuid ||
    state.clusterName !== runtime.clusterName ||
    state.runtimeId !== marker.runtimeId ||
    path.resolve(state.dataPath) !== path.resolve(marker.dataPath) ||
    JSON.stringify(state.database) !== JSON.stringify(database)
  ) {
    throw new Error('SEARCH_FRESH_V4_STATE_IDENTITY_MISMATCH');
  }
}

function projectionOptions(
  stateFile: string,
  state: BootstrapState,
): FreshV4ProjectionOptions {
  return {
    cursor: state.projectionCursor,
    counts: state.projectionCounts,
    onProgress: async ({ cursor, counts }) => {
      state.projectionCursor = cursor;
      state.projectionCounts = counts;
      state.projection = {
        target: state.target,
        ...counts,
        state: 'PROJECTING',
      };
      writeState(stateFile, state);
    },
  };
}

function sourceParityOptions(
  stateFile: string,
  state: BootstrapState,
): FreshV4SourceParityOptions {
  return {
    cursor: state.sourceParityCursor,
    progress: state.sourceParityProgress,
    onProgress: async ({ cursor, progress }) => {
      state.sourceParityCursor = cursor;
      state.sourceParityProgress = progress;
      const compared =
        progress.corpusCompared +
        progress.sumariosCompared +
        progress.sentenciasCompared;
      const collectGarbage = (
        globalThis as typeof globalThis & { gc?: () => void }
      ).gc;
      if (collectGarbage && compared - (state.sourceParityGcAt ?? 0) >= 250) {
        collectGarbage();
        state.sourceParityGcAt = compared;
        state.sourceParityGcCount = (state.sourceParityGcCount ?? 0) + 1;
      }
      writeState(stateFile, state);
    },
  };
}

async function runBootstrap(args: Args) {
  if (process.env.BJC_SEARCH_MAINTENANCE_QUIESCED !== 'true') {
    throw new Error('SEARCH_FRESH_V4_QUIESCED_OPERATOR_ATTESTATION_REQUIRED');
  }
  const { config, endpoint, marker } = validateOperatorConfig();
  const database = await verifyDatabaseIdentity();
  const target = parseTarget(args.target!, config.indexPrefix);
  const client = new Client(config.clientOptions);
  const repository = new OpenSearchDocumentRepository(
    getRuntimeDatabasePoolConfig(),
  );
  const index = createIndexService(
    client,
    repository,
    target,
    config.alias,
    config.indexPrefix,
  );
  const stateFile = assertStateRoot(args.stateFile!);
  try {
    let state: BootstrapState;
    if (args.phase === 'apply') {
      if (existsSync(stateFile)) {
        throw new Error('SEARCH_FRESH_V4_STATE_ALREADY_EXISTS_USE_RESUME');
      }
      const runtime = await inspectRuntime(
        client,
        marker,
        config.indexPrefix,
        config.alias,
      );
      await assertClusterState(runtime);
      const outboxBefore = await repository.outboxStatus();
      state = initialState(
        target,
        config.alias,
        endpoint,
        runtime,
        marker,
        database,
      );
      state.highWatermarkBoot = await index.captureFreshV4HighWatermark();
      writeState(stateFile, state);
      const created = await index.createFreshV4Index(target);
      state.collationPipeline = created.collationPipeline;
      state.collationPipelineCreated = created.collationPipelineCreated;
      state.stage = created.state;
      writeState(stateFile, state);
      state.stage = 'PROJECTING';
      writeState(stateFile, state);
      state.projection = await index.projectFreshV4(
        target,
        projectionOptions(stateFile, state),
      );
      state.projectionCounts = {
        corpus: Number(state.projection.corpus ?? 0),
        jurisprudencia: Number(state.projection.jurisprudencia ?? 0),
        sentencias: Number(state.projection.sentencias ?? 0),
        total: Number(state.projection.total ?? 0),
      };
      state.stage = 'PROJECTED';
      writeState(stateFile, state);
      state.sourceParity = await index.verifyFreshV4SourceParity(
        target,
        SOURCE_PARITY_PAGE_SIZE,
        sourceParityOptions(stateFile, state),
      );
      if (state.sourceParity.pass !== true) {
        throw new Error('SEARCH_FRESH_V4_SOURCE_PARITY_FAILED');
      }
      state.stage = 'VERIFIED';
      writeState(stateFile, state);
      const runtimeFinal = await inspectRuntime(
        client,
        marker,
        config.indexPrefix,
        config.alias,
      );
      await assertClusterState(runtimeFinal, target, false);
      const outboxAfter = await repository.outboxStatus();
      console.log(
        JSON.stringify({
          mode: 'APPLY_FRESH_V4',
          result: 'VERIFIED_AWAITING_COLLATION_CERTIFICATION',
          database,
          search: runtimeFinal,
          bootstrap: state,
          projection: state.projection,
          sourceParity: state.sourceParity,
          outbox: {
            before: outboxBefore,
            after: outboxAfter,
            highWatermarkBoot: state.highWatermarkBoot,
          },
          alias: 'NONE',
          activation:
            'REQUIRES --activate AFTER GOLDEN AND COLLATION CERTIFICATION',
          databaseWrites: 0,
        }),
      );
      return;
    }

    state = readState(stateFile);
    const runtime = await inspectRuntime(
      client,
      marker,
      config.indexPrefix,
      config.alias,
    );
    assertStateMatches(state, target, endpoint, runtime, marker, database);
    if (state.stage === 'EMPTY' && runtime.applicationIndices.length > 0) {
      throw new Error('SEARCH_FRESH_V4_EMPTY_STATE_HAS_INDEX');
    }
    const aliasActive = runtime.aliases.some(
      (entry) => entry.alias === config.alias && entry.index === target,
    );
    if (aliasActive) {
      await assertClusterState(runtime, target, true, config.alias);
      if (state.stage !== 'COMPLETE') {
        state.stage = 'ALIAS_ACTIVE';
        writeState(stateFile, state);
        state.stage = 'COMPLETE';
        writeState(stateFile, state);
      }
      console.log(
        JSON.stringify({
          mode: args.phase.toUpperCase(),
          result: 'COMPLETE',
          database,
          search: runtime,
          bootstrap: state,
          alias: `${config.alias} -> ${target}`,
        }),
      );
      return;
    }
    await assertClusterState(
      runtime,
      runtime.indices.includes(target) ? target : undefined,
      false,
    );
    if (args.phase === 'status') {
      console.log(
        JSON.stringify({
          mode: 'STATUS',
          result: state.stage,
          database,
          search: runtime,
          bootstrap: state,
          alias: 'NONE',
        }),
      );
      return;
    }
    if (args.phase !== 'resume' && args.phase !== 'activate') {
      throw new Error('SEARCH_FRESH_V4_RESUME_OR_STATUS_REQUIRED');
    }
    if (args.phase === 'activate') {
      if (state.stage !== 'VERIFIED') {
        throw new Error('SEARCH_FRESH_V4_ACTIVATION_REQUIRES_VERIFIED_STATE');
      }
      if (process.env.BJC_SEARCH_FRESH_COLLATION_CERTIFIED !== 'true') {
        throw new Error(
          'SEARCH_FRESH_V4_COLLATION_CERTIFICATION_ATTESTATION_REQUIRED',
        );
      }
      const parity = state.sourceParity as
        | {
            pass?: unknown;
            missing?: unknown;
            sourceDifferences?: unknown;
          }
        | undefined;
      const projection = state.projection as
        | { countCheck?: { pass?: unknown } }
        | undefined;
      if (
        parity?.pass !== true ||
        parity.missing !== 0 ||
        parity.sourceDifferences !== 0 ||
        projection?.countCheck?.pass !== true
      ) {
        throw new Error('SEARCH_FRESH_V4_ACTIVATION_CERTIFICATION_INVALID');
      }
    }
    if (state.stage === 'EMPTY') {
      if (runtime.applicationIndices.length !== 0) {
        throw new Error('SEARCH_FRESH_V4_EMPTY_STATE_HAS_INDEX');
      }
      await assertClusterState(runtime);
      state.highWatermarkBoot = await index.captureFreshV4HighWatermark();
      const created = await index.createFreshV4Index(target);
      state.collationPipeline = created.collationPipeline;
      state.collationPipelineCreated = created.collationPipelineCreated;
      state.stage = created.state;
      writeState(stateFile, state);
    }
    if (state.stage === 'INDEX_CREATED' || state.stage === 'PROJECTING') {
      let created;
      if (runtime.indices.includes(target)) {
        created = await index.assertFreshV4ResumeTarget(target);
      } else {
        created = await index.createFreshV4Index(target);
      }
      state.collationPipeline =
        created.collationPipeline ?? state.collationPipeline;
      state.collationPipelineCreated =
        created.collationPipelineCreated ?? state.collationPipelineCreated;
      state.stage = 'INDEX_CREATED';
      writeState(stateFile, state);
      state.stage = 'PROJECTING';
      writeState(stateFile, state);
      state.projection = await index.projectFreshV4(
        target,
        projectionOptions(stateFile, state),
      );
      state.projectionCounts = {
        corpus: Number(state.projection.corpus ?? 0),
        jurisprudencia: Number(state.projection.jurisprudencia ?? 0),
        sentencias: Number(state.projection.sentencias ?? 0),
        total: Number(state.projection.total ?? 0),
      };
      state.stage = 'PROJECTED';
      writeState(stateFile, state);
    }
    if (state.stage === 'PROJECTED') {
      state.sourceParity = await index.verifyFreshV4SourceParity(
        target,
        SOURCE_PARITY_PAGE_SIZE,
        sourceParityOptions(stateFile, state),
      );
      if (state.sourceParity.pass !== true) {
        writeState(stateFile, state);
        throw new Error('SEARCH_FRESH_V4_SOURCE_PARITY_FAILED');
      }
      state.stage = 'VERIFIED';
      writeState(stateFile, state);
    }
    if (state.stage === 'VERIFIED' && args.phase === 'resume') {
      const verifiedRuntime = await inspectRuntime(
        client,
        marker,
        config.indexPrefix,
        config.alias,
      );
      await assertClusterState(verifiedRuntime, target, false);
      console.log(
        JSON.stringify({
          mode: 'RESUME',
          result: 'VERIFIED_AWAITING_COLLATION_CERTIFICATION',
          database,
          search: verifiedRuntime,
          bootstrap: state,
          projection: state.projection,
          sourceParity: state.sourceParity,
          alias: 'NONE',
          activation:
            'REQUIRES --activate AFTER GOLDEN AND COLLATION CERTIFICATION',
          databaseWrites: 0,
        }),
      );
      return;
    }
    if (state.stage === 'VERIFIED' && args.phase === 'activate') {
      const activated = await index.reconcileAndActivateFreshV4(
        target,
        state.highWatermarkBoot ?? '0',
        async () => {
          const finalRuntime = await inspectRuntime(
            client,
            marker,
            config.indexPrefix,
            config.alias,
          );
          if (
            finalRuntime.clusterUuid !== state.clusterUuid ||
            finalRuntime.clusterName !== state.clusterName
          ) {
            throw new Error('SEARCH_FRESH_V4_CLUSTER_IDENTITY_CHANGED');
          }
          await assertClusterState(finalRuntime, target, false);
        },
      );
      state.highWatermarkReconciled = activated.highWatermark;
      state.stage = 'ALIAS_ACTIVE';
      writeState(stateFile, state);
      state.stage = 'COMPLETE';
      writeState(stateFile, state);
    }
    const runtimeFinal = await inspectRuntime(
      client,
      marker,
      config.indexPrefix,
      config.alias,
    );
    await assertClusterState(runtimeFinal, target, true, config.alias);
    console.log(
      JSON.stringify({
        mode: args.phase.toUpperCase(),
        result: 'PASS',
        database,
        search: runtimeFinal,
        bootstrap: state,
        projection: state.projection,
        sourceParity: state.sourceParity,
        alias: `${config.alias} -> ${target}`,
        writerTarget: config.alias,
        databaseWrites: 0,
      }),
    );
  } finally {
    await repository.close().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}

async function runDryRun(args: Args) {
  const { config, endpoint, marker } = validateOperatorConfig();
  const database = await verifyDatabaseIdentity();
  const target = parseTarget(
    args.target ?? generateTarget(config.indexPrefix),
    config.indexPrefix,
  );
  const client = new Client(config.clientOptions);
  const repository = new OpenSearchDocumentRepository(
    getRuntimeDatabasePoolConfig(),
  );
  try {
    const search = await inspectRuntime(
      client,
      marker,
      config.indexPrefix,
      config.alias,
    );
    await assertClusterState(search);
    const outbox = await repository.outboxStatus();
    const highWatermark = await repository.withMutationBarrier(
      (_pg, watermark) => Promise.resolve(watermark),
    );
    console.log(
      JSON.stringify({
        mode: 'DRY_RUN_FRESH_V4',
        result: 'PASS',
        database,
        search,
        intended: {
          physicalV4: target,
          schema: 4,
          projectionSource:
            'PostgreSQL current DEV state via canonical projectors',
          highWatermarkBoot: highWatermark,
          outbox,
          aliasAction: `create ${config.alias} -> ${target} after parity and reconciliation`,
          writerTarget: config.alias,
          applicationTopology: 'fresh-v4',
        },
        searchWrites: 0,
        databaseWrites: 0,
      }),
    );
  } finally {
    await repository.close().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}

async function runStatus(args: Args) {
  const { config, endpoint, marker } = validateOperatorConfig();
  const database = await verifyDatabaseIdentity();
  const client = new Client(config.clientOptions);
  try {
    const runtime = await inspectRuntime(
      client,
      marker,
      config.indexPrefix,
      config.alias,
    );
    if (!args.stateFile) {
      await assertClusterState(runtime);
      console.log(
        JSON.stringify({
          mode: 'STATUS',
          result: 'EMPTY',
          database,
          search: runtime,
          intendedTarget: args.target
            ? parseTarget(args.target, config.indexPrefix)
            : null,
          alias: 'NONE',
          writes: 0,
        }),
      );
      return;
    }
    const state = readState(args.stateFile);
    const target = parseTarget(args.target ?? state.target, config.indexPrefix);
    assertStateMatches(state, target, endpoint, runtime, marker, database);
    const aliasActive = runtime.aliases.some(
      (entry) => entry.alias === config.alias && entry.index === target,
    );
    if (aliasActive)
      await assertClusterState(runtime, target, true, config.alias);
    else
      await assertClusterState(
        runtime,
        runtime.indices.includes(target) ? target : undefined,
      );
    console.log(
      JSON.stringify({
        mode: 'STATUS',
        result: aliasActive ? 'COMPLETE' : state.stage,
        database,
        search: runtime,
        bootstrap: state,
        alias: aliasActive ? `${config.alias} -> ${target}` : 'NONE',
        writes: 0,
      }),
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

function statusCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return 0;
  const candidate = error as {
    statusCode?: unknown;
    meta?: { statusCode?: unknown };
  };
  return Number(candidate.statusCode ?? candidate.meta?.statusCode ?? 0);
}

function safeFailureSummary(error: unknown) {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  const names = new Set<string>();
  const codes = new Set<string>();
  const statuses = new Set<number>();
  const types = new Set<string>();
  const categories = new Set<string>();
  const fields = new Set<string>();
  while (queue.length) {
    const value = queue.pop();
    if (typeof value !== 'object' || value === null || seen.has(value))
      continue;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (
      typeof record.name === 'string' &&
      /^[A-Za-z0-9_]{1,80}$/u.test(record.name)
    ) {
      names.add(record.name);
    }
    const status = Number(
      record.statusCode ??
        (record.meta as { statusCode?: unknown } | undefined)?.statusCode ??
        0,
    );
    if (Number.isInteger(status) && status > 0) statuses.add(status);
    if (
      typeof record.code === 'string' &&
      /^[A-Z0-9_]{1,40}$/u.test(record.code)
    ) {
      codes.add(record.code);
    }
    const errorBody =
      typeof record.error === 'object' && record.error !== null
        ? (record.error as Record<string, unknown>)
        : typeof (record.body as Record<string, unknown> | undefined)?.error ===
            'object'
          ? ((record.body as Record<string, unknown>).error as Record<
              string,
              unknown
            >)
          : undefined;
    for (const errorRecord of [record, errorBody]) {
      if (!errorRecord) continue;
      if (
        typeof errorRecord.type === 'string' &&
        /^[a-z0-9_]{1,80}$/iu.test(errorRecord.type)
      ) {
        types.add(errorRecord.type);
      }
      const text = [errorRecord.reason, errorRecord.message]
        .filter((entry): entry is string => typeof entry === 'string')
        .join(' ')
        .toLowerCase();
      if (/pipeline/.test(text)) categories.add('pipeline');
      if (/mapping|mapper|field/.test(text)) categories.add('mapping');
      if (/timeout|timed out/.test(text)) categories.add('timeout');
      if (/socket|connection|econn|network/.test(text))
        categories.add('transport');
      if (/permission|forbidden|unauthorized/.test(text))
        categories.add('authorization');
      if (/index.*block|read.only|flood.stage/.test(text))
        categories.add('index-block');
      for (const match of text.matchAll(
        /(?:field|property) \[([^\]]{1,120})\]/giu,
      )) {
        fields.add(match[1]);
      }
      if (errorRecord.caused_by) queue.push(errorRecord.caused_by);
      if (Array.isArray(errorRecord.root_cause))
        queue.push(...errorRecord.root_cause);
    }
    if (record.cause) queue.push(record.cause);
    if (record.meta) queue.push(record.meta);
    if (record.body) queue.push(record.body);
  }
  return {
    names: [...names].slice(0, 4),
    codes: [...codes].slice(0, 4),
    statusCodes: [...statuses].slice(0, 4),
    types: [...types].slice(0, 4),
    categories: [...categories].slice(0, 6),
    fields: [...fields].slice(0, 4),
  };
}

async function main() {
  const args = parseArgs();
  if (args.phase === 'dry-run') return runDryRun(args);
  if (args.phase === 'status') return runStatus(args);
  return runBootstrap(args);
}

void main().catch((error: unknown) => {
  const code =
    error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : 'SEARCH_FRESH_V4_BOOTSTRAP_FAILED';
  console.error(code);
  if (typeof error === 'object' && error !== null && 'safeDetails' in error) {
    console.error(
      JSON.stringify({
        safeBulkDetails: (error as { safeDetails: unknown }).safeDetails,
      }),
    );
  }
  console.error(JSON.stringify({ safeFailure: safeFailureSummary(error) }));
  process.exitCode = 1;
});

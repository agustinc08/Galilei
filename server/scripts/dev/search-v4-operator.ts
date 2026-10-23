import { readFileSync } from 'node:fs';
import { Client } from '@opensearch-project/opensearch';
import { Client as PgClient } from 'pg';
import { getRuntimeDatabasePoolConfig } from '../../src/config/runtime-database-config';
import { OpenSearchDocumentRepository } from '../../src/busqueda/opensearch/opensearch-document.repository';
import { OpenSearchIndexService } from '../../src/busqueda/opensearch/opensearch-index.service';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import {
  evaluateSearchCutoverPreflight,
  type SearchCutoverDirection,
} from '../../src/busqueda/opensearch/search-cutover-state';

const EXPECTED_BUILD = '97d3c13bf22a4a72ac11dc503fe44c97662b9161';
const EXPECTED_ICU = '2.19.6';
const EXPECTED_HEAP = 2_147_483_648;
const DEFAULT_V3 = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const DEFAULT_V4 = 'galilei-search-v004-20261020t094732495z-6015e394';
const DEFAULT_ALIAS = 'galilei-search-active';

type OperatorArgs = {
  action: 'replay' | 'cutover' | 'rollback';
  schema?: '3' | '4';
  target?: string;
  after?: string;
  v3?: string;
  v4?: string;
  alias?: string;
  expectedAliasTarget?: string;
  mode?: 'dry-run' | 'apply' | 'preflight';
};

function loadLocalEnvironment() {
  const lines = readFileSync('.env.development.local', 'utf8').split(/\r?\n/u);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const raw = match[2];
    const quoted =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"));
    process.env[match[1]] = quoted ? raw.slice(1, -1) : raw;
  }
}

function parseArgs(): OperatorArgs {
  const encoded = process.env.BJC_SEARCH_V4_OPERATOR_ARGS;
  if (!encoded) throw new Error('SEARCH_V4_OPERATOR_ARGS_REQUIRED');
  let values: string[];
  try {
    values = JSON.parse(encoded) as string[];
  } catch {
    throw new Error('SEARCH_V4_OPERATOR_ARGS_INVALID');
  }
  const action = values[0] as OperatorArgs['action'];
  if (!['replay', 'cutover', 'rollback'].includes(action)) {
    throw new Error('SEARCH_V4_OPERATOR_ACTION_INVALID');
  }
  const result: OperatorArgs = { action };
  const valuesByOption: Record<string, keyof OperatorArgs> = {
    '--schema': 'schema',
    '--target': 'target',
    '--after': 'after',
    '--v3': 'v3',
    '--v4': 'v4',
    '--alias': 'alias',
    '--expected-alias-target': 'expectedAliasTarget',
  };
  for (let i = 1; i < values.length; i += 1) {
    const token = values[i];
    if (token === '--dry-run') result.mode = 'dry-run';
    else if (token === '--preflight') result.mode = 'preflight';
    else if (token === '--apply') result.mode = 'apply';
    else {
      const option = valuesByOption[token];
      const value = values[i + 1];
      if (!option || !value || value.startsWith('--')) {
        throw new Error('SEARCH_V4_OPERATOR_ARGUMENT_INVALID');
      }
      if (option === 'schema' && value !== '3' && value !== '4') {
        throw new Error('SEARCH_V4_OPERATOR_SCHEMA_INVALID');
      }
      switch (option) {
        case 'schema':
          result.schema = value as '3' | '4';
          break;
        case 'target':
          result.target = value;
          break;
        case 'after':
          result.after = value;
          break;
        case 'v3':
          result.v3 = value;
          break;
        case 'v4':
          result.v4 = value;
          break;
        case 'alias':
          result.alias = value;
          break;
        case 'expectedAliasTarget':
          result.expectedAliasTarget = value;
          break;
        default:
          throw new Error('SEARCH_V4_OPERATOR_ARGUMENT_INVALID');
      }
      i += 1;
    }
  }
  if (
    values.filter((value) =>
      ['--dry-run', '--preflight', '--apply'].includes(value),
    ).length > 1
  ) {
    throw new Error('SEARCH_V4_OPERATOR_MODE_CONFLICT');
  }
  return result;
}

async function verifyDatabaseIdentity() {
  const pg = new PgClient({
    ...getRuntimeDatabasePoolConfig(),
    connectionTimeoutMillis: 5000,
    application_name: 'bjc-search-v4-operator',
  });
  await pg.connect();
  try {
    await pg.query('BEGIN READ ONLY');
    const result = await pg.query<{
      database: string;
      role: string;
      address: string;
      port: number;
      version: string;
    }>(`
      SELECT current_database() AS database, current_user AS role,
             host(inet_server_addr()) AS address, inet_server_port() AS port,
             current_setting('server_version') AS version
    `);
    const row = result.rows[0];
    const version = Number(row.version.split('.')[0]);
    if (
      row.database !== 'buscador_juridico_civil_dev' ||
      row.role !== 'bjc_dev' ||
      row.address !== '127.0.0.1' ||
      row.port !== 55432 ||
      version !== 16
    ) {
      throw new Error('PRINCIPAL_DEV_DATABASE_IDENTITY_REJECTED');
    }
    await pg.query('COMMIT');
    return {
      endpoint: '127.0.0.1:55432',
      database: row.database,
      role: row.role,
      server: row.version,
      transaction: 'READ ONLY',
    };
  } catch (error) {
    await pg.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await pg.end();
  }
}

function makeClient(schema: '3' | '4', target: string, writer: boolean) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENSEARCH_SEARCH_SCHEMA_VERSION: schema,
    OPENSEARCH_READ_ONLY_CANDIDATE:
      schema === '4' && !writer ? 'true' : 'false',
    OPENSEARCH_TRUSTED_PHYSICAL_WRITE: writer ? 'true' : 'false',
  };
  if (writer || schema === '4') env.OPENSEARCH_SEARCH_TARGET = target;
  else delete env.OPENSEARCH_SEARCH_TARGET;
  const config = readOpenSearchConfig(env);
  return {
    config,
    client: new Client(config.clientOptions),
  };
}

function validatePhysicalTarget(target: string, schema: '3' | '4') {
  const pattern = new RegExp(
    `^galilei-search-v00${schema}-\\d{8}t\\d{9}z-[a-f0-9]{8}$`,
    'u',
  );
  if (!pattern.test(target))
    throw new Error('SEARCH_V4_OPERATOR_TARGET_INVALID');
}

async function assertPhysicalSchema(
  client: Client,
  target: string,
  schema: '3' | '4',
) {
  const exists = bodyOf<boolean>(
    await client.indices.exists({ index: target }),
  );
  if (!exists) throw new Error('SEARCH_V4_OPERATOR_TARGET_MISSING');
  const mappings = bodyOf<Record<string, unknown>>(
    await client.indices.getMapping({ index: target }),
  );
  const targetMapping = mappings[target] as
    | { mappings?: { _meta?: { galileiSearchSchemaVersion?: unknown } } }
    | undefined;
  if (
    targetMapping?.mappings?._meta?.galileiSearchSchemaVersion !==
    Number(schema)
  ) {
    throw new Error('SEARCH_V4_OPERATOR_TARGET_SCHEMA_MISMATCH');
  }
}

async function assertReplayPreconditions(
  client: Client,
  target: string,
  schema: '3' | '4',
  expectedAliasTarget: string,
) {
  const expectedAliasIndex =
    expectedAliasTarget === 'v3'
      ? DEFAULT_V3
      : expectedAliasTarget === 'v4'
        ? DEFAULT_V4
        : expectedAliasTarget;
  if (![DEFAULT_V3, DEFAULT_V4].includes(expectedAliasIndex)) {
    throw new Error('SEARCH_V4_OPERATOR_EXPECTED_ALIAS_TARGET_INVALID');
  }
  const [
    infoResponse,
    healthResponse,
    pluginsResponse,
    nodesResponse,
    aliasResponse,
  ] = await Promise.all([
    client.info(),
    client.cluster.health(),
    client.cat.plugins({ format: 'json' }),
    client.transport.request({ method: 'GET', path: '/_nodes/_local/jvm' }),
    client.indices.getAlias({ name: DEFAULT_ALIAS }),
  ]);
  const info = bodyOf<{ version?: { build_hash?: string } }>(infoResponse);
  if (info.version?.build_hash !== EXPECTED_BUILD) {
    throw new Error('SEARCH_V4_OPERATOR_BUILD_MISMATCH');
  }
  const health = bodyOf<{ status?: string }>(healthResponse);
  if (health.status !== 'green') {
    throw new Error('SEARCH_V4_OPERATOR_CLUSTER_NOT_GREEN');
  }
  const plugins =
    bodyOf<Array<{ component?: string; version?: string }>>(pluginsResponse);
  if (
    plugins.find((plugin) => plugin.component === 'analysis-icu')?.version !==
    EXPECTED_ICU
  ) {
    throw new Error('SEARCH_V4_OPERATOR_ICU_MISMATCH');
  }
  const nodes = bodyOf<{
    nodes?: Record<
      string,
      {
        jvm?: {
          mem?: { heap_init_in_bytes?: number; heap_max_in_bytes?: number };
          input_arguments?: string[];
        };
      }
    >;
  }>(nodesResponse);
  const runtimeNode = Object.values(nodes.nodes ?? {})[0];
  const jvm = runtimeNode?.jvm;
  const heapArgs = jvm?.input_arguments ?? [];
  if (
    Number(jvm?.mem?.heap_init_in_bytes ?? 0) !== EXPECTED_HEAP ||
    Number(jvm?.mem?.heap_max_in_bytes ?? 0) !== EXPECTED_HEAP ||
    !heapArgs.includes('-Xms2g') ||
    !heapArgs.includes('-Xmx2g')
  ) {
    throw new Error('SEARCH_V4_OPERATOR_HEAP_MISMATCH');
  }
  const aliasTargets = Object.keys(
    bodyOf<Record<string, unknown>>(aliasResponse),
  );
  if (aliasTargets.length !== 1 || aliasTargets[0] !== expectedAliasIndex) {
    throw new Error('SEARCH_V4_OPERATOR_ALIAS_STATE_MISMATCH');
  }
  await assertPhysicalSchema(client, target, schema);
  return {
    buildHash: info.version?.build_hash,
    clusterHealth: health.status,
    analysisIcu: EXPECTED_ICU,
    heapBytes: EXPECTED_HEAP,
    aliasTargets,
    target,
    schemaVersion: Number(schema),
  };
}

async function operatorReplay(args: OperatorArgs) {
  if (
    !args.schema ||
    !args.target ||
    !args.after ||
    !args.expectedAliasTarget
  ) {
    throw new Error(
      'SEARCH_V4_REPLAY_REQUIRES_SCHEMA_TARGET_AFTER_AND_EXPECTED_ALIAS_TARGET',
    );
  }
  if (args.mode !== 'apply' && args.mode !== 'dry-run') {
    throw new Error('SEARCH_V4_REPLAY_MODE_REQUIRED');
  }
  validatePhysicalTarget(args.target, args.schema);
  const database = await verifyDatabaseIdentity();
  const repository = new OpenSearchDocumentRepository(
    getRuntimeDatabasePoolConfig(),
  );
  const { config, client } = makeClient(
    args.schema,
    args.target,
    args.mode === 'apply',
  );
  try {
    const preconditions = await assertReplayPreconditions(
      client,
      args.target,
      args.schema,
      args.expectedAliasTarget,
    );
    if (args.mode === 'dry-run') {
      const preview = await repository.withMutationBarrier(
        async (pg, highWatermark) => {
          let changedKeys = 0;
          let afterDocumentKey = '';
          for (;;) {
            const page = await repository.outboxChangesPage(
              pg,
              args.after!,
              highWatermark,
              afterDocumentKey,
              250,
            );
            if (!page.length) break;
            changedKeys += page.length;
            afterDocumentKey = page[page.length - 1];
          }
          return {
            target: args.target,
            schemaVersion: Number(args.schema),
            afterWatermark: args.after,
            highWatermark,
            changedKeys,
            outboxThrough: await repository.outboxSnapshotThrough(
              pg,
              highWatermark,
            ),
          };
        },
      );
      console.log(
        JSON.stringify({
          mode: 'DRY_RUN',
          database,
          preconditions,
          ...preview,
          opensearchWrites: 0,
          aliasWrites: 0,
        }),
      );
      return;
    }

    const service = new OpenSearchIndexService(
      client,
      repository,
      'galilei-search-active',
      'galilei-search',
      Number(args.schema) as 3 | 4,
      false,
      args.target,
      true,
    );
    const result =
      args.schema === '4'
        ? await service.replayShadowChanges(args.target, args.after, {
            requireOutboxClear: true,
          })
        : await service.replayPhysicalChanges(args.target, args.after, {
            requireOutboxClear: true,
          });
    console.log(
      JSON.stringify({
        mode: 'APPLIED_TO_PHYSICAL_INDEX_ONLY',
        database,
        preconditions,
        ...result,
        aliasWrites: 0,
        outboxStatusesChanged: false,
      }),
    );
    await service.close();
  } finally {
    await repository.close().catch(() => undefined);
    await client.close().catch(() => undefined);
    void config;
  }
}

async function cutoverDryRun(
  args: OperatorArgs,
  direction: SearchCutoverDirection,
) {
  if (!args.v3 || !args.v4 || !args.alias) {
    throw new Error('SEARCH_V4_CUTOVER_REQUIRES_EXACT_INDEX_AND_ALIAS_NAMES');
  }
  if (
    args.v3 !== DEFAULT_V3 ||
    args.v4 !== DEFAULT_V4 ||
    args.alias !== DEFAULT_ALIAS
  ) {
    throw new Error('SEARCH_V4_CUTOVER_EXPECTED_INDEX_IDENTITY_MISMATCH');
  }
  if (args.mode === 'apply') {
    throw new Error('SEARCH_V4_CUTOVER_APPLY_NOT_ENABLED_IN_THIS_CANDIDATE');
  }
  if (args.mode !== 'preflight' && args.mode !== 'dry-run') {
    throw new Error('SEARCH_V4_CUTOVER_MODE_REQUIRED');
  }
  const database = await verifyDatabaseIdentity();
  const repo = new OpenSearchDocumentRepository(getRuntimeDatabasePoolConfig());
  const { config, client } = makeClient('4', args.v4, false);
  const target = direction === 'V3_TO_V4' ? args.v4 : args.v3;
  const targetSchema: '3' | '4' = direction === 'V3_TO_V4' ? '4' : '3';
  const writerConfig = readOpenSearchConfig({
    ...process.env,
    OPENSEARCH_SEARCH_SCHEMA_VERSION: targetSchema,
    OPENSEARCH_SEARCH_TARGET: target,
    OPENSEARCH_READ_ONLY_CANDIDATE: 'false',
    OPENSEARCH_TRUSTED_PHYSICAL_WRITE: 'true',
  });
  const v3Service = new OpenSearchIndexService(
    client,
    repo,
    args.alias,
    'galilei-search',
    3,
    false,
    args.alias,
  );
  const v4Service = new OpenSearchIndexService(
    client,
    repo,
    args.alias,
    'galilei-search',
    4,
    true,
    args.v4,
  );
  try {
    const [
      rootResult,
      healthResult,
      pluginsResult,
      nodesResult,
      v3CountResult,
      v4CountResult,
      aliasResult,
      outbox,
    ] = await Promise.all([
      client.info(),
      client.cluster.health(),
      client.cat.plugins({ format: 'json' }),
      client.transport.request({ method: 'GET', path: '/_nodes/_local/jvm' }),
      client.count({ index: args.v3, body: { query: { match_all: {} } } }),
      client.count({ index: args.v4, body: { query: { match_all: {} } } }),
      client.indices.getAlias({ name: args.alias }),
      repo.outboxStatus(),
    ]);
    const root = bodyOf<{ version?: { build_hash?: string } }>(rootResult);
    const health = bodyOf<{ status?: string }>(healthResult).status;
    const plugins =
      bodyOf<Array<{ component?: string; version?: string }>>(pluginsResult);
    const icu = plugins.find((plugin) => plugin.component === 'analysis-icu');
    const aliasTargets = Object.keys(
      bodyOf<Record<string, unknown>>(aliasResult),
    );
    const v3Count = bodyOf<{ count: number }>(v3CountResult).count;
    const v4Count = bodyOf<{ count: number }>(v4CountResult).count;
    const nodeInfo = bodyOf<{
      nodes?: Record<
        string,
        {
          jvm?: {
            mem?: { heap_init_in_bytes?: number; heap_max_in_bytes?: number };
            input_arguments?: string[];
          };
        }
      >;
    }>(nodesResult);
    const runtimeNode = Object.values(nodeInfo.nodes ?? {})[0];
    const runtimeHeap = Number(runtimeNode?.jvm?.mem?.heap_max_in_bytes ?? 0);
    const runtimeHeapInit = Number(
      runtimeNode?.jvm?.mem?.heap_init_in_bytes ?? 0,
    );
    const runtimeHeapArgs = runtimeNode?.jvm?.input_arguments ?? [];
    const parityService = direction === 'V3_TO_V4' ? v4Service : v3Service;
    const parity = await parityService.verifyTarget(target);
    const parityPass =
      parity.exactIdEquality &&
      parity.missing.length === 0 &&
      parity.extra.length === 0;
    const maintenanceAttestation =
      process.env.BJC_SEARCH_MAINTENANCE_QUIESCED === 'true';
    const result = evaluateSearchCutoverPreflight({
      direction,
      aliasTargets,
      v3: args.v3,
      v4: args.v4,
      databaseIdentityCertified: true,
      opensearchBuildMatches: root.version?.build_hash === EXPECTED_BUILD,
      clusterGreen: health === 'green',
      icuVersion: icu?.version ?? '',
      expectedIcuVersion: EXPECTED_ICU,
      heapBytes:
        runtimeHeap === runtimeHeapInit &&
        runtimeHeapArgs.includes('-Xms2g') &&
        runtimeHeapArgs.includes('-Xmx2g')
          ? runtimeHeap
          : 0,
      expectedHeapBytes: EXPECTED_HEAP,
      outboxPendingThroughCut: outbox.pending,
      outboxFailedThroughCut: outbox.failed,
      mutationEntryPointStopped: maintenanceAttestation,
      projectorStopped: maintenanceAttestation,
      writerTargetReady:
        writerConfig.searchTarget === target &&
        writerConfig.searchSchemaVersion === Number(targetSchema) &&
        writerConfig.trustedPhysicalWriter,
      v3Exists: v3Count === 69313,
      v4Exists: v4Count === 69313,
      targetParityPass: parityPass,
    });
    if (args.mode === 'preflight' && direction === 'V3_TO_V4') {
      validatePhysicalTarget(args.v4, '4');
    }
    console.log(
      JSON.stringify({
        mode: args.mode === 'preflight' ? 'PREFLIGHT' : 'DRY_RUN',
        database,
        search: {
          node: config.node,
          buildHash: root.version?.build_hash ?? null,
          clusterHealth: health,
          expectedBuild: EXPECTED_BUILD,
          analysisIcu: icu?.version ?? null,
          heapInitBytes: runtimeHeapInit,
          heapMaxBytes: runtimeHeap,
          writerTarget: {
            index: writerConfig.searchTarget,
            schemaVersion: writerConfig.searchSchemaVersion,
            trustedPhysicalWriter: writerConfig.trustedPhysicalWriter,
          },
          v3: { index: args.v3, documents: v3Count },
          v4: { index: args.v4, documents: v4Count },
          aliasTargets,
          targetParity: {
            schema: targetSchema,
            expected: parity.expectedIds,
            actual: parity.indexedIds,
            missing: parity.missing.length,
            extra: parity.extra.length,
            pass: parityPass,
          },
          outbox,
        },
        maintenanceAttestation,
        stateMachine: result,
        aliasWrites: 0,
      }),
    );
  } finally {
    await repo.close().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}

function bodyOf<T>(response: unknown): T {
  return response && typeof response === 'object' && 'body' in response
    ? (response as { body: T }).body
    : (response as T);
}

function main() {
  loadLocalEnvironment();
  const args = parseArgs();
  if (args.action === 'replay') return operatorReplay(args);
  if (args.action === 'cutover') return cutoverDryRun(args, 'V3_TO_V4');
  return cutoverDryRun(args, 'V4_TO_V3');
}

void main().catch((error: unknown) => {
  const code =
    error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : 'SEARCH_V4_OPERATOR_FAILED';
  console.error(code);
  process.exitCode = 1;
});

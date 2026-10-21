import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@opensearch-project/opensearch';
import { Client as PgClient } from 'pg';
import { getRuntimeDatabasePoolConfig } from '../../src/config/runtime-database-config';
import { OpenSearchDocumentRepository } from '../../src/busqueda/opensearch/opensearch-document.repository';
import { OpenSearchIndexService } from '../../src/busqueda/opensearch/opensearch-index.service';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import { OpenSearchSyncWorker } from '../../src/busqueda/opensearch/opensearch-sync.worker';

const EXPECTED_BUILD = '97d3c13bf22a4a72ac11dc503fe44c97662b9161';
const EXPECTED_DOCUMENTS = 69_313;
const ALIAS = 'galilei-search-active';

type RuntimeMarker = {
  clusterName: string;
  clusterUuid: string;
  endpoint: string;
  dataPath: string;
  home: string;
  configPath: string;
  httpPort: number;
  transportPort: number;
};

type SearchDocument = {
  id: string;
  indexSchemaVersion: number;
  title: string;
  sortFields?: {
    numeroSentencia?: string | null;
    numeroSentenciaCollation?: string;
  };
};

function bodyOf<T>(response: unknown): T {
  return response && typeof response === 'object' && 'body' in response
    ? (response as { body: T }).body
    : (response as T);
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`SEARCH_FRESH_LIFECYCLE_${name}_REQUIRED`);
  return value;
}

async function main() {
  const config = readOpenSearchConfig();
  const markerPath = path.resolve(
    requiredEnvironment('BJC_SEARCH_FRESH_RUNTIME_MARKER'),
  );
  const marker = JSON.parse(
    await readFile(markerPath, 'utf8'),
  ) as RuntimeMarker;
  const expectedPhysical = requiredEnvironment(
    'BJC_SEARCH_FRESH_V4_PHYSICAL_INDEX',
  );
  const artifactRoot = process.env.BJC_SEARCH_FRESH_ARTIFACT_ROOT?.trim();

  if (
    config.topology !== 'fresh-v4' ||
    config.searchSchemaVersion !== 4 ||
    config.readOnlyCandidate ||
    config.trustedPhysicalWriter ||
    config.searchTarget !== ALIAS ||
    config.alias !== ALIAS ||
    config.node !== marker.endpoint ||
    marker.httpPort !== Number(new URL(marker.endpoint).port) ||
    !/^galilei-search-v004-\d{8}t\d{9}z-[a-f0-9]{8}$/u.test(expectedPhysical)
  ) {
    throw new Error('SEARCH_FRESH_LIFECYCLE_TOPOLOGY_REJECTED');
  }

  const pg = new PgClient({
    ...getRuntimeDatabasePoolConfig(),
    connectionTimeoutMillis: 5_000,
    application_name: 'bjc-search-fresh-v4-lifecycle',
  });
  const client = new Client(config.clientOptions);
  const repository = new OpenSearchDocumentRepository(
    getRuntimeDatabasePoolConfig(),
  );
  const index = new OpenSearchIndexService(
    client,
    repository,
    config.alias,
    config.indexPrefix,
    4,
    false,
    config.searchTarget,
    false,
    true,
  );
  const worker = new OpenSearchSyncWorker(repository, index, 100, 25);
  const fixtureA = `FRESHV4-${randomUUID().slice(0, 12).toUpperCase()}`;
  const fixtureB = `${fixtureA}-UPDATED`;
  let sentenciaId: number | null = null;
  let pgConnected = false;
  let failure: unknown;
  let cleanupFailure: unknown;
  let outboxBefore: Awaited<ReturnType<typeof repository.outboxStatus>> | null =
    null;
  const checks: Record<string, boolean> = {};

  try {
    await pg.connect();
    pgConnected = true;
    await pg.query('BEGIN READ ONLY');
    const identity = await pg.query<{
      database: string;
      role: string;
      address: string;
      port: number;
      version: string;
    }>(`SELECT current_database() AS database, current_user AS role,
              host(inet_server_addr()) AS address, inet_server_port() AS port,
              current_setting('server_version') AS version`);
    const db = identity.rows[0];
    const otherActive = await pg.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND backend_type = 'client backend'
          AND state = 'active'`,
    );
    await pg.query('COMMIT');
    if (
      db?.database !== 'buscador_juridico_civil_dev' ||
      db.role !== 'bjc_dev' ||
      db.address !== '127.0.0.1' ||
      Number(db.port) !== 55432 ||
      Number(db.version.split('.')[0]) !== 16 ||
      Number(otherActive.rows[0]?.count ?? -1) !== 0
    ) {
      throw new Error('SEARCH_FRESH_LIFECYCLE_DATABASE_IDENTITY_REJECTED');
    }

    const [
      infoResponse,
      healthResponse,
      pluginResponse,
      nodeResponse,
      clusterResponse,
      aliasResponse,
      indexResponse,
      outbox,
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
        path: '/_cluster/state/metadata',
      }),
      client.indices.getAlias({ name: ALIAS }),
      client.transport.request({
        method: 'GET',
        path: '/_cat/indices?format=json&h=index',
      }),
      repository.outboxStatus(),
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
      bodyOf<Array<{ component?: string; version?: string }>>(pluginResponse);
    const nodes = bodyOf<{
      nodes?: Record<
        string,
        {
          settings?: Record<string, unknown>;
          jvm?: {
            mem?: { heap_max_in_bytes?: number };
            input_arguments?: string[];
          };
        }
      >;
    }>(nodeResponse);
    const cluster = bodyOf<{ cluster_uuid?: string }>(clusterResponse);
    const aliases = Object.keys(bodyOf<Record<string, unknown>>(aliasResponse));
    const indices = bodyOf<Array<{ index?: string }>>(indexResponse)
      .map((item) => item.index ?? '')
      .filter(Boolean);
    const node = Object.values(nodes.nodes ?? {})[0];
    const icu = plugins.find((plugin) => plugin.component === 'analysis-icu');
    const alias =
      bodyOf<
        Record<
          string,
          { aliases?: Record<string, { is_write_index?: boolean }> }
        >
      >(aliasResponse);
    const aliasTarget = alias[expectedPhysical]?.aliases?.[ALIAS];
    const physicalCount = bodyOf<{ count?: number }>(
      await client.count({ index: expectedPhysical }),
    ).count;
    const v3Indices = indices.filter((name) =>
      name.startsWith('galilei-search-v003-'),
    );
    const dataSetting = node?.settings?.['path.data'];
    const actualDataPath = Array.isArray(dataSetting)
      ? String(dataSetting[0] ?? '')
      : String(dataSetting ?? '');
    const heapMax = Number(node?.jvm?.mem?.heap_max_in_bytes ?? 0);
    if (
      info.version?.number !== '2.19.6' ||
      info.version?.build_hash !== EXPECTED_BUILD ||
      health.status !== 'green' ||
      Number(health.number_of_nodes ?? 0) !== 1 ||
      Number(health.unassigned_shards ?? -1) !== 0 ||
      cluster.cluster_uuid !== marker.clusterUuid ||
      marker.clusterName !== process.env.BJC_SEARCH_FRESH_CLUSTER_NAME ||
      icu?.version !== '2.19.6' ||
      heapMax !== 2_147_483_648 ||
      path.resolve(actualDataPath) !== path.resolve(marker.dataPath) ||
      aliases.length !== 1 ||
      aliases[0] !== expectedPhysical ||
      aliasTarget?.is_write_index !== true ||
      v3Indices.length !== 0 ||
      physicalCount !== EXPECTED_DOCUMENTS ||
      outbox.pending !== 0 ||
      outbox.failed !== 0
    ) {
      throw new Error('SEARCH_FRESH_LIFECYCLE_PREFLIGHT_REJECTED');
    }
    outboxBefore = outbox;

    const inserted = await pg.query<{ id: number }>(
      `INSERT INTO "Sentencia" (
         "numeroSentencia", "tipoFallo", "sala", "fecha", "expediente",
         "tribunalOrigen", "estadoCarga", "publicado", "activo", "caratula",
         "textoBusquedaNormalizado", "updatedAt"
       ) VALUES ($1, 'SENTENCIA', 'Sala sintética', DATE '2026-01-01', $2,
                 'Tribunal sintético', 'PUBLICADA', TRUE, TRUE, $3, $4, now())
       RETURNING "id"`,
      [fixtureA, fixtureA, `Fixture ${fixtureA}`, `prueba ${fixtureA}`],
    );
    sentenciaId = inserted.rows[0].id;
    await syncAndWait(worker, repository);
    await client.indices.refresh({ index: expectedPhysical });
    let source = await readV4Document(client, expectedPhysical, sentenciaId);
    checks.create =
      source.indexSchemaVersion === 4 &&
      source.sortFields?.numeroSentencia === fixtureA &&
      source.sortFields?.numeroSentenciaCollation === fixtureA;
    if (!checks.create) throw new Error('SEARCH_FRESH_LIFECYCLE_CREATE_FAILED');

    await pg.query(
      `UPDATE "Sentencia" SET "numeroSentencia" = $1, "caratula" = $2,
         "updatedAt" = now() WHERE "id" = $3`,
      [fixtureB, `Fixture ${fixtureB}`, sentenciaId],
    );
    await syncAndWait(worker, repository);
    await client.indices.refresh({ index: expectedPhysical });
    source = await readV4Document(client, expectedPhysical, sentenciaId);
    checks.update =
      source.title === `Fixture ${fixtureB}` &&
      source.sortFields?.numeroSentencia === fixtureB &&
      source.sortFields?.numeroSentenciaCollation === fixtureB;
    if (!checks.update) throw new Error('SEARCH_FRESH_LIFECYCLE_UPDATE_FAILED');

    await pg.query(
      `UPDATE "Sentencia" SET "numeroSentencia" = NULL, "updatedAt" = now()
        WHERE "id" = $1`,
      [sentenciaId],
    );
    await syncAndWait(worker, repository);
    await client.indices.refresh({ index: expectedPhysical });
    source = await readV4Document(client, expectedPhysical, sentenciaId);
    checks.nullTransition =
      source.sortFields?.numeroSentencia === null &&
      source.sortFields?.numeroSentenciaCollation === '';
    if (!checks.nullTransition)
      throw new Error('SEARCH_FRESH_LIFECYCLE_NULL_FAILED');

    await pg.query(`DELETE FROM "Sentencia" WHERE "id" = $1`, [sentenciaId]);
    await syncAndWait(worker, repository);
    await client.indices.refresh({ index: expectedPhysical });
    checks.delete = !(await client
      .exists({ index: expectedPhysical, id: source.id })
      .then(bodyOf<boolean>));
    if (!checks.delete) throw new Error('SEARCH_FRESH_LIFECYCLE_DELETE_FAILED');
  } catch (error) {
    failure = error;
  } finally {
    if (sentenciaId !== null) {
      try {
        if (pgConnected) {
          await pg.query(`DELETE FROM "Sentencia" WHERE "id" = $1`, [
            sentenciaId,
          ]);
        }
        await syncAndWait(worker, repository);
        await client.indices.refresh({ index: expectedPhysical });
        const exists = await client.exists({
          index: expectedPhysical,
          id: `JURISPRUDENCIA:SENTENCIA:${sentenciaId}`,
        });
        checks.fixtureRemoved = !bodyOf<boolean>(exists);
      } catch (error) {
        cleanupFailure = error;
      }
    }
    await worker.stop().catch((error: unknown) => {
      cleanupFailure ??= error;
    });
    if (pgConnected) await pg.end().catch(() => undefined);
  }

  const outboxAfter = await repository.outboxStatus().catch(() => ({
    total: -1,
    processed: -1,
    pending: -1,
    failed: -1,
    highWatermark: '-1',
  }));
  const finalCount = bodyOf<{ count?: number }>(
    await client
      .count({ index: expectedPhysical })
      .catch(() => ({ count: -1 })),
  ).count;
  const finalAlias = await client.indices
    .getAlias({ name: ALIAS })
    .catch(() => ({}));
  const finalAliasTargets = Object.keys(
    bodyOf<Record<string, unknown>>(finalAlias),
  );
  const final = {
    database: 'buscador_juridico_civil_dev@127.0.0.1:55432',
    topology: config.topology,
    endpoint: config.node,
    physicalIndex: expectedPhysical,
    alias: `${ALIAS} -> ${finalAliasTargets.join(',')}`,
    v3Indices: 0,
    initialDocuments: EXPECTED_DOCUMENTS,
    finalDocuments: finalCount ?? -1,
    fixtureId: sentenciaId,
    checks,
    outboxBefore,
    outboxAfter,
    failureCode: safeErrorCode(failure),
    cleanupFailureCode: safeErrorCode(cleanupFailure),
    pass:
      !failure &&
      !cleanupFailure &&
      Object.values(checks).every(Boolean) &&
      finalCount === EXPECTED_DOCUMENTS &&
      finalAliasTargets.length === 1 &&
      finalAliasTargets[0] === expectedPhysical &&
      outboxAfter.pending === 0 &&
      outboxAfter.failed === 0,
  };
  if (artifactRoot) {
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(
      path.join(artifactRoot, 'write-lifecycle.json'),
      `${JSON.stringify(final, null, 2)}\n`,
      'utf8',
    );
  }
  console.log(JSON.stringify(final));
  await repository.close().catch(() => undefined);
  await client.close().catch(() => undefined);
  if (!final.pass) throw new Error('SEARCH_FRESH_LIFECYCLE_FAILED');
}

async function syncAndWait(
  worker: OpenSearchSyncWorker,
  repository: OpenSearchDocumentRepository,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await worker.tick();
    const status = await repository.outboxStatus();
    if (status.failed !== 0)
      throw new Error('SEARCH_FRESH_LIFECYCLE_OUTBOX_FAILED');
    if (status.pending === 0) return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('SEARCH_FRESH_LIFECYCLE_OUTBOX_TIMEOUT');
}

async function readV4Document(client: Client, target: string, id: number) {
  const response = await client.get({
    index: target,
    id: `JURISPRUDENCIA:SENTENCIA:${id}`,
  });
  return bodyOf<{ _source: SearchDocument }>(response)._source;
}

function safeErrorCode(error: unknown) {
  if (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message))
    return error.message;
  if (error && typeof error === 'object' && 'code' in error)
    return String((error as { code: unknown }).code);
  return error ? 'UNCLASSIFIED_ERROR' : null;
}

void main().catch((error: unknown) => {
  console.error(safeErrorCode(error) ?? 'SEARCH_FRESH_LIFECYCLE_FAILED');
  process.exitCode = 1;
});

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from '@opensearch-project/opensearch';
import { Client as PgClient } from 'pg';
import { getRuntimeDatabasePoolConfig } from '../../src/config/runtime-database-config';
import { OpenSearchDocumentRepository } from '../../src/busqueda/opensearch/opensearch-document.repository';
import { OpenSearchIndexService } from '../../src/busqueda/opensearch/opensearch-index.service';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import { OpenSearchSyncWorker } from '../../src/busqueda/opensearch/opensearch-sync.worker';

const V3 = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const V4 = 'galilei-search-v004-20261020t094732495z-6015e394';
const ALIAS = 'galilei-search-active';
const EXPECTED_BUILD = '97d3c13bf22a4a72ac11dc503fe44c97662b9161';
const EXPECTED_DOCUMENTS = 69_313;

type SourceDocument = {
  id: string;
  indexSchemaVersion: number;
  title: string;
  sortFields?: {
    numeroSentencia?: string | null;
    numeroSentenciaCollation?: string;
  };
};

function loadLocalEnvironment() {
  const lines = readFileSync('.env.development.local', 'utf8').split(/\r?\n/u);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const value = match[2];
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    process.env[match[1]] = quoted ? value.slice(1, -1) : value;
  }
}

function bodyOf<T>(response: unknown): T {
  return response && typeof response === 'object' && 'body' in response
    ? (response as { body: T }).body
    : (response as T);
}

async function main() {
  loadLocalEnvironment();
  const databaseConfig = getRuntimeDatabasePoolConfig();
  const pg = new PgClient({
    ...databaseConfig,
    connectionTimeoutMillis: 5000,
    application_name: 'bjc-v4-lifecycle-fixture',
  });
  const env = {
    ...process.env,
    OPENSEARCH_SEARCH_SCHEMA_VERSION: '4',
    OPENSEARCH_SEARCH_TARGET: V4,
    OPENSEARCH_READ_ONLY_CANDIDATE: 'false',
    OPENSEARCH_TRUSTED_PHYSICAL_WRITE: 'true',
  };
  const config = readOpenSearchConfig(env);
  const client = new Client(config.clientOptions);
  const repository = new OpenSearchDocumentRepository(databaseConfig);
  const index = new OpenSearchIndexService(
    client,
    repository,
    ALIAS,
    'galilei-search',
    4,
    false,
    V4,
    true,
  );
  const rollbackIndex = new OpenSearchIndexService(
    client,
    repository,
    ALIAS,
    'galilei-search',
    3,
    false,
    V3,
    true,
  );
  const worker = new OpenSearchSyncWorker(repository, index, 1000, 25);
  const fixtureA = `CUTOVER-FIX1-A-${randomUUID().slice(0, 8)}`;
  const fixtureB = `CUTOVER-FIX1-B-${randomUUID().slice(0, 8)}`;
  let sentenciaId: number | null = null;
  let pgConnected = false;
  let testError: unknown;
  let cleanupError: unknown;
  let outboxBefore: Awaited<ReturnType<typeof repository.outboxStatus>> | null =
    null;
  let replayCheckpoint: Awaited<
    ReturnType<OpenSearchIndexService['replayShadowChanges']>
  > | null = null;
  let rollbackCheckpoint: Awaited<
    ReturnType<OpenSearchIndexService['replayPhysicalChanges']>
  > | null = null;
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
    if (
      db.database !== 'buscador_juridico_civil_dev' ||
      db.role !== 'bjc_dev' ||
      db.address !== '127.0.0.1' ||
      Number(db.port) !== 55432 ||
      Number(db.version.split('.')[0]) !== 16
    ) {
      throw new Error('PRINCIPAL_DEV_DATABASE_IDENTITY_REJECTED');
    }
    await pg.query('COMMIT');

    const [
      rootResult,
      healthResult,
      aliasResult,
      v3CountResult,
      v4CountResult,
    ] = await Promise.all([
      client.info(),
      client.cluster.health(),
      client.indices.getAlias({ name: ALIAS }),
      client.count({ index: V3, body: { query: { match_all: {} } } }),
      client.count({ index: V4, body: { query: { match_all: {} } } }),
    ]);
    const root = bodyOf<{ version: { number: string; build_hash: string } }>(
      rootResult,
    );
    const health = bodyOf<{ status?: string }>(healthResult);
    const aliases = Object.keys(bodyOf<Record<string, unknown>>(aliasResult));
    const v3Count = bodyOf<{ count: number }>(v3CountResult).count;
    const v4Count = bodyOf<{ count: number }>(v4CountResult).count;
    if (
      config.node !== 'http://127.0.0.1:9200' ||
      root.version.number !== '2.19.6' ||
      root.version.build_hash !== EXPECTED_BUILD ||
      health.status !== 'green' ||
      aliases.length !== 1 ||
      aliases[0] !== V3 ||
      v3Count !== EXPECTED_DOCUMENTS ||
      v4Count !== EXPECTED_DOCUMENTS
    ) {
      throw new Error('SEARCH_V3_V4_BASELINE_GUARD_REJECTED');
    }
    outboxBefore = await repository.outboxStatus();
    if (outboxBefore.pending !== 0 || outboxBefore.failed !== 0) {
      throw new Error('SEARCH_V4_FIXTURE_REQUIRES_CLEAN_OUTBOX');
    }

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
    await worker.tick();
    await client.indices.refresh({ index: V4 });
    let source = await readV4Document(client, sentenciaId);
    checks.createV4 =
      source.indexSchemaVersion === 4 &&
      source.sortFields?.numeroSentencia === fixtureA &&
      source.sortFields?.numeroSentenciaCollation === fixtureA;
    if (!checks.createV4) throw new Error('SEARCH_V4_FIXTURE_CREATE_FAILED');

    await pg.query(
      `UPDATE "Sentencia" SET "numeroSentencia" = $1, "caratula" = $2,
         "updatedAt" = now() WHERE "id" = $3`,
      [fixtureB, `Fixture ${fixtureB}`, sentenciaId],
    );
    await worker.tick();
    await client.indices.refresh({ index: V4 });
    source = await readV4Document(client, sentenciaId);
    checks.updateMetadata = source.title === `Fixture ${fixtureB}`;
    checks.numeroAtoB =
      source.sortFields?.numeroSentencia === fixtureB &&
      source.sortFields?.numeroSentenciaCollation === fixtureB;
    if (!checks.updateMetadata || !checks.numeroAtoB) {
      throw new Error('SEARCH_V4_FIXTURE_UPDATE_FAILED');
    }
    replayCheckpoint = await index.replayShadowChanges(
      V4,
      outboxBefore.highWatermark,
      { requireOutboxClear: true },
    );
    source = await readV4Document(client, sentenciaId);
    checks.highWaterReplay =
      replayCheckpoint.highWatermark > replayCheckpoint.afterWatermark &&
      replayCheckpoint.pendingThrough === 0 &&
      replayCheckpoint.failedThrough === 0;
    checks.replayUsesLatestSourceState =
      source.sortFields?.numeroSentencia === fixtureB &&
      source.sortFields?.numeroSentenciaCollation === fixtureB;
    if (!checks.highWaterReplay || !checks.replayUsesLatestSourceState) {
      throw new Error('SEARCH_V4_FIXTURE_REPLAY_FAILED');
    }
    rollbackCheckpoint = await rollbackIndex.replayPhysicalChanges(
      V3,
      outboxBefore.highWatermark,
      { requireOutboxClear: true },
    );
    const rollbackDocument = bodyOf<{ _source: SourceDocument }>(
      await client.get({ index: V3, id: source.id }),
    )._source;
    checks.schema3RollbackReplay =
      rollbackCheckpoint.changedKeys > 0 &&
      rollbackDocument.indexSchemaVersion === 3 &&
      rollbackDocument.sortFields?.numeroSentencia === fixtureB &&
      rollbackDocument.sortFields?.numeroSentenciaCollation === undefined;
    if (!checks.schema3RollbackReplay) {
      throw new Error('SEARCH_V3_ROLLBACK_REPLAY_FAILED');
    }

    await pg.query(
      `UPDATE "Sentencia" SET "numeroSentencia" = NULL, "updatedAt" = now()
        WHERE "id" = $1`,
      [sentenciaId],
    );
    await worker.tick();
    await client.indices.refresh({ index: V4 });
    source = await readV4Document(client, sentenciaId);
    checks.numeroBtoNull =
      source.sortFields?.numeroSentencia === null &&
      source.sortFields?.numeroSentenciaCollation === '';
    if (!checks.numeroBtoNull) throw new Error('SEARCH_V4_FIXTURE_NULL_FAILED');

    await pg.query(`DELETE FROM "Sentencia" WHERE "id" = $1`, [sentenciaId]);
    await worker.tick();
    await client.indices.refresh({ index: V4 });
    checks.deleteV4 = !(await client
      .exists({ index: V4, id: source.id })
      .then(bodyOf<boolean>));
    if (!checks.deleteV4) throw new Error('SEARCH_V4_FIXTURE_DELETE_FAILED');
    replayCheckpoint = await index.replayShadowChanges(
      V4,
      outboxBefore.highWatermark,
      { requireOutboxClear: true },
    );
    checks.deleteReplay = replayCheckpoint.changedKeys > 0;
    rollbackCheckpoint = await rollbackIndex.replayPhysicalChanges(
      V3,
      outboxBefore.highWatermark,
      { requireOutboxClear: true },
    );
    checks.rollbackDeleteReplay = rollbackCheckpoint.changedKeys > 0;
  } catch (error) {
    testError = error;
  } finally {
    if (sentenciaId !== null) {
      try {
        if (pgConnected) {
          await pg.query('DELETE FROM "Sentencia" WHERE "id" = $1', [
            sentenciaId,
          ]);
        }
        await worker.tick();
        await client.indices.refresh({ index: V4 });
        if (outboxBefore) {
          await rollbackIndex.replayPhysicalChanges(
            V3,
            outboxBefore.highWatermark,
            { requireOutboxClear: true },
          );
        }
        const v4Exists = await client.exists({
          index: V4,
          id: `JURISPRUDENCIA:SENTENCIA:${sentenciaId}`,
        });
        const v3Exists = await client.exists({
          index: V3,
          id: `JURISPRUDENCIA:SENTENCIA:${sentenciaId}`,
        });
        checks.fixtureRemovedFromV4 = !bodyOf<boolean>(v4Exists);
        const [v3CountResponse, v4CountResponse, aliasResult] =
          await Promise.all([
            client.count({ index: V3 }),
            client.count({ index: V4 }),
            client.indices.getAlias({ name: ALIAS }),
          ]);
        checks.v3Cleaned =
          !bodyOf<boolean>(v3Exists) &&
          bodyOf<{ count: number }>(v3CountResponse).count ===
            EXPECTED_DOCUMENTS;
        checks.v4Cleaned =
          !bodyOf<boolean>(v4Exists) &&
          bodyOf<{ count: number }>(v4CountResponse).count ===
            EXPECTED_DOCUMENTS;
        const finalAliasTargets = Object.keys(
          bodyOf<Record<string, unknown>>(aliasResult),
        );
        checks.aliasStayedOnV3 =
          finalAliasTargets.length === 1 && finalAliasTargets[0] === V3;
      } catch (error) {
        cleanupError = error;
      }
    }
    await worker.stop().catch((error: unknown) => {
      cleanupError ??= error;
    });
    if (pgConnected) {
      await pg.end().catch(() => undefined);
      pgConnected = false;
    }
  }

  try {
    await repository.close();
  } catch (error) {
    cleanupError ??= error;
  }
  await client.close().catch(() => undefined);

  const outboxAfter = await readFinalOutboxStatus();
  const result = {
    database: 'buscador_juridico_civil_dev@127.0.0.1:55432',
    fixtureType: 'SYNTHETIC_PUBLISHED_SENTENCIA',
    v3: V3,
    v4: V4,
    alias: `${ALIAS} -> ${V3}`,
    checks,
    replayCheckpoint,
    outboxBefore,
    outboxAfter,
    outboxDelta: outboxBefore ? outboxAfter.total - outboxBefore.total : null,
    failureType:
      testError && typeof testError === 'object' && 'name' in testError
        ? String(testError.name)
        : null,
    failureCode:
      testError && typeof testError === 'object' && 'code' in testError
        ? String(testError.code)
        : testError instanceof Error && /^[A-Z0-9_]+$/u.test(testError.message)
          ? testError.message
          : null,
    rollbackCheckpoint,
    fixtureSourceResidue: checks.fixtureRemovedFromV4 === true ? 0 : 1,
    v3FixtureResidue: checks.v3Cleaned === true ? 0 : 1,
    pass:
      !testError &&
      !cleanupError &&
      Object.values(checks).every(Boolean) &&
      outboxAfter.pending === 0 &&
      outboxAfter.failed === 0,
  };
  console.log(JSON.stringify(result));
  if (cleanupError) throw new Error('SEARCH_V4_FIXTURE_CLEANUP_FAILED');
  if (testError) throw new Error('SEARCH_V4_FIXTURE_LIFECYCLE_FAILED');
  if (!result.pass) throw new Error('SEARCH_V4_FIXTURE_FINAL_GUARD_FAILED');
}

async function readV4Document(client: Client, id: number) {
  const response = await client.get({
    index: V4,
    id: `JURISPRUDENCIA:SENTENCIA:${id}`,
  });
  return bodyOf<{ _source: SourceDocument }>(response)._source;
}

async function readFinalOutboxStatus() {
  const repository = new OpenSearchDocumentRepository(
    getRuntimeDatabasePoolConfig(),
  );
  try {
    return await repository.outboxStatus();
  } finally {
    await repository.close();
  }
}

void main().catch((error: unknown) => {
  const code =
    error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : 'SEARCH_V4_FIXTURE_LIFECYCLE_FAILED';
  console.error(code);
  process.exitCode = 1;
});

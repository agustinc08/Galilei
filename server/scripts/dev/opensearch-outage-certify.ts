import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OpenSearchRuntimeService } from '../../src/busqueda/opensearch/opensearch-runtime.service';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import { CorpusSearchSourceAdapter } from '../../src/corpus/corpus-search.adapter';
import type {
  SearchContext,
  SearchSourceAdapter,
} from '../../src/busqueda/adapters/search-source.adapter';

type FixtureArtifact = { id: string; querySha256: string; createdAt: string };

const phase = process.argv[2];
const artifactRoot = resolve(
  process.cwd(),
  '..',
  '..',
  '_recovery-work',
  'search-engine-integration1',
);
const fixturePath = resolve(artifactRoot, 'outage-fixture.json');
const recoveryPath = resolve(artifactRoot, 'outage-recovery.json');
loadLocalEnvironment();

async function main() {
  if (phase !== 'prepare' && phase !== 'recover')
    throw new Error('OPENSEARCH_OUTAGE_PHASE_INVALID');
  const prisma = new PrismaService();
  await prisma.$connect();
  let runtime: OpenSearchRuntimeService | undefined;
  let hydrator: CorpusSearchSourceAdapter | undefined;
  let fixture: FixtureArtifact | undefined;
  let deleted = false;
  try {
    const identity = await prisma.$queryRaw<
      Array<{ database: string; role: string; port: number }>
    >`
      SELECT current_database() AS database, current_user AS role, inet_server_port() AS port`;
    const target = identity[0];
    if (
      target?.database !== 'buscador_juridico_civil_dev' ||
      target.role !== 'bjc_dev' ||
      Number(target.port) !== 55432
    ) {
      throw new Error('DEV_DB_GUARD_TARGET_MISMATCH');
    }

    if (phase === 'prepare') {
      if (await endpointReachable())
        throw new Error('OPENSEARCH_OUTAGE_NOT_ACTIVE');
      const id = `opensearch_int1_outage_${Date.now()}_${process.pid}`;
      const query = termFor(id);
      await prisma.corpusDocument.create({
        data: {
          id,
          title: 'Synthetic OpenSearch outage recovery fixture',
          documentType: 'OPENSEARCH-INT1-OUTAGE',
          jurisdiction: 'CIVIL',
          visibility: 'INTERNAL',
          documentScope: 'GENERAL',
          status: 'INDEXED',
          searchText: `${query} durable retry fixture`,
        },
      });
      fixture = {
        id,
        querySha256: sha256(query),
        createdAt: new Date().toISOString(),
      };
      mkdirSync(artifactRoot, { recursive: true });
      writeFileSync(
        fixturePath,
        `${JSON.stringify(fixture, null, 2)}\n`,
        'utf8',
      );

      const committed = await prisma.corpusDocument.findUnique({
        where: { id },
        select: { id: true },
      });
      const outbox = await outboxStatus(prisma);
      if (committed?.id !== id || outbox.pending < 1 || outbox.failed !== 0) {
        throw new Error('OPENSEARCH_OUTAGE_DURABLE_COMMIT_FAILED');
      }
      console.log(
        JSON.stringify(
          {
            phase,
            postgresCommit: 'PASS',
            durablePending: 'PASS',
            pendingAtOutage: outbox.pending,
            failedAtOutage: outbox.failed,
            fixtureId: id,
            querySha256: fixture.querySha256,
          },
          null,
          2,
        ),
      );
      return;
    }

    fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureArtifact;
    if (!/^opensearch_int1_outage_[0-9]+_[0-9]+$/u.test(fixture.id))
      throw new Error('OPENSEARCH_OUTAGE_FIXTURE_ID_INVALID');
    const query = termFor(fixture.id);
    if (sha256(query) !== fixture.querySha256)
      throw new Error('OPENSEARCH_OUTAGE_FIXTURE_HASH_MISMATCH');
    if (!(await endpointReachable()))
      throw new Error('OPENSEARCH_RECOVERY_ENDPOINT_UNAVAILABLE');

    runtime = new OpenSearchRuntimeService();
    runtime.onModuleInit();
    hydrator = new CorpusSearchSourceAdapter();
    const productSearch = runtime.createSource('CORPUS', (ast, context, ids) =>
      hydrator!.search(ast, context, ids),
    );
    const firstDrain = await waitForOutbox(runtime);
    const context: SearchContext = {
      visibility: 'INTERNAL',
      dialect: 'modern',
      publicationPolicy: 'legacy-active-only',
      page: 1,
      pageSize: 20,
      sourceSystems: ['CORPUS'],
      filters: { tipoFallo: 'OPENSEARCH-INT1-OUTAGE' },
    };
    const indexed = await waitForSearch(
      productSearch,
      query,
      context,
      (result) =>
        result.total === 1 &&
        result.totalExact === true &&
        result.results.length === 1 &&
        result.results[0].sourceId === fixture!.id,
    );
    const recoveryPass =
      indexed.total === 1 &&
      indexed.totalExact === true &&
      indexed.results.length === 1 &&
      indexed.results[0].sourceId === fixture.id;
    if (!recoveryPass)
      throw new Error('OPENSEARCH_OUTAGE_RETRY_MISSING_DOCUMENT');

    await prisma.corpusDocument.delete({ where: { id: fixture.id } });
    deleted = true;
    const deleteDrain = await waitForOutbox(runtime);
    const afterDelete = await waitForSearch(
      productSearch,
      query,
      context,
      (result) => result.total === 0 && result.totalExact === true,
    );
    const finalOutbox = await outboxStatus(prisma);
    const cleanupPass =
      afterDelete.total === 0 &&
      afterDelete.totalExact === true &&
      finalOutbox.pending === 0 &&
      finalOutbox.failed === 0;
    if (!cleanupPass)
      throw new Error('OPENSEARCH_OUTAGE_FIXTURE_CLEANUP_FAILED');

    const output = {
      generatedAt: new Date().toISOString(),
      target: {
        database: target.database,
        role: target.role,
        address: '127.0.0.1 (DEV URL guard verified)',
        port: Number(target.port),
      },
      querySha256: fixture.querySha256,
      postgresCommitWhileUnavailable: 'PASS',
      durableOutboxObservedWhileUnavailable: 'PASS',
      pendingAtOutage: firstDrain.beforePending,
      lostUpdates: 0,
      retryAfterRecovery: recoveryPass ? 'PASS' : 'FAIL',
      recoveredExactTotal: indexed.total,
      recoveredDocumentIdMatches: recoveryPass,
      deletePropagation: afterDelete.total === 0 ? 'PASS' : 'FAIL',
      backlogFinal: finalOutbox.pending,
      failedFinal: finalOutbox.failed,
      pass:
        cleanupPass &&
        recoveryPass &&
        firstDrain.failed === 0 &&
        deleteDrain.failed === 0,
    };
    writeFileSync(recoveryPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(output, null, 2));
    if (!output.pass) process.exitCode = 1;
  } finally {
    if (fixture && phase === 'recover' && !deleted) {
      await prisma.corpusDocument
        .delete({ where: { id: fixture.id } })
        .catch(() => undefined);
      if (runtime) await waitForOutbox(runtime).catch(() => undefined);
    }
    if (hydrator) await hydrator.close().catch(() => undefined);
    if (runtime) await runtime.onModuleDestroy().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function waitForOutbox(runtime: OpenSearchRuntimeService) {
  const before = await runtime.repository.outboxStatus();
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await runtime.syncWorker.tick();
    const status = await runtime.repository.outboxStatus();
    if (status.failed > 0) throw new Error('OPENSEARCH_OUTAGE_SYNC_FAILED');
    if (status.pending === 0)
      return { ...status, beforePending: before.pending };
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('OPENSEARCH_OUTAGE_SYNC_TIMEOUT');
}

async function waitForSearch(
  source: SearchSourceAdapter,
  query: string,
  context: SearchContext,
  isReady: (
    result: Awaited<ReturnType<CorpusSearchSourceAdapter['search']>>,
  ) => boolean,
) {
  let result = await source.search(parseSearchQuery(query), context);
  for (let attempt = 0; attempt < 150 && !isReady(result); attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    result = await source.search(parseSearchQuery(query), context);
  }
  return result;
}

async function outboxStatus(prisma: PrismaService) {
  const rows = await prisma.$queryRaw<
    Array<{ pending: bigint; failed: bigint }>
  >`
    SELECT count(*) FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NULL) AS pending,
           count(*) FILTER (WHERE "failedAt" IS NOT NULL) AS failed
      FROM "SearchIndexOutbox"`;
  return {
    pending: Number(rows[0]?.pending ?? 0n),
    failed: Number(rows[0]?.failed ?? 0n),
  };
}

function termFor(id: string) {
  return `zzoutage${id.replace(/[^a-z0-9]/giu, '').toLowerCase()}`;
}
function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function endpointReachable() {
  try {
    const response = await fetch(
      process.env.OPENSEARCH_NODE ?? 'http://127.0.0.1:9200',
      { signal: AbortSignal.timeout(1000) },
    );
    return response.ok;
  } catch {
    return false;
  }
}

function loadLocalEnvironment() {
  const file = resolve(process.cwd(), '.env.development.local');
  const contents = readFileSync(file, 'utf8');
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const rawValue = match[2];
    const quoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"));
    process.env[match[1]] = quoted ? rawValue.slice(1, -1) : rawValue;
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'OPENSEARCH_OUTAGE_CERTIFY_FAILED';
  console.error(
    /^(?:OPENSEARCH_|DEV_)/u.test(message)
      ? message
      : 'OPENSEARCH_OUTAGE_CERTIFY_FAILED',
  );
  process.exitCode = 1;
});

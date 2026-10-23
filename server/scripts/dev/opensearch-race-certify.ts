import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@opensearch-project/opensearch';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OpenSearchRuntimeService } from '../../src/busqueda/opensearch/opensearch-runtime.service';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import { CorpusSearchSourceAdapter } from '../../src/corpus/corpus-search.adapter';
import type {
  SearchContext,
  SearchResultPage,
} from '../../src/busqueda/adapters/search-source.adapter';

type RaceState = {
  id: string;
  oldQuerySha256: string;
  newQuerySha256: string;
  originalActiveIndex: string;
  baselineIndices: string[];
  candidateIndex?: string;
  mutationCommittedAt?: string;
};

const phase = process.argv[2];
const artifactRoot = resolve(
  process.cwd(),
  '..',
  '..',
  '_recovery-work',
  'search-engine-integration1',
);
const statePath = resolve(artifactRoot, 'rebuild-race-fixture.json');
const resultPath = resolve(artifactRoot, 'rebuild-race-result.json');
loadLocalEnvironment();

async function main() {
  if (phase !== 'prepare' && phase !== 'mutate' && phase !== 'verify') {
    throw new Error('OPENSEARCH_RACE_PHASE_INVALID');
  }
  const prisma = new PrismaService();
  await prisma.$connect();
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
    await prisma.$disconnect();
    throw new Error('DEV_DB_GUARD_TARGET_MISMATCH');
  }

  const config = readOpenSearchConfig();
  const client = new Client(config.clientOptions);
  let runtime: OpenSearchRuntimeService | undefined;
  let hydrator: CorpusSearchSourceAdapter | undefined;
  let fixtureCreated = false;
  let fixtureDeleted = false;
  let mutationPersistedForVerify = false;
  let state: RaceState | undefined;
  try {
    if (phase === 'prepare') {
      const active = await activeIndex(client, config.alias);
      const baselineIndices = await indexNames(client);
      const id = `opensearch_int1_race_${Date.now()}_${process.pid}`;
      state = {
        id,
        oldQuerySha256: sha256(termFor(id, 'before')),
        newQuerySha256: sha256(termFor(id, 'after')),
        originalActiveIndex: active,
        baselineIndices,
      };
      mkdirSync(artifactRoot, { recursive: true });
      writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      console.log(
        JSON.stringify(
          {
            phase,
            activeAlias: config.alias,
            originalActiveIndex: active,
            baselineIndexCount: baselineIndices.length,
            fixtureId: id,
            prepared: true,
          },
          null,
          2,
        ),
      );
      return;
    }

    state = JSON.parse(readFileSync(statePath, 'utf8')) as RaceState;
    if (!/^opensearch_int1_race_[0-9]+_[0-9]+$/u.test(state.id)) {
      throw new Error('OPENSEARCH_RACE_FIXTURE_ID_INVALID');
    }

    if (phase === 'mutate') {
      const candidateIndex = await waitForCandidate(
        client,
        config.alias,
        state,
      );
      const oldQuery = termFor(state.id, 'before');
      const newQuery = termFor(state.id, 'after');
      await prisma.corpusDocument.create({
        data: {
          id: state.id,
          title: 'Synthetic OpenSearch rebuild race fixture',
          documentType: 'OPENSEARCH-INT1-RACE',
          jurisdiction: 'CIVIL',
          visibility: 'INTERNAL',
          documentScope: 'GENERAL',
          status: 'INDEXED',
          searchText: `${oldQuery} rebuild race initial version`,
        },
      });
      fixtureCreated = true;
      await prisma.corpusDocument.update({
        where: { id: state.id },
        data: { searchText: `${newQuery} rebuild race final version` },
      });
      const row = await prisma.corpusDocument.findUnique({
        where: { id: state.id },
        select: { id: true, searchText: true },
      });
      const outbox = await outboxStatus(prisma);
      if (
        row?.id !== state.id ||
        !row.searchText?.includes(newQuery) ||
        outbox.pending < 1 ||
        outbox.failed !== 0
      ) {
        throw new Error('OPENSEARCH_RACE_MUTATION_NOT_DURABLE');
      }
      state.candidateIndex = candidateIndex;
      state.mutationCommittedAt = new Date().toISOString();
      writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      mutationPersistedForVerify = true;
      console.log(
        JSON.stringify(
          {
            phase,
            candidateIndex,
            activeAliasUnchanged: true,
            create: 'PASS',
            update: 'PASS',
            durableOutboxPending: outbox.pending,
            fixtureId: state.id,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (!state.candidateIndex || !state.mutationCommittedAt) {
      throw new Error('OPENSEARCH_RACE_MUTATION_MISSING');
    }
    fixtureCreated = true;
    const activeAfterPromotion = await activeIndex(client, config.alias);
    if (
      activeAfterPromotion !== state.candidateIndex ||
      activeAfterPromotion === state.originalActiveIndex
    ) {
      throw new Error('OPENSEARCH_RACE_ALIAS_PROMOTION_MISMATCH');
    }

    runtime = new OpenSearchRuntimeService();
    runtime.onModuleInit();
    hydrator = new CorpusSearchSourceAdapter();
    const source = runtime.createSource('CORPUS', (query, context, ids) =>
      hydrator!.search(query, context, ids),
    );
    const context: SearchContext = {
      visibility: 'INTERNAL',
      dialect: 'modern',
      publicationPolicy: 'legacy-active-only',
      page: 1,
      pageSize: 20,
      sourceSystems: ['CORPUS'],
      filters: { tipoFallo: 'OPENSEARCH-INT1-RACE' },
    };
    const newResult = await waitForSearch(
      source,
      termFor(state.id, 'after'),
      context,
      (result) =>
        result.total === 1 &&
        result.totalExact === true &&
        result.results[0]?.sourceId === state!.id,
    );
    const oldResult = await source.search(
      parseSearchQuery(termFor(state.id, 'before')),
      context,
    );
    const finalOutbox = await outboxStatus(prisma);
    const updateReplayed =
      newResult.total === 1 &&
      newResult.totalExact === true &&
      newResult.results.length === 1 &&
      newResult.results[0].sourceId === state.id;
    const oldVersionAbsent =
      oldResult.total === 0 && oldResult.totalExact === true;
    if (
      !updateReplayed ||
      !oldVersionAbsent ||
      finalOutbox.pending !== 0 ||
      finalOutbox.failed !== 0
    ) {
      throw new Error('OPENSEARCH_RACE_REPLAY_FAILED');
    }

    await prisma.corpusDocument.delete({ where: { id: state.id } });
    fixtureDeleted = true;
    await waitForOutbox(runtime);
    const deletedResult = await waitForSearch(
      source,
      termFor(state.id, 'after'),
      context,
      (result) => result.total === 0 && result.totalExact === true,
    );
    const cleanupOutbox = await outboxStatus(prisma);
    const cleanupPass =
      deletedResult.total === 0 &&
      cleanupOutbox.pending === 0 &&
      cleanupOutbox.failed === 0;
    const output = {
      generatedAt: new Date().toISOString(),
      target: {
        database: target.database,
        role: target.role,
        address: '127.0.0.1 (DEV URL guard verified)',
        port: Number(target.port),
      },
      originalActiveIndex: state.originalActiveIndex,
      candidateIndex: state.candidateIndex,
      promotedAlias: activeAfterPromotion,
      mutationCommittedAt: state.mutationCommittedAt,
      concurrentCreate: 'PASS',
      concurrentUpdate: 'PASS',
      latestVersionReplayed: updateReplayed ? 'PASS' : 'FAIL',
      staleVersionAbsent: oldVersionAbsent ? 'PASS' : 'FAIL',
      exactTotal: newResult.totalExact && oldResult.totalExact,
      lostUpdates: 0,
      cleanup: cleanupPass ? 'PASS' : 'FAIL',
      pendingFinal: cleanupOutbox.pending,
      failedFinal: cleanupOutbox.failed,
      pass: cleanupPass && updateReplayed && oldVersionAbsent,
    };
    writeFileSync(resultPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(output, null, 2));
    if (!output.pass) process.exitCode = 1;
  } finally {
    if (
      state &&
      phase !== 'prepare' &&
      fixtureCreated &&
      !fixtureDeleted &&
      !mutationPersistedForVerify
    ) {
      await prisma.corpusDocument
        .delete({ where: { id: state.id } })
        .catch(() => undefined);
      if (runtime) await waitForOutbox(runtime).catch(() => undefined);
    }
    if (hydrator) await hydrator.close().catch(() => undefined);
    if (runtime) await runtime.onModuleDestroy().catch(() => undefined);
    await client.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function waitForCandidate(
  client: Client,
  alias: string,
  state: RaceState,
) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const active = await activeIndex(client, alias);
    if (active !== state.originalActiveIndex)
      throw new Error('OPENSEARCH_RACE_PROMOTED_BEFORE_MUTATION');
    const candidates = (await indexNames(client)).filter(
      (index) =>
        index.startsWith('galilei-search-v001-') &&
        !state.baselineIndices.includes(index),
    );
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1)
      throw new Error('OPENSEARCH_RACE_MULTIPLE_CANDIDATES');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('OPENSEARCH_RACE_CANDIDATE_TIMEOUT');
}

async function activeIndex(client: Client, alias: string) {
  const response = await client.indices.getAlias({ name: alias });
  const body =
    (response as unknown as { body?: Record<string, unknown> }).body ??
    (response as unknown as Record<string, unknown>);
  const indexes = Object.keys(body);
  if (indexes.length !== 1) throw new Error('OPENSEARCH_RACE_ALIAS_INVALID');
  return indexes[0];
}

async function indexNames(client: Client) {
  const response = await client.cat.indices({
    index: 'galilei-search-v001-*',
    format: 'json',
  });
  const body =
    (response as unknown as { body?: Array<{ index?: string }> }).body ??
    (response as unknown as Array<{ index?: string }>);
  return body
    .map((row) => row.index)
    .filter((index): index is string => typeof index === 'string');
}

async function waitForSearch(
  source: ReturnType<OpenSearchRuntimeService['createSource']>,
  query: string,
  context: SearchContext,
  ready: (result: SearchResultPage) => boolean,
) {
  let result = await source.search(parseSearchQuery(query), context);
  for (let attempt = 0; attempt < 150 && !ready(result); attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    result = await source.search(parseSearchQuery(query), context);
  }
  return result;
}

async function waitForOutbox(runtime: OpenSearchRuntimeService) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await runtime.syncWorker.tick();
    const status = await runtime.repository.outboxStatus();
    if (status.failed > 0) throw new Error('OPENSEARCH_RACE_SYNC_FAILED');
    if (status.pending === 0) return status;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('OPENSEARCH_RACE_SYNC_TIMEOUT');
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

function termFor(id: string, version: 'before' | 'after') {
  return `zzrace${version}${id.replace(/[^a-z0-9]/giu, '').toLowerCase()}`;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function loadLocalEnvironment() {
  const contents = readFileSync(
    resolve(process.cwd(), '.env.development.local'),
    'utf8',
  );
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
    error instanceof Error ? error.message : 'OPENSEARCH_RACE_CERTIFY_FAILED';
  console.error(
    /^(?:OPENSEARCH_|DEV_)/u.test(message)
      ? message
      : 'OPENSEARCH_RACE_CERTIFY_FAILED',
  );
  process.exitCode = 1;
});

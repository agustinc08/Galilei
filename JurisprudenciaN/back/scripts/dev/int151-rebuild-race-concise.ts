import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { Client } from '@opensearch-project/opensearch';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OpenSearchDocumentRepository } from '../../src/busqueda/opensearch/opensearch-document.repository';
import { OpenSearchIndexService } from '../../src/busqueda/opensearch/opensearch-index.service';
import { OpenSearchSyncWorker } from '../../src/busqueda/opensearch/opensearch-sync.worker';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';

const candidateAlias = `galilei-search-int151-race-${Date.now()}`;
const artifactRoot = resolve(
  process.cwd(),
  '../../_recovery-work/search-engine-integration1',
);
const outputPath = resolve(artifactRoot, 'rebuild-race-reuse-proof-1_5_1.json');
const marker = `zzint151race${Date.now().toString(36)}`;
const oldTerm = `${marker}before`;
const newTerm = `${marker}after`;
const documentId = `00000000-int151-race-${Date.now()}`;
const coreFiles = [
  'src/busqueda/opensearch/opensearch-index.service.ts',
  'src/busqueda/opensearch/opensearch-document.repository.ts',
  'src/busqueda/opensearch/opensearch-sync.worker.ts',
  'src/busqueda/opensearch/opensearch-search-document.ts',
  'src/busqueda/opensearch/opensearch-mapping.ts',
  'scripts/dev/opensearch-race-certify.ts',
];
const previousArtifacts = [
  '../../_recovery-work/search-engine-integration1/rebuild-race-fixture.json',
  '../../_recovery-work/search-engine-integration1/rebuild-race-result.json',
];

type CandidateSource = {
  id?: string;
  canonicalSearchText?: string;
};
type HitBody = {
  hits?: {
    total?: { value?: number; relation?: string };
    hits?: Array<{ _id?: string; _source?: CandidateSource }>;
  };
};
type ReadSnapshot = <T>(run: (client: PoolClient) => Promise<T>) => Promise<T>;

async function main() {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (
    databaseUrl.protocol !== 'postgresql:' ||
    databaseUrl.hostname !== '127.0.0.1' ||
    databaseUrl.port !== '55432' ||
    databaseUrl.pathname !== '/buscador_juridico_civil_dev' ||
    databaseUrl.username !== 'bjc_dev'
  )
    throw new Error('DEV_DB_GUARD_REQUIRED');
  const identityService = new PrismaService();
  await identityService.$connect();
  const identity = await identityService.$queryRaw<
    Array<{ database: string; role: string; port: number }>
  >`SELECT current_database() AS database, current_user AS role, inet_server_port() AS port`;
  if (
    identity[0]?.database !== 'buscador_juridico_civil_dev' ||
    identity[0]?.role !== 'bjc_dev' ||
    Number(identity[0]?.port) !== 55432
  )
    throw new Error('DEV_DB_GUARD_TARGET_MISMATCH');
  await identityService.$disconnect();

  const config = readOpenSearchConfig();
  if (config.node !== 'http://127.0.0.1:9200')
    throw new Error('LOCAL_OPENSEARCH_ENDPOINT_REQUIRED');
  const client = new Client(config.clientOptions);
  const prisma = new PrismaService();
  const repository = new OpenSearchDocumentRepository();
  const indexer = new OpenSearchIndexService(
    client,
    repository,
    candidateAlias,
  );
  const worker = new OpenSearchSyncWorker(repository, indexer);
  let fixtureCreated = false;
  let fixtureDeleted = false;
  let physicalIndex: string | undefined;
  let sourceSnapshotVerified = false;
  let mutationCommitted = false;
  let aliasPromoted = false;
  let mainAliasBefore: string | null = null;
  let report: Record<string, unknown> = {
    status: 'NOT_RUN',
    pass: false,
    target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
    candidateAlias,
    fixtureIdSha256: sha(documentId),
    oldTermSha256: sha(oldTerm),
    newTermSha256: sha(newTerm),
  };

  try {
    await prisma.$connect();
    const initialOutbox = await repository.outboxStatus();
    if (initialOutbox.pending !== 0 || initialOutbox.failed !== 0)
      throw new Error('RACE_INITIAL_OUTBOX_NOT_CLEAN');
    mainAliasBefore = await activePhysical(client, 'galilei-search-active');
    if (!mainAliasBefore?.startsWith('galilei-search-v001-'))
      throw new Error('RACE_ACTIVE_ALIAS_MUST_REMAIN_V1');
    const candidateAliasExists = await client.indices.existsAlias({
      name: candidateAlias,
    });
    if (candidateAliasExists.body)
      throw new Error('RACE_TEMP_ALIAS_ALREADY_EXISTS');
    const baselineIndices = new Set(await indexNames(client));

    await prisma.corpusDocument.create({
      data: {
        id: documentId,
        title: `INT151 controlled rebuild race ${marker}`,
        documentType: 'INT151_REBUILD_RACE_FIXTURE',
        jurisdiction: 'CIVIL',
        visibility: 'PUBLIC',
        documentScope: 'GENERAL',
        status: 'INDEXED',
        searchText: `${oldTerm} initial snapshot version`,
      },
    });
    fixtureCreated = true;

    let snapshotReturned = false;
    const originalReadSnapshot = repository.withReadSnapshot.bind(
      repository,
    ) as ReadSnapshot;
    repository.corpusPage = async (_client: PoolClient, afterId: string) => {
      if (snapshotReturned || afterId !== '') return [];
      snapshotReturned = true;
      const row = await repository.getCorpusDocument(documentId);
      if (!row) throw new Error('RACE_FIXTURE_NOT_SEARCH_ELIGIBLE');
      return [row];
    };
    repository.jurisprudenciaPage = () => Promise.resolve([]);
    repository.sentenciaPage = () => Promise.resolve([]);
    repository.withReadSnapshot = async <T>(
      run: (client: PoolClient) => Promise<T>,
    ): Promise<T> => {
      const value = await originalReadSnapshot<T>(run);
      if (!sourceSnapshotVerified) {
        const candidates = (await indexNames(client)).filter(
          (name) => !baselineIndices.has(name),
        );
        if (candidates.length !== 1 || !candidates[0])
          throw new Error('RACE_CANDIDATE_INDEX_NOT_UNIQUE');
        physicalIndex = candidates[0];
        const oldSource = await indexedSource(
          client,
          candidates[0],
          documentId,
        );
        sourceSnapshotVerified =
          oldSource?.canonicalSearchText?.includes(oldTerm) === true &&
          oldSource.canonicalSearchText.includes('initial snapshot version');
        if (!sourceSnapshotVerified)
          throw new Error('RACE_CANDIDATE_OLD_SNAPSHOT_NOT_OBSERVED');
        await prisma.corpusDocument.update({
          where: { id: documentId },
          data: { searchText: `${newTerm} final committed version` },
        });
        mutationCommitted = true;
      }
      return value;
    };

    indexer.verifyPhysical = async (index, expectedSchemaVersion) => {
      if (index !== physicalIndex || expectedSchemaVersion !== 3)
        throw new Error('RACE_CANDIDATE_VERIFICATION_TARGET_MISMATCH');
      const response = await client.search({
        index,
        body: {
          size: 10,
          track_total_hits: true,
          _source: ['id', 'canonicalSearchText'],
          query: { match_all: {} },
        },
      });
      const body =
        (response as unknown as { body?: HitBody }).body ??
        (response as unknown as HitBody);
      const hits = body.hits?.hits ?? [];
      const ids = hits.map((hit) => String(hit._id ?? '')).sort();
      const exactIdEquality =
        body.hits?.total?.relation === 'eq' &&
        body.hits.total.value === 1 &&
        ids.length === 1 &&
        ids[0] === documentId &&
        hits[0]?._source?.canonicalSearchText?.includes(newTerm) === true &&
        hits[0]?._source?.canonicalSearchText?.includes(oldTerm) === false;
      const result = {
        schemaVersion: 3,
        expectedIds: 1,
        indexedIds: Number(body.hits?.total?.value ?? -1),
        actualDistinctIds: new Set(ids).size,
        missing: exactIdEquality ? [] : [documentId],
        extra: exactIdEquality ? [] : ids.filter((id) => id !== documentId),
        duplicates: ids.length - new Set(ids).size,
        exactIdEquality,
        corpusEligibleIds: 1,
        corpusIndexedIds: ids.filter((id) => id === documentId).length,
        corpusMissing: exactIdEquality ? 0 : 1,
        corpusExtra: exactIdEquality
          ? 0
          : ids.filter((id) => id !== documentId).length,
        sumarioEligibleIds: 0,
        sumarioIndexedIds: 0,
        sumarioMissing: 0,
        sumarioExtra: 0,
        sentenciaEligibleIds: 0,
        sentenciaIndexedIds: 0,
        sentenciaMissing: 0,
        sentenciaExtra: 0,
        publishedSentenciasEligibleIds: 0,
        publishedSentenciasIndexedIds: 0,
        publishedSentenciasMissing: 0,
        publishedSentenciasExtra: 0,
        corpusIdSetSha256: hashIds([documentId]),
        indexedIdSetSha256: hashIds(ids),
      };
      if (!exactIdEquality) throw new Error('RACE_CANDIDATE_EXACTNESS_FAILED');
      return result;
    };

    const rebuilt = await indexer.rebuild();
    physicalIndex = rebuilt.physicalIndex;
    aliasPromoted = rebuilt.aliasPromoted;
    const activeAfter = await activePhysical(client, candidateAlias);
    const newSource = await indexedSource(client, candidateAlias, documentId);
    const oldCount = await exactQueryCount(client, candidateAlias, oldTerm);
    const newCount = await exactQueryCount(client, candidateAlias, newTerm);
    const finalOutbox = await repository.outboxStatus();
    const activeStillV1 =
      (await activePhysical(client, 'galilei-search-active')) ===
      mainAliasBefore;
    const updateReplayed =
      mutationCommitted &&
      activeAfter === physicalIndex &&
      newSource?.canonicalSearchText?.includes(newTerm) === true &&
      newSource.canonicalSearchText.includes(oldTerm) === false &&
      oldCount === 0 &&
      newCount === 1 &&
      finalOutbox.pending === 0 &&
      finalOutbox.failed === 0;
    if (!updateReplayed) throw new Error('RACE_LATEST_VERSION_REPLAY_FAILED');

    await prisma.corpusDocument.delete({ where: { id: documentId } });
    fixtureDeleted = true;
    await waitForOutbox(worker, repository);
    await client.indices.refresh({ index: candidateAlias });
    const afterDelete = await exactIdCount(client, candidateAlias, documentId);
    const cleanupOutbox = await repository.outboxStatus();
    const deletePropagated =
      afterDelete === 0 &&
      cleanupOutbox.pending === 0 &&
      cleanupOutbox.failed === 0;
    if (!deletePropagated) throw new Error('RACE_DELETE_REPLAY_FAILED');

    report = {
      generatedAt: new Date().toISOString(),
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      candidateAlias,
      physicalIndex,
      schemaVersion: 3,
      previousProof: {
        fixtureArtifactSha256: fileSha(previousArtifacts[0]),
        resultArtifactSha256: fileSha(previousArtifacts[1]),
        codeHashesRecorded: false,
        reuseBySha: false,
      },
      sourceHashes: Object.fromEntries(
        coreFiles.map((file) => [file, fileSha(resolve(process.cwd(), file))]),
      ),
      execution: 'CURRENT_IMPLEMENTATION_CONCISE_RACE_REPLAY',
      test: {
        activeAliasBefore: mainAliasBefore,
        oneSyntheticCorpusDocument: true,
        fullCorpusRebuild: false,
        deterministicMutationAfterReadSnapshot: true,
        oldVersionIndexedBeforeMutation: sourceSnapshotVerified,
        mutationCommittedDuringBuild: mutationCommitted,
        latestVersionReplayedBeforeAliasSwap: updateReplayed,
        staleVersionAbsent: oldCount === 0,
        candidateAliasPromotedAtomically:
          aliasPromoted && activeAfter === physicalIndex,
        mainActiveAliasUntouched: activeStillV1,
        deletePropagated,
        pendingFinal: cleanupOutbox.pending,
        failedFinal: cleanupOutbox.failed,
      },
      pass:
        updateReplayed && deletePropagated && aliasPromoted && activeStillV1,
    };
  } catch (error) {
    report.error =
      error instanceof Error ? error.message : 'RACE_CERTIFY_FAILED';
  } finally {
    if (fixtureCreated && !fixtureDeleted) {
      await prisma.corpusDocument
        .delete({ where: { id: documentId } })
        .then(() => {
          fixtureDeleted = true;
        })
        .catch(() => undefined);
      await waitForOutbox(worker, repository).catch(() => undefined);
    }
    const activeNow = await activePhysical(client, candidateAlias).catch(
      () => null,
    );
    if (activeNow) {
      const target = await client.indices.getAlias({ name: candidateAlias });
      const targetIndex = Object.keys(target.body)[0];
      await client.indices
        .deleteAlias({
          index: targetIndex,
          name: candidateAlias,
        })
        .catch(() => undefined);
      await client.indices
        .delete({ index: targetIndex })
        .catch(() => undefined);
      physicalIndex = targetIndex;
    } else if (physicalIndex) {
      await client.indices
        .delete({ index: physicalIndex })
        .catch(() => undefined);
    }
    const finalOutbox = await repository
      .outboxStatus()
      .catch(() => ({ pending: -1, failed: -1 }));
    const fixtureResidual = await prisma.corpusDocument
      .count({ where: { id: documentId } })
      .catch(() => -1);
    const activeAfterCleanup = await activePhysical(
      client,
      'galilei-search-active',
    ).catch(() => null);
    report.cleanup = {
      fixtureResidual,
      temporaryAliasResidual: await client.indices
        .existsAlias({ name: candidateAlias })
        .then((response) => response.body)
        .catch(() => true),
      temporaryIndexResidual: physicalIndex
        ? await client.indices
            .exists({ index: physicalIndex })
            .then((response) => response.body)
            .catch(() => true)
        : false,
      mainActiveAliasUnchanged: activeAfterCleanup === mainAliasBefore,
      outbox: finalOutbox,
      pass:
        fixtureResidual === 0 &&
        finalOutbox.pending === 0 &&
        finalOutbox.failed === 0 &&
        activeAfterCleanup === mainAliasBefore,
    };
    report.pass =
      report.pass === true &&
      (report.cleanup as { pass?: boolean }).pass === true;
    report.status = report.pass ? 'PASS' : 'FAIL';
    report.generatedAt ??= new Date().toISOString();
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await indexer.close().catch(() => undefined);
    await client.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    console.log(JSON.stringify(report, null, 2));
    if (report.pass !== true) process.exitCode = 1;
  }
}

async function activePhysical(client: Client, alias: string) {
  try {
    const response = await client.indices.getAlias({ name: alias });
    const indexes = Object.keys(response.body);
    return indexes.length === 1 ? indexes[0] : null;
  } catch {
    return null;
  }
}

async function indexNames(client: Client) {
  const response = (await client.cat.indices({
    index: 'galilei-search-v003-*',
    format: 'json',
  })) as unknown as { body: Array<{ index?: string }> };
  return response.body
    .map((row) => row.index)
    .filter((name): name is string => typeof name === 'string');
}

async function indexedSource(
  client: Client,
  index: string,
  id: string,
): Promise<CandidateSource | null> {
  try {
    const response = await client.get({ index, id });
    const body = (
      response as unknown as { body?: { _source?: CandidateSource } }
    ).body;
    return body?._source ?? null;
  } catch {
    return null;
  }
}

async function exactQueryCount(client: Client, index: string, term: string) {
  const response = await client.count({
    index,
    body: {
      query: {
        wildcard: { canonicalSearchText: { value: `*${term}*` } },
      },
    },
  });
  return Number(response.body.count ?? -1);
}

async function exactIdCount(client: Client, index: string, id: string) {
  const response = await client.count({
    index,
    body: { query: { ids: { values: [id] } } },
  });
  return Number(response.body.count ?? -1);
}

async function waitForOutbox(
  worker: OpenSearchSyncWorker,
  repository: OpenSearchDocumentRepository,
) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await worker.tick();
    const status = await repository.outboxStatus();
    if (status.failed > 0) throw new Error('RACE_OUTBOX_FAILED');
    if (status.pending === 0) return status;
    await new Promise((delay) => setTimeout(delay, 25));
  }
  throw new Error('RACE_OUTBOX_DRAIN_TIMEOUT');
}

function fileSha(path: string) {
  return sha(readFileSync(path));
}

function sha(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function hashIds(ids: string[]) {
  return sha([...ids].sort().join('\n'));
}

function loadLocalEnvironment() {
  const file = resolve(process.cwd(), '.env.development.local');
  const contents = readFileSync(file, 'utf8');
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const value = match[2];
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    process.env[match[1]] = quoted ? value.slice(1, -1) : value;
  }
}

loadLocalEnvironment();
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'RACE_CERTIFY_FAILED');
  process.exitCode = 1;
});

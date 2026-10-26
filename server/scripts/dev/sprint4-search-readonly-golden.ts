import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getRuntimeDatabasePoolConfig } from '../../src/config/runtime-database-config';
import { createSearchPostgresHydrators } from '../../src/busqueda/search-postgres-adapters';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import type { SearchQueryAst } from '../../src/busqueda/utils/search-ast';
import { OpenSearchRuntimeService } from '../../src/busqueda/opensearch/opensearch-runtime.service';
import type { SearchContext } from '../../src/busqueda/adapters/search-source.adapter';

const expectedCounts: Record<string, number> = {
  'responsabilidad civil': 4759,
  '"responsabilidad civil"': 3369,
  'falta de servicio': 1826,
};
const pageSize = 100;

async function main() {
  loadLocalEnvironment();
  const database = getRuntimeDatabasePoolConfig();
  const runtime = new OpenSearchRuntimeService(database);
  if (
    !runtime.config.readOnlyCandidate ||
    runtime.config.searchSchemaVersion !== 4 ||
    !/^galilei-search-v004-\d{8}t\d{9}z-[a-f0-9]{8}$/u.test(
      runtime.config.searchTarget,
    )
  ) {
    throw new Error('SEARCH_READ_ONLY_V4_TARGET_REQUIRED');
  }

  const aliasResponse = await runtime.client.indices.getAlias({
    name: runtime.config.alias,
  });
  const aliasBody =
    unwrapResponse<
      Record<string, { aliases?: Record<string, { is_write_index?: boolean }> }>
    >(aliasResponse);
  const aliasTargets = Object.entries(aliasBody ?? {});
  if (
    aliasTargets.length !== 1 ||
    aliasTargets[0][0] !== runtime.config.searchTarget ||
    aliasTargets[0][1]?.aliases?.[runtime.config.alias]?.is_write_index !== true
  ) {
    throw new Error('SEARCH_ACTIVE_ALIAS_V4_IDENTITY_MISMATCH');
  }

  const hydrators = createSearchPostgresHydrators(database);
  const source = runtime.createSource(
    'JURISPRUDENCIA',
    async (query, context, ids) => {
      const sentenceKeys = ids.filter((id) => id.startsWith('SENTENCIA:'));
      const summaryIds = ids.filter((id) => !id.startsWith('SENTENCIA:'));
      if (summaryIds.some((id) => !/^\d+$/u.test(id)))
        throw new Error('SEARCH_CANDIDATE_ID_INVALID');
      const [sentences, summaries] = await Promise.all([
        sentenceKeys.length
          ? hydrators.jurisprudencia.hydrateSentenciaCandidates(
              sentenceKeys,
              query,
              context,
            )
          : Promise.resolve(null),
        summaryIds.length
          ? hydrators.jurisprudencia.search(query, context, summaryIds)
          : Promise.resolve(null),
      ]);
      return {
        total:
          (sentences?.results.length ?? 0) + (summaries?.results.length ?? 0),
        totalExact: true,
        hasMore: false,
        page: context.page ?? 1,
        pageSize: context.pageSize ?? 0,
        results: [...(sentences?.results ?? []), ...(summaries?.results ?? [])],
      };
    },
    () => hydrators.jurisprudencia.close(),
  );

  const context: SearchContext = {
    visibility: 'PUBLIC',
    dialect: 'modern',
    publicationPolicy: 'published-active-only',
    pageSize,
    sort: { field: 'relevancia', order: 'desc' },
    sourceSystems: ['JURISPRUDENCIA'],
    documentKinds: ['SENTENCIA'],
  };
  const rows: Array<Record<string, unknown>> = [];
  try {
    const healthResponse = await runtime.client.cluster.health({
      index: runtime.config.searchTarget,
      local: true,
      timeout: '2s',
    });
    const health = unwrapResponse<{ status?: string }>(healthResponse).status;
    if (health !== 'green') throw new Error('SEARCH_V4_NOT_GREEN');

    for (const [queryText, expectedTotal] of Object.entries(expectedCounts)) {
      const ast = parseSearchQuery(queryText);
      const passes = [
        await collectOrderedIds(source, ast, context),
        await collectOrderedIds(source, ast, context),
      ];
      const orderingDifferences = countOrderingDifferences(
        passes[0].ids,
        passes[1].ids,
      );
      rows.push({
        query: queryText,
        expectedTotal,
        actualTotal: passes[0].total,
        totalExact: passes[0].totalExact && passes[1].totalExact,
        rowsRead: passes[0].ids.length,
        pagesPerPass: passes.map((pass) => pass.pages),
        orderedIdsSha256PerPass: passes.map((pass) => pass.orderedIdsSha256),
        orderingDifferences,
        pass:
          passes[0].total === expectedTotal &&
          passes[1].total === expectedTotal &&
          passes.every(
            (pass) => pass.totalExact && pass.ids.length === expectedTotal,
          ) &&
          orderingDifferences === 0,
      });
    }

    const artifact = {
      generatedAt: new Date().toISOString(),
      mode: 'read-only; two complete ordered result scans per public query',
      databaseIdentity:
        'enforced by with-dev-db-guard: bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      engine: 'OpenSearch 2.19.6',
      schemaVersion: runtime.config.searchSchemaVersion,
      alias: runtime.config.alias,
      physicalIndex: runtime.config.searchTarget,
      health,
      queries: rows,
      orderingDifferences: rows.reduce(
        (sum, row) => sum + Number(row.orderingDifferences),
        0,
      ),
      pass:
        rows.length === Object.keys(expectedCounts).length &&
        rows.every((row) => row.pass === true),
      writes: 'NONE',
    };
    const outputPath = path.resolve(
      process.cwd(),
      '..',
      '_recovery-work',
      'galilei-editorial-gold-recall-suite4',
      'search-readonly-golden.json',
    );
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(artifact, null, 2));
    if (!artifact.pass) process.exitCode = 1;
  } finally {
    await source.close?.();
    await hydrators.corpus.close();
    await runtime.index.close();
    await runtime.client.close();
  }
}

async function collectOrderedIds(
  source: ReturnType<OpenSearchRuntimeService['createSource']>,
  query: SearchQueryAst,
  context: SearchContext,
) {
  const ids: string[] = [];
  let total: number | undefined;
  let pages = 0;
  for (let page = 1; page <= 300; page += 1) {
    const result = await source.search(query, { ...context, page });
    pages += 1;
    if (result.totalExact !== true) throw new Error('SEARCH_TOTAL_NOT_EXACT');
    if (total !== undefined && result.total !== total)
      throw new Error('SEARCH_TOTAL_UNSTABLE');
    total = result.total;
    if (result.results.some((item) => item.sourceSystem !== 'JURISPRUDENCIA'))
      throw new Error('SEARCH_SOURCE_SCOPE_MISMATCH');
    ids.push(...result.results.map((item) => item.sourceId));
    if (ids.length >= total) break;
    if (result.results.length !== pageSize) throw new Error('SEARCH_PAGE_GAP');
    if (page === 300) throw new Error('SEARCH_PAGE_LIMIT_EXCEEDED');
  }
  if (total === undefined || ids.length !== total)
    throw new Error('SEARCH_PRODUCT_RESULT_COUNT_MISMATCH');
  if (new Set(ids).size !== ids.length)
    throw new Error('SEARCH_DUPLICATE_RESULT_ID');
  return {
    ids,
    total,
    totalExact: true,
    pages,
    orderedIdsSha256: createHash('sha256').update(ids.join('\n')).digest('hex'),
  };
}

function countOrderingDifferences(expected: string[], actual: string[]) {
  const length = Math.max(expected.length, actual.length);
  let differences = 0;
  for (let index = 0; index < length; index += 1) {
    if (expected[index] !== actual[index]) differences += 1;
  }
  return differences;
}

function unwrapResponse<T>(response: unknown): T {
  if (typeof response === 'object' && response !== null && 'body' in response)
    return (response as { body: T }).body;
  return response as T;
}

function loadLocalEnvironment() {
  const envFile = path.resolve(process.cwd(), '.env.development.local');
  const contents = readFileSync(envFile, 'utf8');
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

void main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  console.error(`SPRINT4_SEARCH_READONLY_GOLD=FAIL; ${code}`);
  process.exitCode = 1;
});

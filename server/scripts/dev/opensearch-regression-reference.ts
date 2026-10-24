import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@opensearch-project/opensearch';
import { OpenSearchDocumentRepository } from '../../src/busqueda/opensearch/opensearch-document.repository';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import { projectSentenciaSearchDocument } from '../../src/busqueda/opensearch/opensearch-search-document';
import {
  buildSearchQueryDsl,
  translateSearchNode,
} from '../../src/busqueda/opensearch/search-dsl';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';

const expectedCandidate = 'galilei-search-active';
const legacyIds = new Set(['32470', '35132']);
const artifactRoot = resolve(
  process.cwd(),
  '..',
  '..',
  '_recovery-work',
  'search-engine-integration1',
);

async function main() {
  loadLocalEnvironment();
  assertDevelopmentDatabase(process.env.DATABASE_URL);
  const config = readOpenSearchConfig();
  if (config.alias !== expectedCandidate)
    throw new Error('SEARCH_CANDIDATE_INDEX_REQUIRED');

  const repository = new OpenSearchDocumentRepository();
  const client = new Client(config.clientOptions);
  try {
    const activeResponse = await client.indices.getAlias({
      name: expectedCandidate,
    });
    const activeBody =
      (activeResponse as unknown as { body?: Record<string, unknown> }).body ??
      (activeResponse as unknown as Record<string, unknown>);
    const activeTargets = Object.keys(activeBody);
    if (
      activeTargets.length !== 1 ||
      !activeTargets[0].startsWith('galilei-search-v004-')
    ) {
      throw new Error('SEARCH_ACTIVE_V4_ALIAS_REQUIRED');
    }

    const parsed = parseSearchQuery('responsabilidad civil');
    const terms = parsed.root?.type === 'and' ? parsed.root.operands : [];
    const expectedTerms = ['responsabilidad', 'civil'];
    if (
      terms.length !== expectedTerms.length ||
      terms.some(
        (term, index) =>
          term.type !== 'term' || term.normalizedValue !== expectedTerms[index],
      )
    )
      throw new Error('SEARCH_REGRESSION_AST_MISMATCH');
    const expectedPrefixDsl = {
      bool: {
        must: expectedTerms.map((value) => ({
          prefix: {
            publicLexicalTokens: { value, case_insensitive: false },
          },
        })),
      },
    };
    if (
      JSON.stringify(translateSearchNode(parsed.root, true)) !==
      JSON.stringify(expectedPrefixDsl)
    )
      throw new Error('SEARCH_REGRESSION_PREFIX_CONTRACT_MISMATCH');

    const referenceStarted = performance.now();
    const reference = await repository.withReadSnapshot(async (snapshot) => {
      const matched = new Set<string>();
      const pageSize = 500;
      let afterId = 0;
      let publicPublishedSentenciaRowsScanned = 0;
      let publicPublishedRowsEvaluated = 0;
      while (true) {
        const rows = await repository.publishedSentenciaPage(
          snapshot,
          afterId,
          pageSize,
        );
        if (!rows.length) break;
        publicPublishedSentenciaRowsScanned += rows.length;
        for (const row of rows) {
          if (!row.activo || !row.publicado || row.estadoCarga !== 'PUBLICADA')
            continue;
          publicPublishedRowsEvaluated += 1;
          const document = projectSentenciaSearchDocument(row);
          if (
            !document ||
            document.sourceType !== 'SENTENCIA' ||
            document.active !== true ||
            document.publicationStatus !== 'PUBLISHED'
          )
            continue;
          const tokens = document.publicLexicalTokens;
          if (
            tokens.some((token) => token.startsWith('responsabilidad')) &&
            tokens.some((token) => token.startsWith('civil'))
          ) {
            matched.add(String(row.id));
          }
        }
        afterId = rows[rows.length - 1].id;
        console.log(
          `referenceScan rows=${publicPublishedSentenciaRowsScanned} matches=${matched.size} afterId=${afterId}`,
        );
        if (rows.length < pageSize) break;
      }
      return {
        ids: [...matched].sort(),
        publicPublishedSentenciaRowsScanned,
        publicPublishedRowsEvaluated,
      };
    });
    const referenceMs = Math.round(performance.now() - referenceStarted);

    const query = buildSearchQueryDsl(
      parsed,
      {
        visibility: 'PUBLIC',
        dialect: 'modern',
        publicationPolicy: 'published-active-only',
        page: 1,
        pageSize: 500,
        documentKinds: ['SENTENCIA'],
      },
      { source: 'JURISPRUDENCIA' },
    );
    const searchStarted = performance.now();
    const indexedIds: string[] = [];
    let indexedTotal: number | null = null;
    for (let from = 0; ; from += 500) {
      const response = await client.search({
        index: expectedCandidate,
        body: {
          from,
          size: 500,
          track_total_hits: true,
          _source: false,
          query,
          sort: [
            { _score: { order: 'desc' } },
            { decisionDate: { order: 'desc', missing: '_last' } },
            { updatedAt: { order: 'desc', missing: '_last' } },
            { id: { order: 'asc' } },
          ],
        },
      });
      const body =
        (response as unknown as { body?: Record<string, unknown> }).body ??
        (response as unknown as Record<string, unknown>);
      const hits = body.hits as {
        total?: { value?: number; relation?: string };
        hits?: Array<{ _id: string }>;
      };
      if (hits.total?.relation !== 'eq')
        throw new Error('SEARCH_REGRESSION_TOTAL_NOT_EXACT');
      indexedTotal = Number(hits.total.value ?? 0);
      const page = hits.hits ?? [];
      indexedIds.push(
        ...page.map((hit) =>
          hit._id.replace(/^JURISPRUDENCIA:SENTENCIA:/u, ''),
        ),
      );
      if (from + page.length >= indexedTotal || page.length === 0) break;
    }
    const searchMs = Math.round(performance.now() - searchStarted);
    const referenceSet = new Set(reference.ids);
    const indexedSet = new Set(indexedIds);
    const referenceOnly = reference.ids.filter((id) => !indexedSet.has(id));
    const newOnly = [...indexedSet]
      .filter((id) => !referenceSet.has(id))
      .sort();
    const legacyOnly = [...legacyIds].filter((id) => !referenceSet.has(id));
    const referenceOnlyLegacy = [...legacyIds].filter(
      (id) => !indexedSet.has(id),
    );
    const additionalComparedWithLegacy = [...indexedSet]
      .filter((id) => !legacyIds.has(id))
      .sort();
    const exactIdEquality =
      indexedTotal === reference.ids.length &&
      indexedSet.size === referenceSet.size &&
      referenceOnly.length === 0 &&
      newOnly.length === 0;
    const result = {
      generatedAt: new Date().toISOString(),
      status: exactIdEquality
        ? 'PASS_POSTGRES_PROJECTION_REFERENCE_EQUALS_CANDIDATE'
        : 'BLOCKED_POSTGRES_PROJECTION_REFERENCE_DIFFERS_FROM_CANDIDATE',
      route: 'GET /api/public/busqueda',
      rawQuery: 'responsabilidad civil',
      ast: 'AND(prefix(responsabilidad), prefix(civil))',
      routeContext: {
        visibility: 'PUBLIC',
        sourceSystem: 'JURISPRUDENCIA',
        documentKinds: ['SENTENCIA'],
        active: true,
        publicationStatus: 'PUBLISHED',
        explicitMetadataFilters: [],
        sort: 'relevancia DESC; decisionDate DESC; updatedAt DESC; id ASC',
      },
      evaluator:
        'Independent read-only PostgreSQL snapshot: rebuild every active, published Sentencia projection with projectSentenciaSearchDocument, then evaluate the two public lexical prefix predicates; compare to all paged IDs from the physical OpenSearch candidate using the same route DSL and filters.',
      databaseTarget: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      candidateIndex: expectedCandidate,
      publicPublishedSentenciaRowsScanned:
        reference.publicPublishedSentenciaRowsScanned,
      publicPublishedRowsEvaluated: reference.publicPublishedRowsEvaluated,
      referenceTotal: reference.ids.length,
      indexedTotal,
      indexedDistinctIdCount: indexedSet.size,
      referenceIdSetSha256: sha256(reference.ids),
      indexedIdSetSha256: sha256([...indexedSet].sort()),
      exactIdEquality,
      referenceOnlyCount: referenceOnly.length,
      referenceOnlySample: referenceOnly.slice(0, 10),
      indexOnlyCount: newOnly.length,
      indexOnlySample: newOnly.slice(0, 10),
      legacyTotal: legacyIds.size,
      legacyOnlyAgainstReferenceCount: legacyOnly.length,
      legacyOnlyAgainstCandidateCount: referenceOnlyLegacy.length,
      legacyIdsPresentInReference: [...legacyIds]
        .filter((id) => referenceSet.has(id))
        .sort(),
      legacyIdsPresentInCandidate: [...legacyIds]
        .filter((id) => indexedSet.has(id))
        .sort(),
      newOnlyComparedWithLegacyCount: additionalComparedWithLegacy.length,
      newOnlyComparedWithLegacySample: additionalComparedWithLegacy.slice(
        0,
        10,
      ),
      timingsMs: {
        postgresProjectionEvaluator: referenceMs,
        candidateSearch: searchMs,
      },
      writes:
        'NONE; PostgreSQL transaction is READ ONLY; candidate index is queried only.',
    };
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(
      resolve(artifactRoot, 'regression-query-semantic-analysis.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await Promise.all([repository.close(), client.close()]);
  }
}

function loadLocalEnvironment() {
  const file = resolve(process.cwd(), '.env.development.local');
  const contents = readFileSync(file, 'utf8');
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const raw = match[2];
    const quoted =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"));
    process.env[match[1]] = quoted ? raw.slice(1, -1) : raw;
  }
}

function assertDevelopmentDatabase(value?: string) {
  if (!value) throw new Error('DEV_DATABASE_URL_REQUIRED');
  const target = new URL(value);
  if (
    target.protocol !== 'postgresql:' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '55432' ||
    target.pathname !== '/buscador_juridico_civil_dev' ||
    target.username !== 'bjc_dev'
  )
    throw new Error('DEV_DATABASE_TARGET_REJECTED');
}

function sha256(ids: string[]) {
  return createHash('sha256').update(ids.join('\n')).digest('hex');
}

void main().catch((error: unknown) => {
  const code =
    error instanceof Error &&
    /^(?:SEARCH_|OPENSEARCH_|DEV_)/u.test(error.message)
      ? error.message
      : 'SEARCH_REGRESSION_REFERENCE_FAILED';
  console.error(
    `${code}; errorType=${error instanceof Error ? error.name : 'unknown'}`,
  );
  process.exitCode = 1;
});

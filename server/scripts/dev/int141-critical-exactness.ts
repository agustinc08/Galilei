import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@opensearch-project/opensearch';
import { buildSearchQueryDsl } from '../../src/busqueda/opensearch/search-dsl';
import { phraseSequence } from '../../src/busqueda/opensearch/opensearch-mapping';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import { normalizeSearchText } from '../../src/busqueda/utils/search-normalizer';
import type { SearchContext } from '../../src/busqueda/adapters/search-source.adapter';
import type { SearchQueryAst } from '../../src/busqueda/utils/search-ast';

type SearchBody = {
  hits?: {
    total?: { value?: number; relation?: 'eq' | 'gte' };
    hits?: Array<{ _id: string }>;
  };
};

type CriticalReference = {
  phraseId: string;
  expectedCount: number;
  expectedIdSetSha256: string;
};

type CriticalExactnessRow = {
  phraseId: string;
  phrase: string;
  expectedCount: number;
  expectedIdSetSha256: string;
  baselineCount: number;
  baselineIdSetSha256: string;
  candidateCount: number;
  candidateIdSetSha256: string;
  falsePositives: number;
  falseNegatives: number;
  exact: boolean;
};

const phrases: Record<string, string> = {
  'responsabilidad-civil': 'responsabilidad civil',
  'falta-de-servicio': 'falta de servicio',
};

const context: SearchContext = {
  visibility: 'INTERNAL',
  dialect: 'modern',
  publicationPolicy: 'legacy-active-only',
  page: 1,
  pageSize: 20,
  sourceSystems: ['CORPUS'],
};

function loadLocalEnvironment() {
  const envFile = resolve(process.cwd(), '.env.development.local');
  const content = readFileSync(envFile, 'utf8');
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

function unwrap<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'body' in response) {
    const body = (response as { body?: unknown }).body;
    if (body && typeof body === 'object') return body as T;
  }
  return response as T;
}

function queryAst(phrase: string): SearchQueryAst {
  const parsed = parseSearchQuery(`"${phrase}"`);
  if (parsed.root?.type !== 'phrase')
    throw new Error('CRITICAL_PHRASE_INVALID');
  return parsed;
}

function hashIds(ids: string[]) {
  return createHash('sha256')
    .update([...ids].sort().join('\n'))
    .digest('hex');
}

async function exactIds(
  client: Client,
  index: string,
  query: Record<string, unknown>,
  expectedCount: number,
) {
  const response = await client.search({
    index,
    request_cache: false,
    body: {
      from: 0,
      size: expectedCount + 1,
      track_total_hits: true,
      _source: false,
      sort: [{ id: { order: 'asc' } }],
      query,
    },
  });
  const body = unwrap<SearchBody>(response);
  const total = body.hits?.total;
  if (!total || total.relation !== 'eq' || !Number.isSafeInteger(total.value)) {
    throw new Error('CRITICAL_TOTAL_NOT_EXACT');
  }
  return {
    total: total.value as number,
    ids: (body.hits?.hits ?? []).map((hit) => hit._id),
  };
}

async function main() {
  loadLocalEnvironment();
  const root = resolve(
    process.cwd(),
    '../_recovery-work/search-engine-integration1',
  );
  const reference = JSON.parse(
    readFileSync(resolve(root, 'phrase-100-v2.json'), 'utf8'),
  ) as { sourceIndex: string; criticalRows: CriticalReference[] };
  const build = JSON.parse(
    readFileSync(resolve(root, 'candidate-v2-build.json'), 'utf8'),
  ) as { candidateIndex: string };
  if (reference.criticalRows.length !== 2) {
    throw new Error('CRITICAL_REFERENCE_ROWS_INVALID');
  }

  const client = new Client(readOpenSearchConfig().clientOptions);
  try {
    const rows: CriticalExactnessRow[] = [];
    for (const expected of reference.criticalRows) {
      const phrase = phrases[expected.phraseId];
      if (!phrase) throw new Error('CRITICAL_REFERENCE_PHRASE_UNKNOWN');
      const baselineQuery = {
        bool: {
          filter: [{ term: { sourceSystem: 'CORPUS' } }],
          must: [
            {
              match_phrase: {
                phraseSequence: phraseSequence(normalizeSearchText(phrase)),
              },
            },
          ],
        },
      };
      const candidateQuery = buildSearchQueryDsl(queryAst(phrase), context, {
        source: 'CORPUS',
      });
      const [baseline, candidate] = await Promise.all([
        exactIds(
          client,
          reference.sourceIndex,
          baselineQuery,
          expected.expectedCount,
        ),
        exactIds(
          client,
          build.candidateIndex,
          candidateQuery,
          expected.expectedCount,
        ),
      ]);
      const baselineHash = hashIds(baseline.ids);
      const candidateHash = hashIds(candidate.ids);
      const baselineSet = new Set(baseline.ids);
      const candidateSet = new Set(candidate.ids);
      rows.push({
        phraseId: expected.phraseId,
        phrase,
        expectedCount: expected.expectedCount,
        expectedIdSetSha256: expected.expectedIdSetSha256,
        baselineCount: baseline.total,
        baselineIdSetSha256: baselineHash,
        candidateCount: candidate.total,
        candidateIdSetSha256: candidateHash,
        falsePositives: candidate.ids.filter((id) => !baselineSet.has(id))
          .length,
        falseNegatives: baseline.ids.filter((id) => !candidateSet.has(id))
          .length,
        exact:
          baseline.total === expected.expectedCount &&
          candidate.total === expected.expectedCount &&
          baselineHash === expected.expectedIdSetSha256 &&
          candidateHash === expected.expectedIdSetSha256,
      });
    }
    const report = {
      sprint: 'SEARCH-ENGINE-INTEGRATION-1.4.1',
      generatedAt: new Date().toISOString(),
      sourceIndex: reference.sourceIndex,
      candidateIndex: build.candidateIndex,
      rows,
      exactCount: rows.filter((row) => row.exact).length,
      requiredCount: reference.criticalRows.length,
      falsePositives: rows.reduce((sum, row) => sum + row.falsePositives, 0),
      falseNegatives: rows.reduce((sum, row) => sum + row.falseNegatives, 0),
      exact: rows.every((row) => row.exact),
    };
    writeFileSync(
      resolve(root, 'critical-v2-exactness.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.exact) process.exitCode = 2;
  } finally {
    await client.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'CRITICAL_EXACTNESS_FAILED'}\n`,
  );
  process.exitCode = 1;
});

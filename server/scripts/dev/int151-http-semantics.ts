import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BusquedaModule } from '../../src/busqueda/busqueda.module';
import { OpenSearchDocumentRepository } from '../../src/busqueda/opensearch/opensearch-document.repository';
import { projectSentenciaSearchDocument } from '../../src/busqueda/opensearch/opensearch-search-document';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  evaluateSearchNode,
  type SearchLiteralNode,
} from '../../src/busqueda/utils/search-ast';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';

const candidate = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const root = resolve(
  process.cwd(),
  '../_recovery-work/search-engine-integration1',
);
type Suite = 'phrase100' | 'prefix14' | 'wildcards' | 'boolean';
type Entry = { suite: Suite; id: string; query: string; expected: string[] };
type HttpBody = {
  federated?: {
    total?: number;
    totalExact?: boolean;
    hasMore?: boolean;
    results?: Array<{ sourceId?: string }>;
  };
};

async function main() {
  const db = new URL(process.env.DATABASE_URL ?? '');
  if (
    db.protocol !== 'postgresql:' ||
    db.hostname !== '127.0.0.1' ||
    db.port !== '55432' ||
    db.pathname !== '/buscador_juridico_civil_dev' ||
    db.username !== 'bjc_dev'
  )
    throw new Error('DEV_DB_GUARD_REQUIRED');
  process.env.NODE_ENV = 'development';
  process.env.SEARCH_ENGINE = 'opensearch';
  process.env.OPENSEARCH_INDEX_ALIAS = candidate;
  process.env.OPENSEARCH_NODE = 'http://127.0.0.1:9200';
  process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';

  const frozen = JSON.parse(
    readFileSync(
      resolve(tmpdir(), 'galilei-search-int141-phrase-set.json'),
      'utf8',
    ),
  ) as string[];
  const frozenReference = JSON.parse(
    readFileSync(resolve(root, 'phrase-100-v2.json'), 'utf8'),
  ) as { rows: Array<{ queryHash: string }> };
  if (
    frozen.length !== 100 ||
    frozenReference.rows.length !== 100 ||
    frozen.some(
      (query, index) => sha(query) !== frozenReference.rows[index].queryHash,
    )
  )
    throw new Error('FROZEN_PHRASE_SET_MISMATCH');
  const prefixReference = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        '../_recovery-work/search-engine-eval2/prefix-equivalence.json',
      ),
      'utf8',
    ),
  ) as { rows: Array<{ term: string }> };
  if (prefixReference.rows.length !== 14)
    throw new Error('FROZEN_PREFIX_SET_MISMATCH');
  const entries: Entry[] = [
    ...frozen.map((query, index) => ({
      suite: 'phrase100' as const,
      id: `phrase-${index + 1}`,
      query: `"${query.replaceAll('"', '')}"`,
      expected: [],
    })),
    ...prefixReference.rows.map((row, index) => ({
      suite: 'prefix14' as const,
      id: `prefix-${index + 1}`,
      query: row.term,
      expected: [],
    })),
    {
      suite: 'wildcards',
      id: 'term-percent',
      query: 'responsab%',
      expected: [],
    },
    { suite: 'wildcards', id: 'percent-term', query: '%bilidad', expected: [] },
    {
      suite: 'wildcards',
      id: 'percent-term-percent',
      query: '%ponsab%',
      expected: [],
    },
    {
      suite: 'boolean',
      id: 'and-terms',
      query: 'responsabilidad civil',
      expected: [],
    },
    {
      suite: 'boolean',
      id: 'or-terms',
      query: 'responsabilidad OR servicio',
      expected: [],
    },
    {
      suite: 'boolean',
      id: 'exclude-term',
      query: 'responsabilidad -civil',
      expected: [],
    },
    {
      suite: 'boolean',
      id: 'phrase-and-term',
      query: '"responsabilidad civil" daño',
      expected: [],
    },
    {
      suite: 'boolean',
      id: 'phrase-or-prefix',
      query: '"falta de servicio" OR contr%',
      expected: [],
    },
    {
      suite: 'boolean',
      id: 'prefix-and-exclude',
      query: 'responsab% -contrato',
      expected: [],
    },
    {
      suite: 'boolean',
      id: 'grouped',
      query: '(responsabilidad OR contrato) AND civil',
      expected: [],
    },
  ];
  const parsed = entries.map((entry) => parseSearchQuery(entry.query));
  const referenceCache = resolve(
    root,
    'http-semantics-reference-cache-1_5_1.json',
  );
  const repository = new OpenSearchDocumentRepository();
  let app: INestApplication | undefined;
  try {
    let scanned = 0;
    if (existsSync(referenceCache)) {
      const cache = JSON.parse(readFileSync(referenceCache, 'utf8')) as {
        scanned: number;
        rows: Array<{ queryHash: string; ids: string[] }>;
      };
      if (
        cache.rows.length !== entries.length ||
        cache.rows.some(
          (row, index) => row.queryHash !== sha(entries[index].query),
        )
      )
        throw new Error('REFERENCE_CACHE_MISMATCH');
      scanned = cache.scanned;
      cache.rows.forEach((row, index) => {
        entries[index].expected = row.ids;
      });
    } else {
      scanned = await repository.withReadSnapshot(async (snapshot) => {
        let lastId = 0;
        let count = 0;
        for (;;) {
          const page = await repository.publishedSentenciaPage(
            snapshot,
            lastId,
            500,
          );
          if (!page.length) break;
          for (const row of page) {
            if (
              !row.activo ||
              !row.publicado ||
              row.estadoCarga !== 'PUBLICADA'
            )
              continue;
            const document = projectSentenciaSearchDocument(row);
            if (
              !document ||
              document.sourceType !== 'SENTENCIA' ||
              document.publicationStatus !== 'PUBLISHED' ||
              !document.active
            )
              continue;
            count += 1;
            const text = document.publicSearchText;
            const tokens = document.publicLexicalTokens;
            for (let i = 0; i < entries.length; i += 1) {
              const matched = evaluateSearchNode(parsed[i].root, (node) =>
                matches(node, text, tokens),
              );
              if (matched) entries[i].expected.push(String(row.id));
            }
          }
          lastId = page[page.length - 1].id;
          if (page.length < 500) break;
        }
        return count;
      });
      writeFileSync(
        referenceCache,
        `${JSON.stringify({
          scanned,
          rows: entries.map((entry) => ({
            queryHash: sha(entry.query),
            ids: entry.expected,
          })),
        })}\n`,
        'utf8',
      );
    }
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        BusquedaModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    const port = (
      app.getHttpServer() as { address(): { port: number } | null }
    ).address()?.port;
    if (!port) throw new Error('HTTP_PORT_MISSING');
    const results: Record<Suite, Array<Record<string, unknown>>> = {
      phrase100: [],
      prefix14: [],
      wildcards: [],
      boolean: [],
    };
    for (const entry of entries) {
      const started = performance.now();
      const actual: string[] = [];
      let total: number | null = null;
      let status = 0;
      let exact = true;
      let timedOut = false;
      for (let page = 1; page <= 100; page += 1) {
        const url = new URL(`http://127.0.0.1:${port}/api/public/busqueda`);
        url.searchParams.set('q', entry.query);
        url.searchParams.set('page', String(page));
        url.searchParams.set('pageSize', '100');
        let response: globalThis.Response;
        try {
          response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        } catch {
          timedOut = true;
          break;
        }
        status = response.status;
        if (status !== 200) break;
        const body = (await response.json()) as HttpBody;
        if (
          !body.federated?.totalExact ||
          !Number.isSafeInteger(body.federated.total)
        ) {
          exact = false;
          break;
        }
        if (total === null) total = body.federated.total!;
        if (total !== body.federated.total) exact = false;
        actual.push(
          ...(body.federated.results ?? []).map((hit) =>
            String(hit.sourceId ?? ''),
          ),
        );
        if (!body.federated.hasMore) break;
        if (page === 100) exact = false;
      }
      const expected = [...entry.expected].sort();
      const unique = [...new Set(actual)].sort();
      const pass =
        !timedOut &&
        status === 200 &&
        exact &&
        total === expected.length &&
        actual.length === expected.length &&
        unique.length === expected.length &&
        unique.every((id, index) => id === expected[index]);
      results[entry.suite].push({
        id: entry.id,
        queryHash: sha(entry.query),
        expectedTotal: expected.length,
        actualTotal: total,
        actualRows: actual.length,
        uniqueRows: unique.length,
        expectedIdSetHash: sha(expected.join('\n')),
        actualIdSetHash: sha(unique.join('\n')),
        status,
        timedOut,
        latencyMs: Math.round((performance.now() - started) * 100) / 100,
        pass,
      });
      if (results[entry.suite].length % 25 === 0)
        console.log(`${entry.suite}: ${results[entry.suite].length}`);
    }
    for (const [suite, rows] of Object.entries(results)) {
      const name =
        suite === 'phrase100'
          ? 'http-phrase100'
          : suite === 'prefix14'
            ? 'http-prefix14'
            : suite === 'wildcards'
              ? 'http-wildcards'
              : 'http-boolean';
      const output = {
        generatedAt: new Date().toISOString(),
        suite,
        candidate,
        route: 'GET /api/public/busqueda',
        universe:
          '6014 active published Sentencias from guarded read-only PostgreSQL snapshot',
        reference:
          'independent AST evaluator over projected PostgreSQL source rows',
        scanned,
        cases: rows.length,
        passed: rows.filter((row) => row.pass).length,
        timeouts: rows.filter((row) => row.timedOut).length,
        rows,
        pass: rows.every((row) => row.pass),
      };
      writeFileSync(
        resolve(root, `${name}-1_5_1.json`),
        `${JSON.stringify(output, null, 2)}\n`,
        'utf8',
      );
      console.log(
        `${suite}: ${output.passed}/${output.cases} PASS=${output.pass}`,
      );
      if (!output.pass) process.exitCode = 1;
    }
  } finally {
    if (app) await app.close();
    await repository.close();
  }
}

function matches(
  node: SearchLiteralNode,
  text: string,
  tokens: string[],
): boolean {
  const needle = node.normalizedValue;
  if (!needle) return false;
  if (node.type === 'phrase') {
    let index = text.indexOf(needle);
    while (index >= 0) {
      const before = index ? text[index - 1] : '';
      const after = text[index + needle.length] ?? '';
      if (
        (!before || !/[\p{L}\p{N}]/u.test(before)) &&
        (!after || !/[\p{L}\p{N}]/u.test(after))
      )
        return true;
      index = text.indexOf(needle, index + 1);
    }
    return false;
  }
  if (node.matchMode === 'suffix')
    return tokens.some((token) => token.endsWith(needle));
  if (node.matchMode === 'contains' && node.sourceText.includes('%'))
    return tokens.some((token) => token.includes(needle));
  return tokens.some((token) => token.startsWith(needle));
}

function sha(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'HTTP_SEMANTICS_FAILED',
  );
  process.exitCode = 1;
});

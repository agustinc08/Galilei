import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { OpenSearchDocumentRepository } from '../../src/busqueda/opensearch/opensearch-document.repository';
import { projectSentenciaSearchDocument } from '../../src/busqueda/opensearch/opensearch-search-document';
import { BusquedaModule } from '../../src/busqueda/busqueda.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';

const CANDIDATE = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const OUTPUT = resolve(
  process.cwd(),
  '../_recovery-work/search-engine-integration1/critical-reference-v3.json',
);
const queries = [
  {
    id: 'responsabilidad-civil',
    text: 'responsabilidad civil',
    previousCorpusPhraseTotal: 5364,
  },
  {
    id: 'falta-de-servicio',
    text: 'falta de servicio',
    previousCorpusPhraseTotal: 194,
  },
] as const;

type HttpBody = {
  federated?: {
    total?: number;
    totalExact?: boolean;
    hasMore?: boolean;
    results?: Array<{ sourceId?: string }>;
  };
};

async function main() {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (
    target.protocol !== 'postgresql:' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '55432' ||
    target.pathname !== '/buscador_juridico_civil_dev' ||
    target.username !== 'bjc_dev'
  )
    throw new Error('DEV_DB_GUARD_REQUIRED');
  process.env.NODE_ENV = 'development';
  process.env.SEARCH_ENGINE = 'opensearch';
  process.env.OPENSEARCH_INDEX_ALIAS = CANDIDATE;
  process.env.OPENSEARCH_NODE = 'http://127.0.0.1:9200';
  process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';

  const repository = new OpenSearchDocumentRepository();
  let app: INestApplication | undefined;
  try {
    const references = await repository.withReadSnapshot(async (snapshot) => {
      const sets = queries.map(() => new Set<string>());
      const parsedTerms = queries.map((entry) => {
        const parsed = parseSearchQuery(entry.text);
        if (parsed.root?.type !== 'and')
          throw new Error('CRITICAL_AST_CHANGED');
        return parsed.root.operands.map((node) => {
          if (node.type !== 'term' || node.sourceText.includes('%'))
            throw new Error('CRITICAL_AST_CHANGED');
          return node.normalizedValue;
        });
      });
      let scanned = 0;
      let lastId = 0;
      for (;;) {
        const page = await repository.publishedSentenciaPage(
          snapshot,
          lastId,
          500,
        );
        if (!page.length) break;
        for (const row of page) {
          if (!row.activo || !row.publicado || row.estadoCarga !== 'PUBLICADA')
            continue;
          const document = projectSentenciaSearchDocument(row);
          if (
            !document ||
            document.sourceType !== 'SENTENCIA' ||
            document.publicationStatus !== 'PUBLISHED' ||
            !document.active
          )
            continue;
          scanned += 1;
          parsedTerms.forEach((terms, index) => {
            if (
              terms.every((term) =>
                document.publicLexicalTokens.some((token) =>
                  token.startsWith(term),
                ),
              )
            ) {
              sets[index].add(String(row.id));
            }
          });
        }
        lastId = page[page.length - 1].id;
        if (page.length < 500) break;
      }
      return { scanned, ids: sets.map((set) => [...set].sort()) };
    });
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
    const server = app.getHttpServer() as {
      address(): { port: number } | null;
    };
    const port = server.address()?.port;
    if (!port) throw new Error('HTTP_SERVER_PORT_MISSING');

    const rows: Array<{ exactIdEquality: boolean; [key: string]: unknown }> =
      [];
    for (let index = 0; index < queries.length; index += 1) {
      const entry = queries[index];
      const expectedIds = references.ids[index];
      const actualIds: string[] = [];
      let productTotal: number | null = null;
      let status = 0;
      let exact = true;
      let pages = 0;
      for (let page = 1; ; page += 1) {
        const url = new URL(`http://127.0.0.1:${port}/api/public/busqueda`);
        url.searchParams.set('q', entry.text);
        url.searchParams.set('page', String(page));
        url.searchParams.set('pageSize', '100');
        const response = await fetch(url, {
          signal: AbortSignal.timeout(30_000),
        });
        status = response.status;
        if (status !== 200) break;
        const body = (await response.json()) as HttpBody;
        if (
          body.federated?.totalExact !== true ||
          !Number.isSafeInteger(body.federated.total)
        ) {
          exact = false;
          break;
        }
        if (productTotal === null) productTotal = body.federated.total!;
        if (productTotal !== body.federated.total) exact = false;
        actualIds.push(
          ...(body.federated.results ?? []).map((hit) =>
            String(hit.sourceId ?? ''),
          ),
        );
        pages += 1;
        if (!body.federated.hasMore) break;
        if (page >= 100) throw new Error('CRITICAL_HTTP_PAGE_LIMIT');
      }
      const actualSet = [...new Set(actualIds)].sort();
      const pass =
        status === 200 &&
        exact &&
        productTotal === expectedIds.length &&
        actualIds.length === productTotal &&
        actualSet.length === expectedIds.length &&
        actualSet.every((id, position) => id === expectedIds[position]);
      rows.push({
        queryId: entry.id,
        querySha256: sha256(entry.text),
        referenceUniverse:
          'active published Sentencias projected from guarded read-only PostgreSQL snapshot',
        referenceTotal: expectedIds.length,
        referenceIdSetSha256: sha256(expectedIds.join('\n')),
        productTotal,
        productIdSetSha256: sha256(actualSet.join('\n')),
        productRows: actualIds.length,
        productPages: pages,
        httpStatus: status,
        exactIdEquality: pass,
        historicalCorpusExactPhraseTotal: entry.previousCorpusPhraseTotal,
        historicalDifference:
          'Earlier total evaluated exact phrase over GENERAL Corpus (17,077 eligible); current endpoint evaluates prefix AND over published Sentencias (6,014 eligible). Both universe and query semantics differ.',
      });
    }
    const output = {
      generatedAt: new Date().toISOString(),
      candidate: CANDIDATE,
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      postgresReadOnlySnapshot: true,
      publishedSentenciasScanned: references.scanned,
      route: 'GET /api/public/busqueda',
      rows,
      pass:
        references.scanned === 6014 && rows.every((row) => row.exactIdEquality),
      queryTextPersisted: false,
      documentTextPersisted: false,
    };
    mkdirSync(resolve(OUTPUT, '..'), { recursive: true });
    writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(output, null, 2));
    if (!output.pass) process.exitCode = 1;
  } finally {
    if (app) await app.close();
    await repository.close();
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'CRITICAL_REFERENCE_FAILED',
  );
  process.exitCode = 1;
});

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@opensearch-project/opensearch';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import { OpenSearchDocumentRepository } from '../../src/busqueda/opensearch/opensearch-document.repository';
import { phraseSequence } from '../../src/busqueda/opensearch/opensearch-mapping';

const index = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const v1 = 'galilei-search-v001-20261016t162707813z-1dbe2406';
const PAGE_SIZE = 5;
const outputPath = resolve(
  process.cwd(),
  '../_recovery-work/search-engine-integration1/scope-sequence-backfill-1_5_1.json',
);
type Scope = Record<string, { text?: string; phraseSequence?: string }>;
type Hit = {
  _id: string;
  _source?: { searchScopeFields?: Scope; publicSearchScopeFields?: Scope };
};
type ScrollBody = { _scroll_id?: string; hits?: { hits?: Hit[] } };

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
  process.env.OPENSEARCH_INDEX_ALIAS = 'galilei-search-int151-cert';
  process.env.OPENSEARCH_NODE = 'http://127.0.0.1:9200';
  process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';
  const client = new Client(readOpenSearchConfig().clientOptions);
  const repository = new OpenSearchDocumentRepository();
  let scrollId: string | undefined;
  let scanned = 0;
  let updated = 0;
  let batches = 0;
  let aliasBefore = '';
  let bulkFailure: Array<{ id: string; status?: number; error: unknown }> = [];
  const started = Date.now();
  try {
    const mainAlias = response<Record<string, unknown>>(
      await client.indices.getAlias({ name: 'galilei-search-active' }),
    );
    const certAlias = response<Record<string, unknown>>(
      await client.indices.getAlias({ name: 'galilei-search-int151-cert' }),
    );
    aliasBefore = Object.keys(mainAlias).join(',');
    if (aliasBefore !== v1 || Object.keys(certAlias).join(',') !== index)
      throw new Error('ALIAS_PRECONDITION_FAILED');
    const backlog = await repository.outboxStatus();
    if (backlog.pending || backlog.failed)
      throw new Error('OUTBOX_PRECONDITION_FAILED');
    const countBody = response<{ count?: number }>(
      await client.count({ index }),
    );
    if (countBody.count !== 69313)
      throw new Error('CANDIDATE_COUNT_PRECONDITION_FAILED');
    const mapping = response<
      Record<
        string,
        { mappings?: { _meta?: { galileiSearchSchemaVersion?: number } } }
      >
    >(await client.indices.getMapping({ index }));
    if (mapping[index]?.mappings?._meta?.galileiSearchSchemaVersion !== 3)
      throw new Error('CANDIDATE_SCHEMA_PRECONDITION_FAILED');
    let page = response<ScrollBody>(
      await client.search(
        {
          index,
          scroll: '5m',
          body: {
            size: PAGE_SIZE,
            sort: ['_doc'],
            query: { match_all: {} },
            _source: [
              'searchScopeFields.*.text',
              'searchScopeFields.*.phraseSequence',
              'publicSearchScopeFields.*.text',
              'publicSearchScopeFields.*.phraseSequence',
            ],
          },
        },
        { requestTimeout: 120000 },
      ),
    );
    scrollId = page._scroll_id;
    for (;;) {
      const hits = page.hits?.hits ?? [];
      if (!hits.length) break;
      const bulk: Array<Record<string, unknown>> = [];
      for (const hit of hits) {
        scanned += 1;
        const doc: Record<string, Scope> = {};
        for (const key of [
          'searchScopeFields',
          'publicSearchScopeFields',
        ] as const) {
          const scopes = hit._source?.[key];
          if (!scopes) continue;
          const changed: Scope = {};
          for (const [name, field] of Object.entries(scopes)) {
            const expected = phraseSequence(field.text ?? '');
            if (field.phraseSequence !== expected)
              changed[name] = { phraseSequence: expected };
          }
          if (Object.keys(changed).length) doc[key] = changed;
        }
        if (Object.keys(doc).length) {
          bulk.push({ update: { _index: index, _id: hit._id } }, { doc });
          updated += 1;
        }
      }
      if (bulk.length) {
        const result = response<{
          errors?: boolean;
          items?: Array<Record<string, { error?: unknown; status?: number }>>;
        }>(
          await client.bulk(
            { body: bulk, refresh: false },
            { requestTimeout: 120000 },
          ),
        );
        const failures = (result.items ?? []).flatMap((item, position) =>
          Object.values(item)
            .filter((part) => part.error)
            .map((part) => ({
              id: String(
                (bulk[position * 2] as { update?: { _id?: string } })?.update
                  ?._id ?? 'unknown',
              ),
              status: part.status,
              error: part.error,
            })),
        );
        if (result.errors || failures.length) {
          bulkFailure = failures.slice(0, 5);
          throw new Error('SCOPE_BACKFILL_BULK_FAILED');
        }
      }
      batches += 1;
      if (scanned % 1000 < 50)
        console.log(`scope backfill scanned=${scanned} updated=${updated}`);
      page = response<ScrollBody>(
        await client.scroll(
          { scroll_id: scrollId!, scroll: '5m' },
          { requestTimeout: 120000 },
        ),
      );
      scrollId = page._scroll_id;
    }
    await client.indices.refresh({ index });
    const countAfter = response<{ count?: number }>(
      await client.count({ index }),
    );
    const aliasAfter = Object.keys(
      response<Record<string, unknown>>(
        await client.indices.getAlias({ name: 'galilei-search-active' }),
      ),
    ).join(',');
    const backlogAfter = await repository.outboxStatus();
    const report = {
      generatedAt: new Date().toISOString(),
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      index,
      schema: 3,
      scanned,
      updated,
      batches,
      countBefore: 69313,
      countAfter: countAfter.count,
      aliasBefore,
      aliasAfter,
      outbox: backlogAfter,
      elapsedMs: Date.now() - started,
      pass:
        scanned === 69313 &&
        countAfter.count === 69313 &&
        aliasAfter === v1 &&
        backlogAfter.pending === 0 &&
        backlogAfter.failed === 0,
    };
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (!report.pass) process.exitCode = 1;
  } catch (error) {
    writeFileSync(
      outputPath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          index,
          scanned,
          updated,
          batches,
          aliasBefore,
          pass: false,
          ...(bulkFailure.length ? { bulkFailure } : {}),
          errorCode:
            error instanceof Error ? error.message : 'SCOPE_BACKFILL_FAILED',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    throw error;
  } finally {
    if (scrollId)
      await client.clearScroll({ scroll_id: scrollId }).catch(() => undefined);
    await repository.close();
    await client.close();
  }
}
function response<T>(result: unknown): T {
  return ((result as { body?: T }).body ?? result) as T;
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'SCOPE_BACKFILL_FAILED',
  );
  process.exitCode = 1;
});

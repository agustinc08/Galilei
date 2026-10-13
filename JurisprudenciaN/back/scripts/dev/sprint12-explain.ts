import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { CorpusSearchSourceAdapter } from '../../src/corpus/corpus-search.adapter';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';

const root = resolve(process.cwd(), '..', '..');
type ExplainCase = { family: string; query: string; filters?: Record<string, string> };

async function main() {
  assertDevDatabase(process.env.DATABASE_URL);
  const phase = process.argv[2] === 'after' ? 'after' : 'before';
  const adapter = new CorpusSearchSourceAdapter();
  const pool = (adapter as unknown as { pool: { query: (...args: unknown[]) => Promise<unknown> } }).pool;
  const client = new Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 25_000 });
  const entries: Array<Record<string, unknown>> = [];
  try {
    await client.connect();
    const identity = await client.query<{ database: string; role: string; address: string; port: number }>(
      'SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port',
    );
    const db = identity.rows[0];
    if (db.database !== 'buscador_juridico_civil_dev' || db.role !== 'bjc_dev' || db.address?.split('/')[0] !== '127.0.0.1' || db.port !== 55432) {
      throw new Error(`SPRINT12_EXPLAIN_TARGET_REJECTED:${JSON.stringify(db)}`);
    }
    await client.query('SET statement_timeout = 25000');
    const collection = await client.query<{ id: string }>(`SELECT c."id" FROM "DigestoCollection" c JOIN "DigestoCollectionMembership" m ON m."collectionId" = c."id" JOIN "CorpusDocument" d ON d."id" = m."documentId" WHERE c."status" = 'ACTIVE' AND d."status" = 'INDEXED' AND d."visibility" = 'INTERNAL' ORDER BY c."name" LIMIT 1`);
    const topic = await client.query<{ id: string }>(`SELECT t."id" FROM "DigestoTopic" t JOIN "CorpusDocumentTopic" dt ON dt."topicId" = t."id" JOIN "CorpusDocument" d ON d."id" = dt."documentId" WHERE t."active" = true AND d."status" = 'INDEXED' AND d."visibility" = 'INTERNAL' ORDER BY t."name" LIMIT 1`);
    const tag = await client.query<{ id: string }>(`SELECT t."id" FROM "DigestoTag" t JOIN "CorpusDocumentTag" dt ON dt."tagId" = t."id" JOIN "CorpusDocument" d ON d."id" = dt."documentId" WHERE d."status" = 'INDEXED' AND d."visibility" = 'INTERNAL' ORDER BY t."name" LIMIT 1`);
    const cases: ExplainCase[] = [
      { family: 'TERM_COMMON', query: 'responsabilidad' },
      { family: 'PHRASE', query: '"responsabilidad civil"' },
      { family: 'NOT_WITH_POSITIVE', query: 'responsabilidad NOT mediacion' },
      { family: 'NOT_ONLY', query: 'NOT mediacion' },
      { family: 'ZERO_RESULT', query: 'zzqvnoresult2026sprint12' },
      ...(collection.rows[0] ? [{ family: 'COLLECTION_FILTER', query: 'responsabilidad', filters: { digestoCollectionId: collection.rows[0].id } }] : []),
      ...(topic.rows[0] ? [{ family: 'TOPIC_FILTER', query: 'responsabilidad', filters: { digestoTopicId: topic.rows[0].id } }] : []),
      ...(tag.rows[0] ? [{ family: 'TAG_FILTER', query: 'responsabilidad', filters: { digestoTagId: tag.rows[0].id } }] : []),
    ];
    pool.query = async (...args: unknown[]) => {
      const [sql, values] = args as [string, unknown[]?];
      if (typeof sql !== 'string') throw new Error('SPRINT12_EXPLAIN_UNEXPECTED_QUERY_SHAPE');
      captured.push({ sql, values: values ?? [] });
      return /SELECT\s+COUNT\(\*\)/iu.test(sql)
        ? { rows: [{ total: '0' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    };

    for (const sample of cases) {
      captured.length = 0;
      await adapter.search(parseSearchQuery(sample.query), {
        visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only', page: 1, pageSize: 10,
        filters: sample.filters,
      });
      entries.push({ ...(await explainCaptured(client, sample.family)), adapterStatus: 'SQL_CAPTURED_WITHOUT_RUNTIME_EXECUTION' });
      console.log(JSON.stringify({ family: sample.family, explained: captured.length }));
    }
    const result = {
      status: `SPRINT12_EXPLAIN_${phase.toUpperCase()}_COMPLETE`,
      generatedAt: new Date().toISOString(),
      environment: { endpoint: '127.0.0.1:55432', database: db.database, role: db.role },
      timeoutMs: 25000,
      queryTextPersisted: false,
      plans: entries,
    };
    const outputDir = resolve(root, '_recovery-work', 'sprint12', 'performance', phase);
    await mkdir(outputDir, { recursive: true });
    const outputPath = resolve(outputDir, 'explain-summary.json');
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ status: result.status, plans: entries.length, output: outputPath }, null, 2));
  } finally {
    await client.end().catch(() => undefined);
    await adapter.close();
  }
}

type CapturedQuery = { sql: string; values: unknown[] };
const captured: CapturedQuery[] = [];

async function explainCaptured(client: Client, family: string) {
  const statements = captured.map(({ sql, values }, index) => ({ sql, values, stage: index === 0 ? 'COUNT' : 'PAGE' }));
  const plans: Array<Record<string, unknown>> = [];
  for (const statement of statements) {
    try {
      const result = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) ${statement.sql}`,
        statement.values,
      );
      plans.push({ stage: statement.stage, status: 'PASS', plan: summarizePlan(result.rows[0]['QUERY PLAN'][0].Plan) });
    } catch (error) {
      plans.push({ stage: statement.stage, status: isTimeout(error) ? 'TIMEOUT_25S' : 'ERROR', code: (error as { code?: string }).code ?? 'unknown' });
    }
  }
  return { family, statements: plans };
}

function summarizePlan(root: Record<string, unknown>) {
  const nodes: Array<Record<string, unknown>> = [];
  const visit = (node: Record<string, unknown>) => {
    nodes.push(Object.fromEntries(Object.entries(node).filter(([key]) => [
      'Node Type', 'Join Type', 'Index Name', 'Relation Name', 'Actual Rows', 'Actual Loops',
      'Actual Total Time', 'Rows Removed by Filter', 'Shared Hit Blocks', 'Shared Read Blocks',
      'Temp Read Blocks', 'Temp Written Blocks', 'Planning Time', 'Execution Time',
    ].includes(key))));
    if (Array.isArray(node['Plans'])) for (const child of node['Plans']) visit(child as Record<string, unknown>);
  };
  visit(root);
  return { nodes };
}

function isTimeout(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '57014');
}

function assertDevDatabase(raw?: string) {
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
}

if (require.main === module) main().catch((error) => {
  const message = (error as Error)?.message ?? '';
  const safe = message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[database-url]')
    .replace(/responsabilidad|civil|mediacion|zzqvnoresult2026sprint12/giu, '[query]');
  console.error(message.startsWith('SPRINT12_EXPLAIN_TARGET') ? safe : `SPRINT12_EXPLAIN_FAILED:${safe.slice(0, 300)}`);
  process.exitCode = 1;
});

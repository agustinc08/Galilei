import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

const destination = resolve(process.cwd(), '..', '..', '_recovery-work', 'sprint121', 'performance');
const sql = `SELECT count(*)::int AS total
FROM "CorpusDocument" d
WHERE d."visibility" = ANY($1::text[])
  AND d."status" = 'INDEXED'
  AND d."searchText" ILIKE $2`;

type PlanNode = {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Actual Total Time'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: PlanNode[];
};

function summarize(node: PlanNode): Record<string, unknown> {
  return {
    node: node['Node Type'],
    relation: node['Relation Name'],
    index: node['Index Name'],
    rows: node['Actual Rows'],
    loops: node['Actual Loops'],
    totalMs: node['Actual Total Time'],
    sharedHits: node['Shared Hit Blocks'],
    sharedReads: node['Shared Read Blocks'],
    children: (node.Plans ?? []).map(summarize),
  };
}

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
  const client = new Client({ connectionString: raw });
  try {
    await client.connect();
    await client.query('ANALYZE "CorpusDocument"');
    await client.query(`SET statement_timeout = '60000ms'`);
    const countResult = await client.query<{ 'QUERY PLAN': Array<{ Plan: PlanNode; 'Planning Time': number; 'Execution Time': number }> }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
      [['PUBLIC', 'INTERNAL'], '%responsabilidad%'],
    );
    const pageSql = sql
      .replace('SELECT count(*)::int AS total', 'SELECT d."id", d."decisionDate", d."updatedAt"')
      + '\nORDER BY d."decisionDate" DESC NULLS LAST, d."updatedAt" DESC, d."id"\nLIMIT 10';
    const pageResult = await client.query<{ 'QUERY PLAN': Array<{ Plan: PlanNode; 'Planning Time': number; 'Execution Time': number }> }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${pageSql}`,
      [['PUBLIC', 'INTERNAL'], '%responsabilidad%'],
    );
    await client.query('SET enable_bitmapscan = off');
    const orderedIndexResult = await client.query<{ 'QUERY PLAN': Array<{ Plan: PlanNode; 'Planning Time': number; 'Execution Time': number }> }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${pageSql}`,
      [['PUBLIC', 'INTERNAL'], '%responsabilidad%'],
    );
    await client.query('RESET enable_bitmapscan');
    const countPlan = countResult.rows[0]['QUERY PLAN'][0];
    const pagePlan = pageResult.rows[0]['QUERY PLAN'][0];
    const orderedIndexPlan = orderedIndexResult.rows[0]['QUERY PLAN'][0];
    const report = {
      status: 'SPRINT121_CORPUS_EXPLAIN_PASS',
      generatedAt: new Date().toISOString(),
      target: { endpoint: '127.0.0.1:55432', database: 'buscador_juridico_civil_dev', role: 'bjc_dev' },
      queryTextPersisted: false,
      sqlPersisted: false,
      count: { planningMs: countPlan['Planning Time'], executionMs: countPlan['Execution Time'], plan: summarize(countPlan.Plan) },
      pageCandidates: { planningMs: pagePlan['Planning Time'], executionMs: pagePlan['Execution Time'], plan: summarize(pagePlan.Plan) },
      orderedIndexExperiment: { planningMs: orderedIndexPlan['Planning Time'], executionMs: orderedIndexPlan['Execution Time'], plan: summarize(orderedIndexPlan.Plan), sessionOnlyBitmapScanDisabled: true },
    };
    await mkdir(destination, { recursive: true });
    await writeFile(resolve(destination, 'explain-summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const reason = (error as Error)?.message ?? '';
  console.error(reason.startsWith('DEV_DATABASE_') ? reason : JSON.stringify({ status: 'SPRINT121_CORPUS_EXPLAIN_FAILED', message: (error as Error)?.message?.split('\n')[0] ?? 'query failed', code: (error as { code?: string })?.code ?? 'unknown', position: (error as { position?: string })?.position ?? null }));
  process.exitCode = 1;
});

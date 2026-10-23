import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const root = path.resolve(process.cwd(), '..', '..');

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
  const client = new Client({ connectionString: raw, connectionTimeoutMillis: 5000, statement_timeout: 6000 });
  try {
    await client.connect();
    const identity = await client.query(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port`);
    const targetRow = identity.rows[0];
    if (targetRow.database !== 'buscador_juridico_civil_dev' || targetRow.role !== 'bjc_dev' || !targetRow.address?.startsWith('127.0.0.1') || targetRow.port !== 55432) throw new Error('DEV_DATABASE_IDENTITY_REJECTED');
    const collection = await client.query<{ id: string }>(`SELECT id FROM "DigestoCollection" WHERE status = 'ACTIVE' ORDER BY name LIMIT 1`);
    const collectionId = collection.rows[0]?.id;
    const visibility = ['PUBLIC', 'INTERNAL'];
    const cases = [
      { name: 'zero-result', predicate: `d."searchText" ILIKE $2`, values: [visibility, '%zzqvnoresult2026sprint11%'] },
      { name: 'phrase', predicate: `d."searchText" ILIKE $2`, values: [visibility, '%responsabilidad civil%'] },
      { name: 'not', predicate: `d."searchText" ILIKE $2 AND NOT d."searchText" ILIKE $3`, values: [visibility, '%responsabilidad%', '%mediacion%'] },
      ...(collectionId ? [{ name: 'collection-filter', predicate: `d."searchText" ILIKE $2 AND EXISTS (SELECT 1 FROM "DigestoCollectionMembership" m WHERE m."documentId" = d."id" AND m."collectionId" = $3)`, values: [visibility, '%responsabilidad%', collectionId] }] : []),
    ];
    const results: Array<{ name: string; plan: Record<string, unknown> }> = [];
    for (const item of cases) {
      const plan = await client.query<{ 'QUERY PLAN': Array<{ Plan: Record<string, unknown> }> }>(
        `EXPLAIN (FORMAT JSON)
         SELECT d."id" FROM "CorpusDocument" d
         WHERE d."visibility" = ANY($1::text[]) AND d."status" = 'INDEXED' AND (${item.predicate})
         ORDER BY d."decisionDate" DESC NULLS LAST, d."updatedAt" DESC, d."id" LIMIT 10`,
        item.values,
      );
      results.push({ name: item.name, plan: summarizePlan(plan.rows[0]['QUERY PLAN'][0].Plan) });
    }
    const outputDir = path.resolve(root, '_recovery-work', 'sprint11', 'performance');
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'explain-summary.json');
    await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), target: { endpoint: '127.0.0.1:55432', database: targetRow.database, role: targetRow.role }, method: 'Read-only EXPLAIN plan estimates with fixed synthetic search strings; representative ANALYZE queries exceeded the 6-second safety timeout. No query text or document content stored.', cases: results }, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ status: 'SPRINT11_EXPLAIN_COMPLETE', caseCount: results.length, output: outputPath, plans: results }, null, 2));
  } finally {
    await client.end();
  }
}

function summarizePlan(plan: Record<string, unknown>): Record<string, unknown> {
  const nodes: Array<Record<string, unknown>> = [];
  const visit = (node: Record<string, unknown>) => {
    nodes.push(Object.fromEntries(['Node Type', 'Index Name', 'Plan Rows', 'Plan Width', 'Total Cost', 'Startup Cost'].filter((key) => node[key] !== undefined).map((key) => [key, node[key]])));
    for (const child of (node['Plans'] as Array<Record<string, unknown>> | undefined) ?? []) visit(child);
  };
  visit(plan);
  return { nodes };
}

if (require.main === module) main().catch((error) => {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined;
  console.error(error instanceof Error && /DEV_DATABASE/u.test(error.message) ? error.message : `SPRINT11_EXPLAIN_FAILED${code ? `; postgresCode=${code}` : ''}`);
  process.exitCode = 1;
});

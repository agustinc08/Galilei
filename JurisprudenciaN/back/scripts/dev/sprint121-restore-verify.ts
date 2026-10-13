import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

const tablesToCompare = [
  'CorpusDocument', 'CorpusDocumentFile', 'CorpusDocumentPage', 'CorpusExtraction',
  'CorpusDocumentClassification', 'DigestoCollection', 'DigestoCollectionMembership',
  'AuditLog', 'User', 'Usuario',
];

async function main() {
  const restoredUrl = process.env.DATABASE_URL;
  const mainUrl = process.env.BJC_SPRINT121_MAIN_DATABASE_URL;
  if (!restoredUrl || !mainUrl) throw new Error('TEMP_DATABASE_URL_MISSING');
  assertTarget(restoredUrl, 'buscador_juridico_civil_restore_test');
  assertTarget(mainUrl, 'buscador_juridico_civil_dev');
  const restored = new Client({ connectionString: restoredUrl });
  const source = new Client({ connectionString: mainUrl });
  try {
    await Promise.all([restored.connect(), source.connect()]);
    await Promise.all([restored.query(`SET statement_timeout='60000ms'`), source.query(`SET statement_timeout='60000ms'`)]);
    const [restoreIdentity, sourceIdentity] = await Promise.all([
      restored.query(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port`),
      source.query(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port`),
    ]);
    assertIdentity(restoreIdentity.rows[0], 'buscador_juridico_civil_restore_test');
    assertIdentity(sourceIdentity.rows[0], 'buscador_juridico_civil_dev');
    const [restoreTables, sourceTables] = await Promise.all([
      restored.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`),
      source.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`),
    ]);
    const restoreSet = new Set(restoreTables.rows.map((row) => row.tablename as string));
    const sourceSet = new Set(sourceTables.rows.map((row) => row.tablename as string));
    const available = tablesToCompare.filter((table) => restoreSet.has(table) && sourceSet.has(table));
    const counts: Record<string, { source: number; restored: number; equal: boolean }> = {};
    for (const table of available) {
      if (!/^[A-Za-z0-9_]+$/u.test(table)) throw new Error('RESTORE_TABLE_ALLOWLIST_REJECTED');
      const ident = `"${table}"`;
      const [sourceCount, restoreCount] = await Promise.all([
        source.query(`SELECT count(*)::bigint AS count FROM ${ident}`),
        restored.query(`SELECT count(*)::bigint AS count FROM ${ident}`),
      ]);
      const a = Number(sourceCount.rows[0].count);
      const b = Number(restoreCount.rows[0].count);
      counts[table] = { source: a, restored: b, equal: a === b };
    }
    const [sourceHashes, restoreHashes] = await Promise.all([
      source.query(`SELECT "id"::text AS id, "sha256" FROM "CorpusDocumentFile" WHERE "sha256" IS NOT NULL ORDER BY "id" LIMIT 20`),
      restored.query(`SELECT "id"::text AS id, "sha256" FROM "CorpusDocumentFile" WHERE "sha256" IS NOT NULL ORDER BY "id" LIMIT 20`),
    ]);
    const sampleHashesEqual = JSON.stringify(sourceHashes.rows) === JSON.stringify(restoreHashes.rows);
    const migrations = await restored.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied FROM "_prisma_migrations"`);
    const extension = await restored.query(`SELECT extversion FROM pg_extension WHERE extname='pg_trgm'`);
    await restored.query(`SET statement_timeout='60000ms'`);
    const smoke = await restored.query(`SELECT count(*)::int AS total FROM "CorpusDocument" WHERE "visibility" = ANY($1::text[]) AND "status"='INDEXED' AND "searchText" ILIKE $2`, [['PUBLIC', 'INTERNAL'], '%responsabilidad%']);
    const report = {
      status: 'SPRINT121_PLAIN_RESTORE_VERIFICATION_PASS',
      generatedAt: new Date().toISOString(),
      source: { database: 'buscador_juridico_civil_dev', endpoint: '127.0.0.1:55432', role: 'bjc_dev' },
      target: { database: 'buscador_juridico_civil_restore_test', endpoint: '127.0.0.1:55432', role: 'bjc_dev' },
      tableCounts: counts,
      allTableCountsEqual: Object.values(counts).every((value) => value.equal),
      deterministicFileHashSample: { rows: sourceHashes.rowCount, equal: sampleHashesEqual, rawHashesPersisted: false },
      migrationHistory: { total: migrations.rows[0].total, applied: migrations.rows[0].applied },
      pgTrgmVersion: extension.rows[0]?.extversion ?? null,
      searchSmoke: { returnedCandidates: smoke.rows[0].total, passed: Number(smoke.rows[0].total) > 0, queryTextPersisted: false },
      passwordPersisted: false,
    };
    if (!report.allTableCountsEqual || !sampleHashesEqual || report.migrationHistory.total !== 17 || report.migrationHistory.applied !== 17 || !report.pgTrgmVersion || !report.searchSmoke.passed) throw new Error('RESTORE_VERIFICATION_GATE_FAILED');
    const output = resolve(process.cwd(), '..', '..', '_recovery-work', 'sprint121', 'backups', 'restore-verification.json');
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.all([restored.end().catch(() => undefined), source.end().catch(() => undefined)]);
  }
}

function assertTarget(raw: string, database: string) {
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== `/${database}` || target.username !== 'bjc_dev') throw new Error('TEMP_DATABASE_TARGET_REJECTED');
}
function assertIdentity(row: { database: string; role: string; address: string; port: number }, database: string) {
  if (row.database !== database || row.role !== 'bjc_dev' || row.address !== '127.0.0.1/32' || Number(row.port) !== 55432) throw new Error('RESTORE_TARGET_IDENTITY_REJECTED');
}

main().catch((error) => {
  const message = (error as Error)?.message ?? '';
  console.error(message.startsWith('TEMP_DATABASE_') || message.startsWith('RESTORE_') ? message : 'SPRINT121_RESTORE_VERIFY_FAILED');
  process.exitCode = 1;
});

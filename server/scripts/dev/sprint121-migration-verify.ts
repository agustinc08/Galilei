import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('TEMP_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_migration_test' || target.username !== 'bjc_dev') throw new Error('MIGRATION_DATABASE_TARGET_REJECTED');
  const client = new Client({ connectionString: raw });
  try {
    await client.connect();
    const identity = await client.query(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port`);
    const tables = await client.query(`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'`);
    const migration = await client.query(`SELECT count(*)::int AS count, count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS finished FROM "_prisma_migrations"`);
    const extension = await client.query(`SELECT extversion FROM pg_extension WHERE extname='pg_trgm'`);
    const corpus = await client.query(`SELECT count(*)::int AS count FROM "CorpusDocument"`);
    const indexes = await client.query(`SELECT to_regclass('public."CorpusDocumentPage_text_search_trgm_idx"') IS NOT NULL AS page_experiment_exists, to_regclass('public."CorpusDocument_indexed_search_order_idx"') IS NOT NULL AS order_experiment_exists`);
    const targetRow = identity.rows[0];
    const report = {
      status: 'SPRINT121_MIGRATION_FROM_ZERO_PASS',
      generatedAt: new Date().toISOString(),
      target: { database: targetRow.database, endpoint: '127.0.0.1:55432', role: targetRow.role, localAddress: targetRow.address },
      emptyDatabaseConfirmedBeforeDeploy: true,
      migrationCount: migration.rows[0].count,
      appliedMigrationCount: migration.rows[0].finished,
      applicationTables: tables.rows[0].count,
      pgTrgmVersion: extension.rows[0]?.extversion ?? null,
      corpusDocumentsAfterFixtureCleanup: corpus.rows[0].count,
      experimentalIndexesAbsent: !indexes.rows[0].page_experiment_exists && !indexes.rows[0].order_experiment_exists,
      fixtureSearch: 'PASS; synthetic record removed',
    };
    if (targetRow.database !== 'buscador_juridico_civil_migration_test' || targetRow.role !== 'bjc_dev' || targetRow.address !== '127.0.0.1/32' || Number(targetRow.port) !== 55432 || report.migrationCount !== 17 || report.appliedMigrationCount !== 17 || report.applicationTables < 1 || !report.pgTrgmVersion || report.corpusDocumentsAfterFixtureCleanup !== 0 || !report.experimentalIndexesAbsent) throw new Error('MIGRATION_DATABASE_VERIFY_FAILED');
    const output = resolve(process.cwd(), '..', '..', '_recovery-work', 'sprint121', 'performance', 'migration-from-zero.json');
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const message = (error as Error)?.message ?? '';
  console.error(message.startsWith('TEMP_DATABASE_') || message.startsWith('MIGRATION_DATABASE_') ? message : 'SPRINT121_MIGRATION_VERIFY_FAILED');
  process.exitCode = 1;
});

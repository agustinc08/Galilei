import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { resolve } from 'node:path';

const approvedDatabases = [
  'buscador_juridico_civil_restore_test',
  'buscador_juridico_civil_migration_test',
] as const;

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('TEMP_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('CLEANUP_SOURCE_TARGET_REJECTED');

  const root = resolve(process.cwd(), '..');
  const [restore, migration] = await Promise.all([
    readFile(resolve(root, '_recovery-work/sprint121/backups/restore-verification.json'), 'utf8').then((value) => JSON.parse(value)),
    readFile(resolve(root, '_recovery-work/sprint121/performance/migration-from-zero.json'), 'utf8').then((value) => JSON.parse(value)),
  ]);
  if (restore.status !== 'SPRINT121_PLAIN_RESTORE_VERIFICATION_PASS' || restore.target?.database !== approvedDatabases[0] || restore.allTableCountsEqual !== true || restore.deterministicFileHashSample?.equal !== true || restore.searchSmoke?.passed !== true) throw new Error('CLEANUP_RESTORE_EVIDENCE_MISSING');
  if (migration.status !== 'SPRINT121_MIGRATION_FROM_ZERO_PASS' || migration.target?.database !== approvedDatabases[1] || migration.emptyDatabaseConfirmedBeforeDeploy !== true || migration.fixtureSearch !== 'PASS; synthetic record removed') throw new Error('CLEANUP_MIGRATION_EVIDENCE_MISSING');

  const client = new Client({ connectionString: raw });
  try {
    await client.connect();
    const identity = await client.query(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port`);
    const source = identity.rows[0];
    if (source.database !== 'buscador_juridico_civil_dev' || source.role !== 'bjc_dev' || source.address !== '127.0.0.1/32' || Number(source.port) !== 55432) throw new Error('CLEANUP_SOURCE_IDENTITY_REJECTED');

    const rows = await client.query(`SELECT d.datname, pg_get_userbyid(d.datdba) AS owner FROM pg_database d WHERE d.datname = ANY($1::text[]) ORDER BY d.datname`, [approvedDatabases]);
    if (rows.rowCount !== approvedDatabases.length || approvedDatabases.some((database) => !rows.rows.some((row) => row.datname === database && row.owner === 'bjc_dev'))) throw new Error('CLEANUP_DATABASE_ALLOWLIST_REJECTED');

    for (const database of approvedDatabases) {
      await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND usename = current_user AND pid <> pg_backend_pid()`, [database]);
      await client.query(`DROP DATABASE "${database}"`);
    }
    const remaining = await client.query(`SELECT datname FROM pg_database WHERE datname = ANY($1::text[])`, [approvedDatabases]);
    if (remaining.rowCount !== 0) throw new Error('CLEANUP_DATABASES_REMAIN');
    console.log(JSON.stringify({ status: 'SPRINT121_TEMP_DATABASE_CLEANUP_PASS', source: 'buscador_juridico_civil_dev@127.0.0.1:55432', dropped: approvedDatabases, restoreEvidenceVerified: true, migrationEvidenceVerified: true }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const message = (error as Error)?.message ?? '';
  console.error(message.startsWith('TEMP_DATABASE_') || message.startsWith('CLEANUP_') ? message : 'SPRINT121_TEMP_DATABASE_CLEANUP_FAILED');
  process.exitCode = 1;
});

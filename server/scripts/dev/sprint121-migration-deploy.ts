import { Client } from 'pg';
import { spawn } from 'node:child_process';

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
    const migrationTable = await client.query(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS exists`);
    const current = identity.rows[0];
    if (current.database !== 'buscador_juridico_civil_migration_test' || current.role !== 'bjc_dev' || current.address !== '127.0.0.1/32' || Number(current.port) !== 55432 || tables.rows[0].count !== 0 || migrationTable.rows[0].exists) throw new Error('MIGRATION_DATABASE_NOT_EMPTY');
    console.log(JSON.stringify({ status: 'SPRINT121_EMPTY_MIGRATION_DATABASE_CONFIRMED', database: current.database, role: current.role, endpoint: '127.0.0.1:55432', applicationTablesBefore: 0, migrationHistoryBefore: false }));
  } finally {
    await client.end();
  }
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd exec prisma migrate deploy'], { stdio: 'inherit', shell: false });
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (value, signal) => resolve(signal ? 1 : (value ?? 1)));
  });
  if (code !== 0) process.exitCode = code;
}

main().catch((error) => {
  const message = (error as Error)?.message ?? '';
  console.error(message.startsWith('TEMP_DATABASE_') || message.startsWith('MIGRATION_DATABASE_') ? message : 'SPRINT121_MIGRATION_DEPLOY_FAILED');
  process.exitCode = 1;
});

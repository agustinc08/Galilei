import { Pool } from 'pg';

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') {
    throw new Error('DEV_DATABASE_TARGET_REJECTED');
  }
  const pool = new Pool({ connectionString: raw, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const result = await pool.query<{ database: string; role: string; roleCanCreateDb: boolean; serverVersion: string; migrationCount: string }>(`
      SELECT current_database() AS database, current_user AS role,
             current_setting('server_version') AS "serverVersion",
             (SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user) AS "roleCanCreateDb",
             (SELECT count(*)::text FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS "migrationCount"
    `);
    const row = result.rows[0];
    if (row.database !== 'buscador_juridico_civil_dev' || row.role !== 'bjc_dev') throw new Error('DEV_DATABASE_IDENTITY_REJECTED');
    console.log(JSON.stringify({ status: 'DEV_DATABASE_AUDIT_COMPLETE', ...row }, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((error) => {
  console.error(error instanceof Error && /DEV_DATABASE/u.test(error.message) ? error.message : 'SPRINT11_DB_AUDIT_FAILED');
  process.exitCode = 1;
});

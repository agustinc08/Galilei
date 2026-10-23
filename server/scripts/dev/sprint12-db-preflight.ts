import { Client } from 'pg';

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
  const client = new Client({ connectionString: raw });
  try {
    await client.connect();
    const result = await client.query<{ database: string; role: string; address: string; port: number; canCreateDatabase: boolean }>(
      `SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port, r.rolcreatedb AS "canCreateDatabase" FROM pg_roles r WHERE r.rolname = current_user`,
    );
    const identity = result.rows[0];
    if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' || identity.address?.split('/')[0] !== '127.0.0.1' || identity.port !== 55432) throw new Error('DEV_DATABASE_IDENTITY_REJECTED');
    console.log(JSON.stringify({ status: 'SPRINT12_DB_PREFLIGHT_PASS', ...identity, isolatedDatabaseCreation: identity.canCreateDatabase ? 'AVAILABLE' : 'BLOCKED_BY_ROLE_PRIVILEGE' }, null, 2));
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (require.main === module) main().catch((error) => {
  const reason = (error as Error)?.message ?? '';
  console.error(reason.startsWith('DEV_DATABASE_') ? reason : 'SPRINT12_DB_PREFLIGHT_FAILED');
  process.exitCode = 1;
});

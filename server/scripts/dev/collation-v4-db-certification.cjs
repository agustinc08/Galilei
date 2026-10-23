const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_TABLES = [
  'CorpusDocument',
  'Sentencia',
  'SearchIndexOutbox',
  '_prisma_migrations',
];

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    application_name: 'bjc-collation-v4-db-certification-readonly',
  });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const identity = (
      await client.query(`
        SELECT current_database() AS database, current_user AS role,
               host(inet_server_addr()) AS address, inet_server_port() AS port,
               current_setting('server_version') AS "serverVersion"
      `)
    ).rows[0];
    const identityPass =
      identity.database === 'buscador_juridico_civil_dev' &&
      identity.role === 'bjc_dev' &&
      identity.address === '127.0.0.1' &&
      Number(identity.port) === 55432 &&
      Number(identity.serverVersion.split('.')[0]) === 16;
    if (!identityPass)
      throw new Error('PRINCIPAL_DEV_DATABASE_IDENTITY_REJECTED');

    const tableResult = await client.query(
      `SELECT name, to_regclass(format('%I.%I', 'public', name)) IS NOT NULL AS present
         FROM unnest($1::text[]) AS item(name)`,
      [EXPECTED_TABLES],
    );
    const tables = Object.fromEntries(
      tableResult.rows.map((row) => [row.name, row.present]),
    );
    if (Object.values(tables).some((present) => !present)) {
      throw new Error('PRINCIPAL_DEV_SCHEMA_INCOMPLETE');
    }

    const corpus = await client.query(
      'SELECT count(*)::text AS total FROM "CorpusDocument"',
    );
    const jurisprudence = await client.query(
      'SELECT count(*)::text AS total FROM "Sentencia"',
    );
    const outbox = await client.query(`
        SELECT count(*)::text AS total,
               count(*) FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NULL)::text AS pending,
               count(*) FILTER (WHERE "failedAt" IS NOT NULL)::text AS failed,
               max("id")::text AS "highWater"
          FROM "SearchIndexOutbox"
      `);
    const migrations = await client.query(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied,
               count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished,
               count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::int AS "rolledBack"
          FROM "_prisma_migrations"
      `);
    const result = {
      capturedAt: new Date().toISOString(),
      readOnly: true,
      identity: {
        ...identity,
        pass: identityPass,
      },
      expectedHostDataDirectory: 'C:/Program Files/PostgreSQL/16/data',
      hostDataDirectoryMustBeVerifiedFromWindowsService: true,
      expectedGalileiTables: tables,
      corpus: {
        CorpusDocument: Number(corpus.rows[0].total),
        Sentencia: Number(jurisprudence.rows[0].total),
      },
      outbox: {
        total: Number(outbox.rows[0].total),
        pending: Number(outbox.rows[0].pending),
        failed: Number(outbox.rows[0].failed),
        maxId: outbox.rows[0].highWater,
      },
      prismaMigrationHistory: migrations.rows[0],
      identityCertified: identityPass,
      schemaComplete: Object.values(tables).every(Boolean),
    };
    await client.query('COMMIT');
    const evidenceRoot = path.resolve(
      process.cwd(),
      '..',
      '_recovery-work',
      'jurisprudencia-collation-v4-finalize-dev1',
      '00-recovery',
    );
    fs.mkdirSync(evidenceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(evidenceRoot, 'principal-db-certification.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const errorCode =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'UNKNOWN';
  const safeMessage = String(error instanceof Error ? error.message : error)
    .replace(/postgres(?:ql)?:\/\/\S+/giu, '[redacted]')
    .replace(/[^A-Za-z0-9 _.:/-]/gu, '');
  console.error(
    error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : `PRINCIPAL_DEV_DATABASE_CERTIFICATION_FAILED:${errorCode}:${safeMessage}`,
  );
  process.exitCode = 1;
});

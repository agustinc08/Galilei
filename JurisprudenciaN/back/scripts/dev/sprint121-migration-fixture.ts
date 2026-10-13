import { Client } from 'pg';
import { CorpusSearchSourceAdapter } from '../../src/corpus/corpus-search.adapter';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';

const fixtureId = 'sprint121-migration-fixture';
const marker = 'zzsprint121migratefixture';

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('TEMP_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_migration_test' || target.username !== 'bjc_dev') throw new Error('MIGRATION_DATABASE_TARGET_REJECTED');
  const client = new Client({ connectionString: raw });
  const adapter = new CorpusSearchSourceAdapter(raw);
  try {
    await client.connect();
    const identity = await client.query(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port`);
    const row = identity.rows[0];
    if (row.database !== 'buscador_juridico_civil_migration_test' || row.role !== 'bjc_dev' || row.address !== '127.0.0.1/32' || Number(row.port) !== 55432) throw new Error('MIGRATION_DATABASE_TARGET_REJECTED');
    await client.query(`INSERT INTO "CorpusDocument" ("id", "title", "searchText", "visibility", "status", "createdAt", "updatedAt") VALUES ($1, $2, $3, 'INTERNAL', 'INDEXED', now(), now())`, [fixtureId, 'Synthetic migration fixture', marker]);
    const result = await adapter.search(parseSearchQuery(marker), {
      visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only',
      page: 1, pageSize: 10, sourceSystems: ['CORPUS'],
    });
    const matched = result.total === 1 && result.results.some((item) => item.sourceId === fixtureId);
    if (!matched) throw new Error('MIGRATION_FIXTURE_SEARCH_FAILED');
    console.log(JSON.stringify({ status: 'SPRINT121_MIGRATION_FIXTURE_SEARCH_PASS', database: row.database, total: result.total, matched: true, syntheticRecord: true, queryTextPersisted: false }));
  } finally {
    await client.query(`DELETE FROM "CorpusDocument" WHERE "id" = $1`, [fixtureId]).catch(() => undefined);
    await adapter.close();
    await client.end();
  }
}

main().catch((error) => {
  const message = (error as Error)?.message ?? '';
  console.error(message.startsWith('TEMP_DATABASE_') || message.startsWith('MIGRATION_DATABASE_') || message === 'MIGRATION_FIXTURE_SEARCH_FAILED' ? message : 'SPRINT121_MIGRATION_FIXTURE_FAILED');
  process.exitCode = 1;
});

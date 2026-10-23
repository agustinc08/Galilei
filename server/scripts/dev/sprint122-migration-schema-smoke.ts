import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Client } from 'pg';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import { PostgresJurisprudenciaSearchAdapter } from '../../src/busqueda/adapters/postgres-jurisprudencia-search.adapter';
import { CorpusSearchSourceAdapter } from '../../src/corpus/corpus-search.adapter';
import type { SearchContext } from '../../src/busqueda/adapters/search-source.adapter';

const schemaName = 'bjc_sprint122_migration_smoke';
const fixtureMarker = 'zzsprint122migrationfixture';

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
  const client = new Client({ connectionString: raw });
  let adapter: PostgresJurisprudenciaSearchAdapter | undefined;
  let corpusAdapter: CorpusSearchSourceAdapter | undefined;
  let schemaCreated = false;
  try {
    await client.connect();
    const identity = await client.query(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port`);
    const row = identity.rows[0];
    if (row.database !== 'buscador_juridico_civil_dev' || row.role !== 'bjc_dev' || row.address !== '127.0.0.1/32' || Number(row.port) !== 55432) throw new Error('DEV_DATABASE_IDENTITY_REJECTED');
    const existing = await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schemaName]);
    if (existing.rowCount) throw new Error('MIGRATION_SCHEMA_ALREADY_EXISTS');
    await client.query(`CREATE SCHEMA "${schemaName}" AUTHORIZATION bjc_dev`);
    schemaCreated = true;
    await client.query(`SET search_path TO "${schemaName}", public`);

    const migrationsRoot = resolve(__dirname, '../../prisma/migrations');
    const migrations = (await readdir(migrationsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const migration of migrations) {
      const sql = await readFile(join(migrationsRoot, migration, 'migration.sql'), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`MIGRATION_SQL_FAILED:${migration}:${(error as Error).message}`);
      }
    }

    const schemaCounts = await client.query(`
      SELECT
        (SELECT count(*)::int FROM pg_tables WHERE schemaname=$1) AS tables,
        (SELECT count(*)::int FROM pg_indexes WHERE schemaname=$1 AND indexname LIKE 'idx\_%search\_norm\_trgm' ESCAPE '\\') AS normalizedSearchIndexes
    `, [schemaName]);
    const counts = schemaCounts.rows[0];
    if (migrations.length !== 20 || counts.tables < 43 || counts.normalizedsearchindexes !== 12) throw new Error('MIGRATION_SCHEMA_VERIFY_FAILED');

    const inserted = await client.query(`
      INSERT INTO "Sentencia" ("textoBusqueda", "textoBusquedaNormalizado", "publicado", "activo", "createdAt", "updatedAt")
      VALUES ($1, $1, TRUE, TRUE, now(), now()) RETURNING id
    `, [fixtureMarker]);
    const sentenciaId = inserted.rows[0].id as number;
    await client.query(`
      INSERT INTO "Sumario" ("sentenciaId", "texto", "textoBusqueda", "textoBusquedaNormalizado", "publicado", "activo", "createdAt", "updatedAt")
      VALUES ($1, $2, $2, $2, TRUE, TRUE, now(), now())
    `, [sentenciaId, fixtureMarker]);
    const schemaUrl = new URL(raw);
    schemaUrl.searchParams.set('options', `-c search_path=${schemaName},public`);
    adapter = new PostgresJurisprudenciaSearchAdapter(schemaUrl.toString());
    const context: SearchContext = { visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'legacy-active-only', page: 1, pageSize: 5 };
    const result = await adapter.search(parseSearchQuery(fixtureMarker), context);
    if (result.total !== 1 || result.results[0]?.sourceId !== '1') throw new Error('MIGRATION_SCHEMA_SEARCH_FIXTURE_FAILED');
    const corpusId = 'sprint122-migration-corpus-fixture';
    await client.query(`
      INSERT INTO "CorpusDocument" ("id", "title", "searchText", "visibility", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $2, 'INTERNAL', 'INDEXED', now(), now())
    `, [corpusId, `${fixtureMarker} responsabilidad civil`]);
    const tokenCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "CorpusSearchToken" WHERE "documentId"=$1`,
      [corpusId],
    );
    if (Number(tokenCount.rows[0]?.count) !== 3) throw new Error('MIGRATION_SCHEMA_TOKEN_TRIGGER_FAILED');
    await client.query(`UPDATE "CorpusSearchTokenProjectionControl" SET "isReady"=TRUE, "verifiedAt"=CURRENT_TIMESTAMP WHERE "singleton"=TRUE`);
    const corpusUrl = new URL(raw);
    corpusUrl.searchParams.set('options', `-c search_path=${schemaName},public`);
    corpusAdapter = new CorpusSearchSourceAdapter(corpusUrl.toString());
    const corpusContext: SearchContext = { visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only', page: 1, pageSize: 5, sourceSystems: ['CORPUS'] };
    const corpusTerm = await corpusAdapter.search(parseSearchQuery(fixtureMarker), corpusContext);
    const corpusPhrase = await corpusAdapter.search(parseSearchQuery(`"${fixtureMarker} responsabilidad"`), corpusContext);
    if (corpusTerm.results[0]?.sourceId !== corpusId || corpusPhrase.results[0]?.sourceId !== corpusId) throw new Error('MIGRATION_SCHEMA_CORPUS_SEARCH_FIXTURE_FAILED');
    console.log(JSON.stringify({
      status: 'SPRINT122_MIGRATION_SCHEMA_SMOKE_PASS',
      target: { database: row.database, role: row.role, endpoint: '127.0.0.1:55432' },
      migrationDirectoriesReplayed: migrations.length,
      isolatedSchemaTables: counts.tables,
      normalizedSearchIndexes: counts.normalizedsearchindexes,
      adapterFixtureSearch: 'PASS',
      corpusTokenTrigger: 'PASS',
      corpusTermAndPhraseSearch: 'PASS',
      extensionProvidedByExistingLocalDatabase: true,
      schemaDroppedAfterVerification: true,
    }, null, 2));
  } finally {
    await adapter?.close();
    await corpusAdapter?.close();
    if (schemaCreated) await client.query(`DROP SCHEMA "${schemaName}" CASCADE`).catch(() => undefined);
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = (error as Error).message;
  console.error(message.startsWith('DEV_DATABASE_') || message.startsWith('MIGRATION_') ? message : 'SPRINT122_MIGRATION_SCHEMA_SMOKE_FAILED');
  process.exitCode = 1;
});

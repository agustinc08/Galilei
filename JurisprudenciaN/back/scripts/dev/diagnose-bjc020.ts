import { createHash } from 'node:crypto';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { Client } from 'pg';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import { LegacySqliteSearchAdapter } from '../../src/busqueda/adapters/legacy-sqlite-search.adapter';
import { PostgresJurisprudenciaSearchAdapter } from '../../src/busqueda/adapters/postgres-jurisprudencia-search.adapter';
import type { SearchContext } from '../../src/busqueda/adapters/search-source.adapter';

async function main() {
  const sourcePath = process.env.SEARCH_SPIKE_SQLITE_PATH;
  if (!sourcePath || !process.env.DATABASE_URL) throw new Error('Run through the DEV database guard.');
  const context: SearchContext = { visibility: 'INTERNAL', dialect: 'legacy-reference', publicationPolicy: 'legacy-active-only', page: 1, pageSize: 300 };
  const pgAdapter = new PostgresJurisprudenciaSearchAdapter(process.env.DATABASE_URL);
  const sqliteAdapter = new LegacySqliteSearchAdapter(sourcePath);
  const sqlite = await open({ filename: `file:${sourcePath.replace(/\\/gu, '/')}?mode=ro&immutable=1`, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY | sqlite3.OPEN_URI });
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await sqlite.get('PRAGMA query_only=ON');
    await pg.connect();
    const query = parseSearchQuery('de');
    const [pgIds, sqliteIds] = await Promise.all([pgAdapter.searchIds(query, context), sqliteAdapter.searchIds(query, context)]);
    const legacySet = new Set(sqliteIds);
    const pgOnly = pgIds.filter((id) => !legacySet.has(id)).map(Number);
    const placeholders = pgOnly.map((_, index) => `?${index + 2}`).join(',');
    const pattern = '% de %';
    const sourceRows = pgOnly.length ? await sqlite.all<any[]>(
      `SELECT s.id_sumario, s.resumen, s.activo, t.activo AS sentencia_activo,
              s.resumen LIKE ?1 AS raw_match, lower(s.resumen) LIKE ?1 AS lower_match
         FROM tb_sumarios s JOIN tb_sentencias t ON t.id_sentencia=s.id_sentencia
        WHERE s.id_sumario IN (${placeholders})`,
      [pattern, ...pgOnly],
    ) : [];
    const importedRows = pgOnly.length ? (await pg.query<{ id: number; resumenBusqueda: string | null; activo: boolean }>(
      'SELECT "id" AS id, "resumenBusqueda", "activo" FROM "Sumario" WHERE "id"=ANY($1::int[])', [pgOnly],
    )).rows : [];
    let exactContent = 0;
    const sourceById = new Map(sourceRows.map((row) => [row.id_sumario, row]));
    for (const row of importedRows) {
      if (row.resumenBusqueda === sourceById.get(row.id)?.resumen) exactContent += 1;
    }
    const sample = importedRows[0];
    const sampleSource = sample ? sourceById.get(sample.id)?.resumen : null;
    const hash = (value: unknown) => createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 12);
    console.log(JSON.stringify({
      pgOnlyCount: pgOnly.length,
      sourceCount: sourceRows.length,
      sourceRawLikeMatches: sourceRows.filter((row) => row.raw_match).length,
      sourceLowerLikeMatches: sourceRows.filter((row) => row.lower_match).length,
      sourceActiveFlagsNotOne: sourceRows.filter((row) => row.activo !== 1 || row.sentencia_activo !== 1).length,
      importedSummaryExactMatches: exactContent,
      sourceIdsMatchImportedIds: importedRows.filter((row) => sourceById.has(row.id)).length,
      sampleId: sample?.id,
      sampleSourceLength: sampleSource?.length ?? null,
      sampleImportedLength: sample?.resumenBusqueda?.length ?? null,
      sampleSourceHash: hash(sampleSource),
      sampleImportedHash: hash(sample?.resumenBusqueda),
      jsCaseSensitiveMatches: sourceRows.filter((row) => String(row.resumen ?? '').includes(' de ')).length,
      jsLowerMatches: sourceRows.filter((row) => String(row.resumen ?? '').toLowerCase().includes(' de ')).length,
    }));
  } finally {
    await pg.end().catch(() => undefined);
    await sqlite.close();
    await pgAdapter.close();
  }
}
main().catch((error) => { console.error(`DIAGNOSE=FAIL; ${error.message}`); process.exitCode = 1; });

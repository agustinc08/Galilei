import 'dotenv/config';

import { access } from 'fs/promises';
import { SqliteReaderService } from '../src/importacion/services/sqlite-reader.service';
import { ImportLogger } from '../src/importacion/utils/import-logger';

async function main() {
  const sqlitePath = process.env.SQLITE_SOURCE_PATH?.trim();

  if (!sqlitePath) {
    throw new Error('SQLITE_SOURCE_PATH no esta configurada');
  }

  await access(sqlitePath);

  const logger = new ImportLogger({
    dryRun: true,
    only: 'all',
    sqlitePath,
    pdfBasePath: process.env.SQLITE_PDF_BASE_PATH?.trim() || undefined,
    batchSize: Number(process.env.IMPORT_BATCH_SIZE ?? 100),
    logPrefix: 'import-sqlite',
  });

  const reader = await SqliteReaderService.create(sqlitePath, logger);

  try {
    const tables = await reader.listTables();
    const sentenciasTable = await reader.resolveTableName([
      'tb_sentencias',
      'sentencias',
    ]);
    const sumariosTable = await reader.resolveTableName(['tb_sumarios', 'sumarios']);

    console.log('\n=== SQLite inspect ===');
    console.log(`Archivo: ${sqlitePath}`);
    console.log(`Tablas encontradas (${tables.length}): ${tables.join(', ')}`);

    if (sentenciasTable) {
      const columns = await reader.getColumns(sentenciasTable);
      const total = await reader.countRows(sentenciasTable);
      const sample = await reader.sampleRows(sentenciasTable, 5);
      console.log(`\n[${sentenciasTable}] columnas: ${columns.join(', ')}`);
      console.log(`[${sentenciasTable}] cantidad: ${total}`);
      console.log(`[${sentenciasTable}] ejemplos (5):`);
      console.log(JSON.stringify(sample, null, 2));

      await logDistinct(reader, sentenciasTable, ['sala'], 'salas');
      await logDistinct(reader, sentenciasTable, ['tipo_fallo', 'tipofallo'], 'tipos de fallo');
      await logDistinct(
        reader,
        sentenciasTable,
        ['tribunal_origen', 'tribunalorigen'],
        'tribunales de origen',
      );
    } else {
      console.log('\nNo se encontro tabla de sentencias');
    }

    if (sumariosTable) {
      const columns = await reader.getColumns(sumariosTable);
      const total = await reader.countRows(sumariosTable);
      const sample = await reader.sampleRows(sumariosTable, 5);
      console.log(`\n[${sumariosTable}] columnas: ${columns.join(', ')}`);
      console.log(`[${sumariosTable}] cantidad: ${total}`);
      console.log(`[${sumariosTable}] ejemplos (5):`);
      console.log(JSON.stringify(sample, null, 2));
    } else {
      console.log('\nNo se encontro tabla de sumarios');
    }
  } finally {
    await reader.close();
    await logger.close();
  }
}

async function logDistinct(
  reader: SqliteReaderService,
  tableName: string,
  columnCandidates: string[],
  label: string,
) {
  const column = await reader.hasColumn(tableName, columnCandidates);
  if (!column) {
    console.log(`[${tableName}] ${label}: columna no encontrada`);
    return;
  }

  const values = await reader.getDistinctValues(tableName, column, 30);
  console.log(`\n[${tableName}] ${label} (${values.length} top):`);
  console.log(
    JSON.stringify(
      values.map((item) => ({ value: item.value, total: Number(item.total) })),
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

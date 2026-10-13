import 'dotenv/config';

import { access, writeFile } from 'fs/promises';
import { createImportStats, type ImportOnly } from '../src/importacion/types/importacion-options.type';
import { ImportadorPdfService } from '../src/importacion/services/importador-pdf.service';
import { ImportadorSqliteService } from '../src/importacion/services/importador-sqlite.service';
import { SqliteReaderService } from '../src/importacion/services/sqlite-reader.service';
import type { ImportOptions } from '../src/importacion/types/importacion-options.type';
import { ImportLogger } from '../src/importacion/utils/import-logger';
import { createPrismaClient } from '../src/importacion/utils/prisma-client';

async function main() {
  const options = resolveOptions(process.argv.slice(2));
  const logger = new ImportLogger(options);
  const prisma = createPrismaClient();

  try {
    await access(options.sqlitePath);

    const reader = await SqliteReaderService.create(options.sqlitePath, logger);
    const sqliteImportador = new ImportadorSqliteService(
      prisma,
      reader,
      logger,
      options,
    );
    const pdfImportador = new ImportadorPdfService(
      prisma,
      reader,
      logger,
      options,
    );
    const stats = createImportStats();

    if (options.only === 'all' || options.only === 'sentencias') {
      await sqliteImportador.importSentencias(stats);
    }

    if (options.only === 'all' || options.only === 'sumarios') {
      await sqliteImportador.importSumarios(stats);
    }

    if (options.only === 'all' || options.only === 'pdfs') {
      await pdfImportador.importPdfs(stats);
    }

    logger.summary(stats);
    await writeFile(
      logger.summaryFilePath,
      JSON.stringify(logger.summaryPayload(stats), null, 2),
      'utf8',
    );
    await reader.close();
    await logger.close();
  } finally {
    await prisma.$disconnect();
  }
}

function resolveOptions(args: string[]): ImportOptions {
  const onlyArg = args.find((arg) => arg.startsWith('--only='));
  const only = (onlyArg?.split('=')[1] ?? 'all') as ImportOnly;
  const dryRun = args.includes('--dry-run');
  const sqlitePath = process.env.SQLITE_SOURCE_PATH?.trim();
  const batchSize = Number(process.env.IMPORT_BATCH_SIZE ?? '100');

  if (!sqlitePath) {
    throw new Error('SQLITE_SOURCE_PATH no esta configurada en .env');
  }

  if (!['all', 'sentencias', 'sumarios', 'pdfs'].includes(only)) {
    throw new Error(`Valor de --only invalido: ${only}`);
  }

  return {
    dryRun,
    only,
    sqlitePath,
    pdfBasePath: process.env.SQLITE_PDF_BASE_PATH?.trim() || undefined,
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 100,
    logPrefix: only === 'pdfs' ? 'import-pdfs' : 'import-sqlite',
  };
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

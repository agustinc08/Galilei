import 'dotenv/config';

import { access } from 'fs/promises';
import { PdfMatcherService } from '../src/importacion/services/pdf-matcher.service';
import { SqliteReaderService } from '../src/importacion/services/sqlite-reader.service';
import { mapLegacySentencia } from '../src/importacion/utils/mapeadores';
import { ImportLogger } from '../src/importacion/utils/import-logger';

async function main() {
  const sqlitePath = process.env.SQLITE_SOURCE_PATH?.trim();
  const pdfBasePath = process.env.SQLITE_PDF_BASE_PATH?.trim();

  if (!sqlitePath) {
    throw new Error('SQLITE_SOURCE_PATH no esta configurada');
  }

  if (!pdfBasePath) {
    throw new Error('SQLITE_PDF_BASE_PATH no esta configurada');
  }

  await access(sqlitePath);
  await access(pdfBasePath);

  const logger = new ImportLogger({
    dryRun: true,
    only: 'pdfs',
    sqlitePath,
    pdfBasePath,
    batchSize: Number(process.env.IMPORT_BATCH_SIZE ?? 100),
    logPrefix: 'import-pdfs',
  });

  const reader = await SqliteReaderService.create(sqlitePath, logger);
  const matcher = await PdfMatcherService.create(pdfBasePath);

  try {
    const summary = matcher.inspect(15);
    const sentenciasTable = await reader.resolveTableName([
      'tb_sentencias',
      'sentencias',
    ]);

    console.log('\n=== PDFs inspect ===');
    console.log(`Base PDFs: ${pdfBasePath}`);
    console.log(`Cantidad total de PDFs: ${summary.totalPdfs}`);
    console.log(`Top carpetas: ${JSON.stringify(summary.topLevelDirectories, null, 2)}`);
    console.log(`Ejemplos de rutas: ${JSON.stringify(summary.samplePaths, null, 2)}`);
    console.log(
      `Nombres de archivo mas comunes: ${JSON.stringify(summary.commonFilenames, null, 2)}`,
    );
    console.log(
      `Patrones detectados: ${JSON.stringify(summary.detectedPatterns, null, 2)}`,
    );

    if (!sentenciasTable) {
      console.log('\nNo se encontro tabla de sentencias para probar matching');
      return;
    }

    let matched = 0;
    let unmatched = 0;
    const estrategias = new Map<string, number>();
    const matchedFiles = new Set<string>();
    const matchedExamples: Array<Record<string, unknown>> = [];
    const unmatchedExamples: Array<Record<string, unknown>> = [];

    for await (const rows of reader.iterateTable(sentenciasTable, 200, [
      'codigo',
      'id',
      'id_sentencia',
    ])) {
      for (const row of rows) {
        const mapped = mapLegacySentencia(row);
        const match = matcher.match({
          explicitPdfPath: mapped.explicitPdfPath,
          legacyLink: mapped.legacyLink,
          legacyId: mapped.legacyId,
          numeroSentencia: mapped.numeroSentencia,
          expediente: mapped.expedienteNormalizado,
        });

        if (match) {
          matched += 1;
          matchedFiles.add(match.file.relativePath);
          estrategias.set(
            match.strategy,
            (estrategias.get(match.strategy) ?? 0) + 1,
          );

          if (matchedExamples.length < 15) {
            matchedExamples.push({
              legacyId: mapped.legacyId,
              numeroSentencia: mapped.numeroSentencia,
              expediente: mapped.expedienteNormalizado,
              file: match.file.relativePath,
              strategy: match.strategy,
              candidatesCount: match.candidatesCount,
            });
          }
        } else {
          unmatched += 1;
          if (unmatchedExamples.length < 15) {
            unmatchedExamples.push({
              legacyId: mapped.legacyId,
              numeroSentencia: mapped.numeroSentencia,
              expediente: mapped.expedienteNormalizado,
              legacyLink: mapped.legacyLink,
              explicitPdfPath: mapped.explicitPdfPath,
            });
          }
        }
      }
    }

    const orphanCount = Math.max(0, summary.totalPdfs - matchedFiles.size);

    console.log(`\nMatching posible sobre sentencias legacy:`);
    console.log(`- sentencias con PDF encontrado: ${matched}`);
    console.log(`- sentencias con PDF no encontrado: ${unmatched}`);
    console.log(`- PDFs encontrados sin sentencia asociada (estimado): ${orphanCount}`);
    console.log(
      `- estrategias usadas: ${JSON.stringify(
        [...estrategias.entries()]
          .map(([strategy, total]) => ({ strategy, total }))
          .sort((a, b) => b.total - a.total || a.strategy.localeCompare(b.strategy)),
        null,
        2,
      )}`,
    );
    console.log(`\nEjemplos de matches: ${JSON.stringify(matchedExamples, null, 2)}`);
    console.log(
      `\nEjemplos sin match: ${JSON.stringify(unmatchedExamples, null, 2)}`,
    );
  } finally {
    await reader.close();
    await logger.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import 'dotenv/config';

import { archivoPdfEsReal } from '../src/archivos/pdf-real.util';
import { createPrismaClient } from '../src/importacion/utils/prisma-client';
import { ImportLogger } from '../src/importacion/utils/import-logger';

async function main() {
  const prisma = createPrismaClient();
  const logger = new ImportLogger({
    dryRun: true,
    only: 'all',
    sqlitePath: process.env.SQLITE_SOURCE_PATH?.trim() || '',
    pdfBasePath: process.env.SQLITE_PDF_BASE_PATH?.trim() || undefined,
    batchSize: Number(process.env.IMPORT_BATCH_SIZE ?? 100),
    logPrefix: 'import-validate',
  });

  try {
    const [
      totalSentenciasLegacy,
      totalSumariosLegacy,
      totalPdfsLegacy,
      sentenciasSinSumarios,
      sentenciasLegacyConPdfs,
      pdfs,
    ] = await Promise.all([
      prisma.sentencia.count({ where: { legacyId: { not: null } } }),
      prisma.sumario.count({ where: { legacyId: { not: null } } }),
      prisma.archivoPdf.count({ where: { OR: [{ legacyId: { not: null } }, { legacyPath: { not: null } }] } }),
      prisma.sentencia.count({
        where: {
          legacyId: { not: null },
          sumarios: { none: {} },
        },
      }),
      prisma.sentencia.findMany({
        where: {
          legacyId: { not: null },
        },
        select: {
          id: true,
          tienePdf: true,
          archivosPdf: { select: { id: true, rutaArchivo: true } },
        },
      }),
      prisma.archivoPdf.findMany({
        select: {
          id: true,
          rutaArchivo: true,
          nombreOriginal: true,
          sentenciaId: true,
        },
      }),
    ]);

    let sentenciasConPdfInconsistente = 0;
    for (const sentencia of sentenciasLegacyConPdfs) {
      const tienePdfReal = sentencia.archivosPdf.some((archivo) => archivoPdfEsReal(archivo));
      if (sentencia.tienePdf && !tienePdfReal) {
        sentenciasConPdfInconsistente += 1;
      }
    }

    let missingFiles = 0;
    for (const pdf of pdfs) {
      if (!archivoPdfEsReal(pdf)) {
        missingFiles += 1;
        logger.warn(
          `ArchivoPdf id=${pdf.id} sentenciaId=${pdf.sentenciaId} sin archivo fisico: ${pdf.rutaArchivo}`,
        );
      }
    }

    console.log('\n=== Validacion post import ===');
    console.log(`- total sentencias con legacyId: ${totalSentenciasLegacy}`);
    console.log(`- total sumarios con legacyId: ${totalSumariosLegacy}`);
    console.log(`- total PDFs importados: ${totalPdfsLegacy}`);
    console.log(`- sentencias sin sumarios: ${sentenciasSinSumarios}`);
    console.log(`- sumarios sin sentencia: 0 (relacion obligatoria en Prisma)`);
    console.log(
      `- sentencias con tienePdf=true pero sin PDF real: ${sentenciasConPdfInconsistente}`,
    );
    console.log(`- ArchivoPdf con archivo fisico faltante: ${missingFiles}`);
  } finally {
    await logger.close();
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

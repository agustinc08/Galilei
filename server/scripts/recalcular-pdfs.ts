import 'dotenv/config';

import { createPrismaClient } from '../src/importacion/utils/prisma-client';
import { archivoPdfEsReal } from '../src/archivos/pdf-real.util';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 200;

async function main() {
  const prisma = createPrismaClient();
  let cursor: number | undefined;
  let revisadas = 0;
  let actualizadas = 0;
  let pdfsValidos = 0;
  let pdfsInvalidos = 0;
  let tienePdfTrueSinPdf = 0;
  let tienePdfFalseConPdf = 0;
  const ejemplosInvalidos: Array<{ sentenciaId: number; archivoPdfId: number; rutaArchivo: string }> = [];
  const ejemplosFlagTrueSinPdf: number[] = [];
  const ejemplosFlagFalseConPdf: number[] = [];

  try {
    while (true) {
      const sentencias = await prisma.sentencia.findMany({
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: {
          id: true,
          tienePdf: true,
          archivosPdf: {
            select: { id: true, rutaArchivo: true },
          },
          _count: {
            select: { archivosPdf: true },
          },
        },
      });

      if (!sentencias.length) {
        break;
      }

      for (const sentencia of sentencias) {
        revisadas += 1;
        const validos = sentencia.archivosPdf.filter((archivo) => archivoPdfEsReal(archivo)).length;
        const invalidos = sentencia._count.archivosPdf - validos;
        const tienePdfReal = validos > 0;
        pdfsValidos += validos;
        pdfsInvalidos += invalidos;

        if (sentencia.tienePdf && !tienePdfReal) {
          tienePdfTrueSinPdf += 1;
          if (ejemplosFlagTrueSinPdf.length < 10) {
            ejemplosFlagTrueSinPdf.push(sentencia.id);
          }
        }

        if (!sentencia.tienePdf && tienePdfReal) {
          tienePdfFalseConPdf += 1;
          if (ejemplosFlagFalseConPdf.length < 10) {
            ejemplosFlagFalseConPdf.push(sentencia.id);
          }
        }

        for (const archivo of sentencia.archivosPdf) {
          if (!archivoPdfEsReal(archivo)) {
            if (ejemplosInvalidos.length < 10) {
              ejemplosInvalidos.push({
                sentenciaId: sentencia.id,
                archivoPdfId: archivo.id,
                rutaArchivo: archivo.rutaArchivo,
              });
            }
          }
        }

        if (sentencia.tienePdf !== tienePdfReal) {
          actualizadas += 1;
          if (!DRY_RUN) {
            await prisma.sentencia.update({
              where: { id: sentencia.id },
              data: { tienePdf: tienePdfReal },
            });
          }
        }
      }

      cursor = sentencias[sentencias.length - 1]?.id;
    }

    console.log(
      `${DRY_RUN ? '[dry-run] ' : ''}Sentencias revisadas: ${revisadas}. ` +
        `tienePdf a corregir: ${actualizadas}. ` +
        `PDFs validos: ${pdfsValidos}. PDFs invalidos: ${pdfsInvalidos}. ` +
        `tienePdf=true sin PDF real: ${tienePdfTrueSinPdf}. ` +
        `tienePdf=false con PDF real: ${tienePdfFalseConPdf}.`,
    );

    if (ejemplosFlagTrueSinPdf.length) {
      console.log(`Ejemplos tienePdf=true sin PDF real: ${ejemplosFlagTrueSinPdf.join(', ')}`);
    }
    if (ejemplosFlagFalseConPdf.length) {
      console.log(`Ejemplos tienePdf=false con PDF real: ${ejemplosFlagFalseConPdf.join(', ')}`);
    }
    if (ejemplosInvalidos.length) {
      console.log(`Ejemplos ArchivoPdf con archivo fisico faltante: ${JSON.stringify(ejemplosInvalidos)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

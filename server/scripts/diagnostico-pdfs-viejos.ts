import 'dotenv/config';

import { existsSync, statSync } from 'fs';
import { mkdir, readdir, writeFile } from 'fs/promises';
import { basename, extname, join, relative, resolve } from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { createPrismaClient } from '../src/importacion/utils/prisma-client';

type LegacySentencia = {
  id_sentencia: number;
  codigo_sentencia: string | null;
  fallo_completo: number | string | null;
  link: string | null;
};

type LegacySumario = {
  id_sumario: number | null;
  id_sentencia: number | null;
  numero_sumario: string | null;
};

type PdfEntry = {
  fullPath: string;
  relativePath: string;
  directory: string;
  filename: string;
  size: number;
};

type DiagnosticoRow = {
  idSentenciaLegacy: string;
  codigoSentencia: string;
  falloCompleto: string;
  idSumarioLegacy: string;
  numeroSumario: string;
  carpetaPdfCandidata: string;
  archivoPdfCandidato: string;
  estrategia: string;
  existeArchivo: string;
  confianza: string;
  observacion: string;
  sentenciaIdActual: string;
  pdfActualId: string;
  pdfActualLegacyPath: string;
  pdfActualRutaArchivo: string;
  pdfActualExiste: string;
};

const outputDir = resolve(process.cwd(), 'logs', 'importacion');
const jsonPath = join(outputDir, 'diagnostico-pdfs-viejos.json');
const csvPath = join(outputDir, 'diagnostico-pdfs-viejos.csv');

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} no esta configurada`);
  }
  return value;
}

function normalizePathKey(value: string) {
  return value.replace(/\\/g, '/').toLowerCase();
}

function legacyPdfRelativePath(idSentencia: number) {
  const carpeta = idSentencia > 99 ? String(idSentencia).slice(0, -2) : '0';
  const archivo = `${idSentencia}.pdf`;
  return {
    carpeta,
    archivo,
    relativePath: `${carpeta}/${archivo}`,
  };
}

async function walkPdfs(basePath: string) {
  const files: PdfEntry[] = [];

  async function walk(currentPath: string) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.pdf') {
        continue;
      }
      const relativePath = relative(basePath, fullPath).replace(/\\/g, '/');
      const [directory = '.'] = relativePath.split('/');
      files.push({
        fullPath,
        relativePath,
        directory,
        filename: entry.name,
        size: statSync(fullPath).size,
      });
    }
  }

  await walk(basePath);
  return files;
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  if (/[",\r\n;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows: DiagnosticoRow[]) {
  const columns = [
    'idSentenciaLegacy',
    'codigoSentencia',
    'falloCompleto',
    'idSumarioLegacy',
    'numeroSumario',
    'carpetaPdfCandidata',
    'archivoPdfCandidato',
    'estrategia',
    'existeArchivo',
    'confianza',
    'observacion',
    'sentenciaIdActual',
    'pdfActualId',
    'pdfActualLegacyPath',
    'pdfActualRutaArchivo',
    'pdfActualExiste',
  ] as const;

  return [
    columns.join(';'),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(';')),
  ].join('\n');
}

async function main() {
  const sqlitePath = resolve(process.cwd(), requiredEnv('SQLITE_SOURCE_PATH'));
  const pdfBasePath = resolve(process.cwd(), requiredEnv('SQLITE_PDF_BASE_PATH'));

  if (!existsSync(sqlitePath)) {
    throw new Error(`No existe SQLite: ${sqlitePath}`);
  }
  if (!existsSync(pdfBasePath)) {
    throw new Error(`No existe SQLITE_PDF_BASE_PATH: ${pdfBasePath}`);
  }

  const db = await open({ filename: sqlitePath, driver: sqlite3.Database });
  const prisma = createPrismaClient();

  try {
    const [sentencias, sumarios, pdfFiles] = await Promise.all([
      db.all<LegacySentencia[]>(
        `SELECT id_sentencia, codigo_sentencia, fallo_completo, link
         FROM tb_sentencias
         ORDER BY id_sentencia`,
      ),
      db.all<LegacySumario[]>(
        `SELECT id_sumario, id_sentencia, numero_sumario
         FROM tb_sumarios
         ORDER BY id_sumario`,
      ),
      walkPdfs(pdfBasePath),
    ]);

    const firstSumarioBySentencia = new Map<number, LegacySumario>();
    for (const sumario of sumarios) {
      if (sumario.id_sentencia == null || firstSumarioBySentencia.has(sumario.id_sentencia)) {
        continue;
      }
      firstSumarioBySentencia.set(sumario.id_sentencia, sumario);
    }

    const pdfByRelativePath = new Map(pdfFiles.map((file) => [normalizePathKey(file.relativePath), file]));
    const expectedPathByLegacyId = new Map<string, string>();
    const expectedPathKeys = new Set<string>();

    for (const sentencia of sentencias) {
      const expected = legacyPdfRelativePath(Number(sentencia.id_sentencia));
      expectedPathByLegacyId.set(String(sentencia.id_sentencia), expected.relativePath);
      expectedPathKeys.add(normalizePathKey(expected.relativePath));
    }

    const [pgSentencias, pgPdfs] = await Promise.all([
      prisma.sentencia.findMany({
        where: { legacyId: { not: null } },
        select: {
          id: true,
          legacyId: true,
          numeroSentencia: true,
          tienePdf: true,
          archivosPdf: {
            select: { id: true, legacyPath: true, rutaArchivo: true, sentenciaId: true },
          },
        },
      }),
      prisma.archivoPdf.findMany({
        select: {
          id: true,
          legacyId: true,
          legacyPath: true,
          rutaArchivo: true,
          sentenciaId: true,
          sentencia: { select: { legacyId: true } },
        },
      }),
    ]);

    const pgSentenciaByLegacyId = new Map(pgSentencias.map((sentencia) => [sentencia.legacyId!, sentencia]));
    const pgPdfByLegacyPath = new Map<string, (typeof pgPdfs)[number][]>();
    for (const pdf of pgPdfs) {
      if (!pdf.legacyPath) {
        continue;
      }
      const key = normalizePathKey(pdf.legacyPath);
      const list = pgPdfByLegacyPath.get(key) ?? [];
      list.push(pdf);
      pgPdfByLegacyPath.set(key, list);
    }

    const rows: DiagnosticoRow[] = [];
    let correctos = 0;
    let incorrectos = 0;
    let faltantes = 0;
    let altaConfianza = 0;
    let tienePdfTrueSinPdfReal = 0;
    let tienePdfFalseConPdfReal = 0;

    for (const sentencia of sentencias) {
      const expected = legacyPdfRelativePath(Number(sentencia.id_sentencia));
      const expectedKey = normalizePathKey(expected.relativePath);
      const oldFile = pdfByRelativePath.get(expectedKey);
      const pgSentencia = pgSentenciaByLegacyId.get(String(sentencia.id_sentencia));
      const expectedPgPdfs = pgPdfByLegacyPath.get(expectedKey) ?? [];
      const currentRealPdfs = pgSentencia?.archivosPdf.filter((pdf) => existsSync(pdf.rutaArchivo)) ?? [];
      const firstCurrentPdf = pgSentencia?.archivosPdf[0];
      const hasExpectedOnCurrent = expectedPgPdfs.some((pdf) => pdf.sentenciaId === pgSentencia?.id);
      const hasWrongPdfOnCurrent =
        Boolean(pgSentencia?.archivosPdf.length) &&
        !pgSentencia?.archivosPdf.some((pdf) => normalizePathKey(pdf.legacyPath ?? '') === expectedKey);

      let observacion = 'Sin PDF fisico esperado segun regla PHP vieja';
      let confianza = 'baja';

      if (oldFile) {
        confianza = 'alta';
        altaConfianza += 1;
        observacion = 'PDF esperado existe en carpeta vieja';
      }

      if (oldFile && hasExpectedOnCurrent) {
        correctos += 1;
        observacion = 'Asociacion actual coincide con regla PHP vieja';
      } else if (oldFile && expectedPgPdfs.length > 0 && !hasExpectedOnCurrent) {
        incorrectos += 1;
        observacion = `PDF esperado esta asociado a otra sentenciaId: ${expectedPgPdfs
          .map((pdf) => pdf.sentenciaId)
          .join(', ')}`;
      } else if (oldFile && hasWrongPdfOnCurrent) {
        incorrectos += 1;
        observacion = 'Sentencia actual tiene PDF, pero no el legacyPath esperado';
      } else if (oldFile) {
        faltantes += 1;
        observacion = 'PDF esperado existe, pero no hay ArchivoPdf asociado en PostgreSQL';
      }

      if (pgSentencia?.tienePdf && currentRealPdfs.length === 0) {
        tienePdfTrueSinPdfReal += 1;
      }
      if (pgSentencia && !pgSentencia.tienePdf && currentRealPdfs.length > 0) {
        tienePdfFalseConPdfReal += 1;
      }

      const sumario = firstSumarioBySentencia.get(Number(sentencia.id_sentencia));
      rows.push({
        idSentenciaLegacy: String(sentencia.id_sentencia),
        codigoSentencia: sentencia.codigo_sentencia ?? '',
        falloCompleto: String(sentencia.fallo_completo ?? ''),
        idSumarioLegacy: String(sumario?.id_sumario ?? ''),
        numeroSumario: sumario?.numero_sumario ?? '',
        carpetaPdfCandidata: expected.carpeta,
        archivoPdfCandidato: expected.relativePath,
        estrategia: 'php-viejo-id_sentencia-sin-ultimos-2-digitos',
        existeArchivo: oldFile ? 'si' : 'no',
        confianza,
        observacion,
        sentenciaIdActual: String(pgSentencia?.id ?? ''),
        pdfActualId: String(firstCurrentPdf?.id ?? ''),
        pdfActualLegacyPath: firstCurrentPdf?.legacyPath ?? '',
        pdfActualRutaArchivo: firstCurrentPdf?.rutaArchivo ?? '',
        pdfActualExiste: firstCurrentPdf?.rutaArchivo && existsSync(firstCurrentPdf.rutaArchivo) ? 'si' : 'no',
      });
    }

    const directoryCounts = new Map<string, number>();
    const filenameSamples = new Map<string, number>();
    for (const file of pdfFiles) {
      directoryCounts.set(file.directory, (directoryCounts.get(file.directory) ?? 0) + 1);
      filenameSamples.set(file.filename, (filenameSamples.get(file.filename) ?? 0) + 1);
    }

    const pdfsHuerfanosFisicos = pdfFiles.filter(
      (file) => !expectedPathKeys.has(normalizePathKey(file.relativePath)),
    );
    const pdfsHuerfanosPostgres = pgPdfs.filter((pdf) => {
      const legacyPath = normalizePathKey(pdf.legacyPath ?? '');
      return !legacyPath || !expectedPathKeys.has(legacyPath) || !existsSync(pdf.rutaArchivo);
    });

    const reporte = {
      generadoEn: new Date().toISOString(),
      reglaPhpVieja: {
        campo: 'tb_sentencias.id_sentencia',
        carpeta: 'id_sentencia > 99 ? String(id_sentencia).slice(0, -2) : "0"',
        archivo: 'id_sentencia + ".pdf"',
        ejemplo: 'id_sentencia=30899 => PDF/308/30899.pdf',
        evidencia: [
          'jurisprudenciaNew/jurisp_6/js/jurisprudencia.js VER_PDF.ver_pdf',
          'jurisprudenciaNew/jurisp_6/2_1_buscar_nro_sentencia.php file_pdf($nr)',
          'jurisprudenciaNew/jurisp_6/3_3_grabar_sentencia.php upload target',
        ],
      },
      sqlite: {
        path: sqlitePath,
        totalSentencias: sentencias.length,
        totalSumarios: sumarios.length,
        sentenciasFalloCompleto1: sentencias.filter((row) => String(row.fallo_completo) === '1').length,
      },
      pdfsViejos: {
        basePath: pdfBasePath,
        totalCarpetas: directoryCounts.size,
        totalPdfs: pdfFiles.length,
        carpetasTop: [...directoryCounts.entries()]
          .map(([carpeta, total]) => ({ carpeta, total }))
          .sort((a, b) => b.total - a.total || a.carpeta.localeCompare(b.carpeta))
          .slice(0, 25),
        ejemplosRutas: pdfFiles.slice(0, 30).map((file) => file.relativePath),
        nombresComunes: [...filenameSamples.entries()]
          .map(([archivo, total]) => ({ archivo, total }))
          .sort((a, b) => b.total - a.total || a.archivo.localeCompare(b.archivo))
          .slice(0, 25),
      },
      postgres: {
        sentenciasLegacy: pgSentencias.length,
        archivosPdf: pgPdfs.length,
      },
      comparacion: {
        correctos,
        incorrectos,
        faltantes,
        pdfsHuerfanosFisicos: pdfsHuerfanosFisicos.length,
        pdfsHuerfanosPostgres: pdfsHuerfanosPostgres.length,
        tienePdfTrueSinPdfReal,
        tienePdfFalseConPdfReal,
        matchConfianzaAlta: altaConfianza,
      },
      ejemplosFalloCompleto1: rows.filter((row) => row.falloCompleto === '1').slice(0, 20),
      ejemplosIncorrectos: rows.filter((row) => row.observacion.includes('otra') || row.observacion.includes('no el legacyPath')).slice(0, 30),
      ejemplosFaltantes: rows.filter((row) => row.observacion.includes('no hay ArchivoPdf')).slice(0, 30),
      checklistManual: [
        'Tomar 10 sentencias: incluir carpetas PDF/308, PDF/309, PDF/310, con fallo_completo=1 y sin PDF.',
        'Abrir el PDF viejo calculado por id_sentencia.',
        'Abrir el PDF nuevo desde el visor.',
        'Comparar carátula, número de sentencia, fecha y partes.',
        'Registrar cualquier caso donde el archivo fisico exista pero no corresponda por contenido.',
      ],
      filas: rows,
    };

    await mkdir(outputDir, { recursive: true });
    await writeFile(jsonPath, JSON.stringify(reporte, null, 2), 'utf8');
    await writeFile(csvPath, toCsv(rows), 'utf8');

    console.log('Diagnostico PDFs viejos generado');
    console.log(`JSON: ${jsonPath}`);
    console.log(`CSV: ${csvPath}`);
    console.log(`PDFs fisicos viejos: ${pdfFiles.length}`);
    console.log(`Match confianza alta: ${altaConfianza}`);
    console.log(`Correctos: ${correctos}`);
    console.log(`Incorrectos: ${incorrectos}`);
    console.log(`Faltantes: ${faltantes}`);
    console.log(`PostgreSQL huerfanos/faltantes fisicos: ${pdfsHuerfanosPostgres.length}`);
  } finally {
    await db.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

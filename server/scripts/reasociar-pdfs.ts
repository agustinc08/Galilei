import 'dotenv/config';

import { existsSync, statSync } from 'fs';
import { copyFile, mkdir, readdir, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { basename, extname, join, relative, resolve } from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { createPrismaClient } from '../src/importacion/utils/prisma-client';

type LegacySentencia = {
  id_sentencia: number;
  codigo_sentencia: string | null;
};

type PdfEntry = {
  fullPath: string;
  relativePath: string;
  filename: string;
  size: number;
};

type ChangeLog = {
  action: 'update-archivo' | 'create-archivo' | 'update-tienePdf' | 'skip';
  legacyId: string;
  sentenciaId?: number;
  archivoPdfId?: number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
};

const dryRun = process.argv.includes('--dry-run');
const copyFiles = process.argv.includes('--copy');
const outputDir = resolve(process.cwd(), 'logs', 'importacion');
const uploadsDir = resolve(process.cwd(), 'uploads', 'sentencias');
const logPath = join(
  outputDir,
  `reasociar-pdfs-${dryRun ? 'dry-run' : 'real'}-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.json`,
);

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
  return `${carpeta}/${archivo}`;
}

function isInsideBasePath(filePath: string, basePath: string) {
  const normalizedFile = normalizePathKey(resolve(filePath));
  const normalizedBase = normalizePathKey(resolve(basePath));
  return normalizedFile === normalizedBase || normalizedFile.startsWith(`${normalizedBase}/`);
}

async function buildArchivoData(
  expectedFile: PdfEntry,
  sentenciaId: number,
  legacyId: string,
  legacyPath: string,
) {
  if (!copyFiles) {
    return {
      legacyId,
      nombreArchivo: expectedFile.filename,
      nombreOriginal: expectedFile.filename,
      rutaArchivo: expectedFile.fullPath,
      legacyPath,
      mimeType: 'application/pdf',
      tamanioBytes: expectedFile.size,
      sentenciaId,
    };
  }

  const extension = extname(expectedFile.fullPath) || '.pdf';
  const storedName = `${sentenciaId}-${Date.now()}-${randomUUID()}${extension}`;
  const targetPath = join(uploadsDir, storedName);

  if (!dryRun) {
    await mkdir(uploadsDir, { recursive: true });
    await copyFile(expectedFile.fullPath, targetPath);
  }

  return {
    legacyId,
    nombreArchivo: storedName,
    nombreOriginal: expectedFile.filename,
    rutaArchivo: targetPath,
    legacyPath,
    mimeType: 'application/pdf',
    tamanioBytes: expectedFile.size,
    sentenciaId,
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
      files.push({
        fullPath,
        relativePath: relative(basePath, fullPath).replace(/\\/g, '/'),
        filename: entry.name,
        size: statSync(fullPath).size,
      });
    }
  }

  await walk(basePath);
  return files;
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
  const logs: ChangeLog[] = [];

  try {
    const [sentenciasLegacy, pdfFiles] = await Promise.all([
      db.all<LegacySentencia[]>(
        `SELECT id_sentencia, codigo_sentencia
         FROM tb_sentencias
         ORDER BY id_sentencia`,
      ),
      walkPdfs(pdfBasePath),
    ]);

    const pdfByRelativePath = new Map(pdfFiles.map((file) => [normalizePathKey(file.relativePath), file]));
    const sentenciasPg = await prisma.sentencia.findMany({
      where: { legacyId: { not: null } },
      select: {
        id: true,
        legacyId: true,
        tienePdf: true,
        archivosPdf: {
          select: {
            id: true,
            legacyId: true,
            legacyPath: true,
            rutaArchivo: true,
            nombreArchivo: true,
            nombreOriginal: true,
            sentenciaId: true,
          },
        },
      },
    });
    const sentenciaByLegacyId = new Map(sentenciasPg.map((sentencia) => [sentencia.legacyId!, sentencia]));
    const allPdfs = await prisma.archivoPdf.findMany({
      select: {
        id: true,
        legacyId: true,
        legacyPath: true,
        rutaArchivo: true,
        nombreArchivo: true,
        nombreOriginal: true,
        sentenciaId: true,
      },
    });
    const pdfByLegacyPath = new Map<string, (typeof allPdfs)[number][]>();
    for (const pdf of allPdfs) {
      if (!pdf.legacyPath) {
        continue;
      }
      const key = normalizePathKey(pdf.legacyPath);
      const list = pdfByLegacyPath.get(key) ?? [];
      list.push(pdf);
      pdfByLegacyPath.set(key, list);
    }

    let updatedArchivos = 0;
    let createdArchivos = 0;
    let skipped = 0;

    for (const legacy of sentenciasLegacy) {
      const legacyId = String(legacy.id_sentencia);
      const sentencia = sentenciaByLegacyId.get(legacyId);
      const expectedRelativePath = legacyPdfRelativePath(legacy.id_sentencia);
      const expectedFile = pdfByRelativePath.get(normalizePathKey(expectedRelativePath));

      if (!sentencia) {
        skipped += 1;
        logs.push({ action: 'skip', legacyId, reason: 'Sentencia legacy no existe en PostgreSQL' });
        continue;
      }
      if (!expectedFile) {
        skipped += 1;
        logs.push({ action: 'skip', legacyId, sentenciaId: sentencia.id, reason: 'No existe PDF viejo esperado' });
        continue;
      }

      const currentCandidates = pdfByLegacyPath.get(normalizePathKey(expectedRelativePath)) ?? [];
      const current = currentCandidates[0];

      if (current) {
        const needsUpdate =
          current.sentenciaId !== sentencia.id ||
          current.legacyId !== legacyId ||
          normalizePathKey(current.legacyPath ?? '') !== normalizePathKey(expectedRelativePath) ||
          (copyFiles && isInsideBasePath(current.rutaArchivo, pdfBasePath));

        if (needsUpdate) {
          const after = await buildArchivoData(
            expectedFile,
            sentencia.id,
            legacyId,
            expectedRelativePath,
          );
          logs.push({
            action: 'update-archivo',
            legacyId,
            sentenciaId: sentencia.id,
            archivoPdfId: current.id,
            before: {
              legacyId: current.legacyId,
              legacyPath: current.legacyPath,
              rutaArchivo: current.rutaArchivo,
              sentenciaId: current.sentenciaId,
            },
            after,
          });

          if (!dryRun) {
            await prisma.archivoPdf.update({
              where: { id: current.id },
              data: after,
            });
          }
          updatedArchivos += 1;
        }
        continue;
      }

      const existingOnSentence = sentencia.archivosPdf.find((pdf) => basename(pdf.rutaArchivo) === expectedFile.filename);
      if (existingOnSentence) {
        const after = await buildArchivoData(
          expectedFile,
          sentencia.id,
          legacyId,
          expectedRelativePath,
        );
        logs.push({
          action: 'update-archivo',
          legacyId,
          sentenciaId: sentencia.id,
          archivoPdfId: existingOnSentence.id,
          before: {
            legacyId: existingOnSentence.legacyId,
            legacyPath: existingOnSentence.legacyPath,
            rutaArchivo: existingOnSentence.rutaArchivo,
            sentenciaId: existingOnSentence.sentenciaId,
          },
          after,
        });

        if (!dryRun) {
          await prisma.archivoPdf.update({
            where: { id: existingOnSentence.id },
            data: after,
          });
        }
        updatedArchivos += 1;
        continue;
      }

      const after = await buildArchivoData(
        expectedFile,
        sentencia.id,
        legacyId,
        expectedRelativePath,
      );
      logs.push({
        action: 'create-archivo',
        legacyId,
        sentenciaId: sentencia.id,
        after,
      });

      if (!dryRun) {
        await prisma.archivoPdf.create({
          data: after,
        });
      }
      createdArchivos += 1;
    }

    const recalculoSentencias = await prisma.sentencia.findMany({
      select: {
        id: true,
        legacyId: true,
        tienePdf: true,
        archivosPdf: { select: { rutaArchivo: true } },
      },
    });

    let updatedTienePdf = 0;
    for (const sentencia of recalculoSentencias) {
      const tienePdfReal = sentencia.archivosPdf.some((archivo) => existsSync(archivo.rutaArchivo));
      if (sentencia.tienePdf === tienePdfReal) {
        continue;
      }

      logs.push({
        action: 'update-tienePdf',
        legacyId: sentencia.legacyId ?? '',
        sentenciaId: sentencia.id,
        before: { tienePdf: sentencia.tienePdf },
        after: { tienePdf: tienePdfReal },
      });

      if (!dryRun) {
        await prisma.sentencia.update({
          where: { id: sentencia.id },
          data: { tienePdf: tienePdfReal },
        });
      }
      updatedTienePdf += 1;
    }

    const summary = {
      generadoEn: new Date().toISOString(),
      dryRun,
      copyFiles,
      regla: 'PDF/<id_sentencia sin ultimos 2 digitos>/<id_sentencia>.pdf; si id_sentencia <= 99 usa PDF/0',
      updatedArchivos,
      createdArchivos,
      updatedTienePdf,
      skipped,
      logs,
    };

    if (!dryRun) {
      await mkdir(outputDir, { recursive: true });
      await writeFile(logPath, JSON.stringify(summary, null, 2), 'utf8');
    }

    console.log(dryRun ? 'Dry-run reasociacion PDFs finalizado' : 'Reasociacion PDFs finalizada');
    console.log(dryRun ? 'Log no escrito por dry-run' : `Log: ${logPath}`);
    console.log(`ArchivoPdf a actualizar/actualizados: ${updatedArchivos}`);
    console.log(`ArchivoPdf a crear/creados apuntando al PDF viejo existente: ${createdArchivos}`);
    console.log(`Sentencia.tienePdf a recalcular/recalculadas: ${updatedTienePdf}`);
    console.log(`Omitidos: ${skipped}`);
  } finally {
    await db.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import type { PrismaClient } from '../../generated/prisma/client';
import { randomUUID } from 'crypto';
import { copyFile, mkdir, stat } from 'fs/promises';
import { basename, extname, join, resolve } from 'path';
import { mapLegacySentencia, type LegacyRow } from '../utils/mapeadores';
import { ImportLogger } from '../utils/import-logger';
import { ImportOptions, ImportStats } from '../types/importacion-options.type';
import { PdfMatcherService } from './pdf-matcher.service';
import { SqliteReaderService } from './sqlite-reader.service';

const uploadsDir = resolve(process.cwd(), 'uploads', 'sentencias');

export class ImportadorPdfService {
  private sentenceIdCache = new Map<string, number>();
  private pdfMatcher?: PdfMatcherService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly reader: SqliteReaderService,
    private readonly logger: ImportLogger,
    private readonly options: ImportOptions,
  ) {}

  async importPdfs(stats: ImportStats) {
    if (!this.options.pdfBasePath) {
      this.logger.warn(
        'Importacion de PDFs omitida: SQLITE_PDF_BASE_PATH no esta configurada',
      );
      return;
    }

    const tableName = await this.reader.resolveTableName([
      'tb_sentencias',
      'sentencias',
    ]);

    if (!tableName) {
      this.logger.warn('No se encontro tabla de sentencias para importar PDFs');
      return;
    }

    await this.reloadSentenceCache();
    this.pdfMatcher = await PdfMatcherService.create(this.options.pdfBasePath);
    stats.pdfsDetected = this.pdfMatcher.getAllFiles().length;
    const matchedRelativePaths = new Set<string>();

    for await (const rows of this.reader.iterateTable(
      tableName,
      this.options.batchSize,
      ['codigo', 'id', 'id_sentencia'],
    )) {
      await this.processPdfBatch(rows, stats, matchedRelativePaths);
    }

    stats.pdfsOrphans = Math.max(
      0,
      this.pdfMatcher.getAllFiles().length - matchedRelativePaths.size,
    );
  }

  async inspectPdfs() {
    if (!this.options.pdfBasePath) {
      throw new Error('SQLITE_PDF_BASE_PATH no esta configurada');
    }

    this.pdfMatcher = await PdfMatcherService.create(this.options.pdfBasePath);
    return this.pdfMatcher.inspect(15);
  }

  async buildMatchingReport(limit = 50) {
    if (!this.options.pdfBasePath) {
      throw new Error('SQLITE_PDF_BASE_PATH no esta configurada');
    }

    this.pdfMatcher = await PdfMatcherService.create(this.options.pdfBasePath);
    const tableName = await this.reader.resolveTableName([
      'tb_sentencias',
      'sentencias',
    ]);
    const matched: Array<{
      legacyId: string;
      numeroSentencia?: string;
      expediente?: string;
      file: string;
      strategy: string;
    }> = [];
    const unmatched: Array<{
      legacyId?: string;
      numeroSentencia?: string;
      expediente?: string;
      legacyLink?: string;
    }> = [];

    if (!tableName) {
      return { matched, unmatched };
    }

    for await (const rows of this.reader.iterateTable(
      tableName,
      this.options.batchSize,
      ['codigo', 'id', 'id_sentencia'],
    )) {
      for (const row of rows) {
        const mapped = mapLegacySentencia(row);
        const match = this.pdfMatcher.match({
          explicitPdfPath: mapped.explicitPdfPath,
          legacyLink: mapped.legacyLink,
          legacyId: mapped.legacyId,
          numeroSentencia: mapped.numeroSentencia,
          expediente: mapped.expedienteNormalizado,
        });

        if (match) {
          if (matched.length < limit) {
            matched.push({
              legacyId: mapped.legacyId ?? 'sin-id',
              numeroSentencia: mapped.numeroSentencia,
              expediente: mapped.expedienteNormalizado,
              file: match.file.relativePath,
              strategy: match.strategy,
            });
          }
          continue;
        }

        if (unmatched.length < limit) {
          unmatched.push({
            legacyId: mapped.legacyId,
            numeroSentencia: mapped.numeroSentencia,
            expediente: mapped.expedienteNormalizado,
            legacyLink: mapped.legacyLink,
          });
        }
      }
    }

    return { matched, unmatched };
  }

  private async processPdfBatch(
    rows: LegacyRow[],
    stats: ImportStats,
    matchedRelativePaths: Set<string>,
  ) {
    if (!this.pdfMatcher) {
      throw new Error('PdfMatcherService no inicializado');
    }

    for (const row of rows) {
      const mapped = mapLegacySentencia(row);

      if (!mapped.legacyId) {
        continue;
      }

      const sentenciaId = this.sentenceIdCache.get(mapped.legacyId);
      if (!sentenciaId) {
        continue;
      }

      const match = this.pdfMatcher.match({
        explicitPdfPath: mapped.explicitPdfPath,
        legacyLink: mapped.legacyLink,
        legacyId: mapped.legacyId,
        numeroSentencia: mapped.numeroSentencia,
        expediente: mapped.expedienteNormalizado,
      });

      if (!match) {
        stats.pdfsUnmatched += 1;
        continue;
      }

      matchedRelativePaths.add(match.file.relativePath);
      stats.pdfsMatched += 1;
      stats.estrategiasPdf[match.strategy] =
        (stats.estrategiasPdf[match.strategy] ?? 0) + 1;

      if (match.candidatesCount > 1) {
        stats.warnings += 1;
        this.logger.warn(
          `Multiples PDFs candidatos para sentencia legacyId=${mapped.legacyId} estrategia=${match.strategy} candidatos=${match.candidatesCount}. Se usa ${match.file.relativePath}`,
        );
      }

      const existing = await this.prisma.archivoPdf.findFirst({
        where: {
          OR: [
            { legacyPath: match.file.relativePath },
            {
              sentenciaId,
              nombreOriginal: basename(match.file.fullPath),
            },
          ],
        },
        select: { id: true },
      });

      if (existing) {
        stats.pdfsSkipped += 1;
        stats.pdfsAssociated += 1;
        continue;
      }

      try {
        if (this.options.dryRun) {
          stats.pdfsAssociated += 1;
          stats.pdfsCopied += 1;
          continue;
        }

        await mkdir(uploadsDir, { recursive: true });

        const extension = extname(match.file.fullPath) || '.pdf';
        const storedName = `${sentenciaId}-${Date.now()}-${randomUUID()}${extension}`;
        const targetPath = join(uploadsDir, storedName);
        const fileStats = await stat(match.file.fullPath);

        await copyFile(match.file.fullPath, targetPath);

        await this.prisma.archivoPdf.create({
          data: {
            legacyId: mapped.legacyId,
            nombreArchivo: storedName,
            nombreOriginal: basename(match.file.fullPath),
            rutaArchivo: targetPath,
            legacyPath: match.file.relativePath,
            mimeType: 'application/pdf',
            tamanioBytes: Number(fileStats.size),
            sentenciaId,
          },
        });

        await this.prisma.sentencia.update({
          where: { id: sentenciaId },
          data: { tienePdf: true },
        });

        stats.pdfsAssociated += 1;
        stats.pdfsCopied += 1;
      } catch (error) {
        stats.errors += 1;
        stats.pdfsSkipped += 1;
        this.logger.error(
          `Error importando PDF para sentencia legacyId=${mapped.legacyId} origen=${match.file.fullPath}`,
          error,
        );
      }
    }
  }

  private async reloadSentenceCache() {
    const sentencias = await this.prisma.sentencia.findMany({
      where: { legacyId: { not: null } },
      select: { id: true, legacyId: true },
    });

    this.sentenceIdCache = new Map(
      sentencias.map((sentencia) => [sentencia.legacyId!, sentencia.id]),
    );
  }
}

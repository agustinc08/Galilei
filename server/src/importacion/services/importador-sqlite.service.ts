import type { PrismaClient } from '@prisma/client';
import {
  mapLegacySentencia,
  mapLegacySumario,
  type LegacyRow,
} from '../utils/mapeadores';
import { ImportLogger } from '../utils/import-logger';
import { ImportOptions, ImportStats } from '../types/importacion-options.type';
import { SqliteReaderService } from './sqlite-reader.service';

export class ImportadorSqliteService {
  private sentenceIdCache = new Map<string, number>();
  private salaCache = new Map<string, number>();
  private tipoFalloCache = new Map<string, number>();
  private tribunalOrigenCache = new Map<string, number>();
  private dryRunSentenceSequence = -1;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly reader: SqliteReaderService,
    private readonly logger: ImportLogger,
    private readonly options: ImportOptions,
  ) {}

  async importSentencias(stats: ImportStats) {
    const tableName = await this.reader.resolveTableName([
      'tb_sentencias',
      'sentencias',
    ]);

    if (!tableName) {
      this.logger.warn('No se encontro tabla de sentencias en SQLite');
      return;
    }

    for await (const rows of this.reader.iterateTable(
      tableName,
      this.options.batchSize,
      ['codigo', 'id', 'id_sentencia'],
    )) {
      await this.processSentenciasBatch(rows, stats);
    }

    await this.reloadSentenceCache();
  }

  async importSumarios(stats: ImportStats) {
    const tableName = await this.reader.resolveTableName([
      'tb_sumarios',
      'sumarios',
    ]);

    if (!tableName) {
      this.logger.warn('No se encontro tabla de sumarios en SQLite');
      return;
    }

    await this.reloadSentenceCache();

    for await (const rows of this.reader.iterateTable(
      tableName,
      this.options.batchSize,
      ['codigo', 'id', 'id_sumario'],
    )) {
      await this.processSumariosBatch(rows, stats);
    }
  }

  private async processSentenciasBatch(rows: LegacyRow[], stats: ImportStats) {
    const mappedRows = rows.map((row) => mapLegacySentencia(row));
    const legacyIds = mappedRows
      .map((row) => row.legacyId)
      .filter((value): value is string => Boolean(value));

    const existing = await this.prisma.sentencia.findMany({
      where: { legacyId: { in: legacyIds } },
      select: { id: true, legacyId: true },
    });
    const existingMap = new Map(existing.map((row) => [row.legacyId!, row.id]));

    for (const mapped of mappedRows) {
      stats.sentenciasRead += 1;

      if (mapped.fechaRaw && !mapped.data.fecha) {
        stats.warnings += 1;
        this.logger.warn(
          `Sentencia legacyId=${mapped.legacyId ?? 'sin-id'} con fecha invalida: ${String(mapped.fechaRaw)}`,
        );
      }

      if (!mapped.legacyId) {
        stats.sentenciasSkipped += 1;
        stats.errors += 1;
        this.logger.error('Sentencia omitida: no se pudo determinar legacyId');
        continue;
      }

      const exists = existingMap.has(mapped.legacyId);

      try {
        const catalogFields = await this.resolveCatalogFields({
          sala: mapped.sala,
          tipoFallo: mapped.tipoFallo,
          tribunalOrigen: mapped.tribunalOrigen,
        });

        if (this.options.dryRun) {
          this.sentenceIdCache.set(
            mapped.legacyId,
            existingMap.get(mapped.legacyId) ?? this.dryRunSentenceSequence--,
          );
          if (exists) {
            stats.sentenciasUpdated += 1;
          } else {
            stats.sentenciasCreated += 1;
          }
          continue;
        }

        const sentencia = await this.prisma.sentencia.upsert({
          where: { legacyId: mapped.legacyId },
          create: {
            ...mapped.data,
            ...catalogFields,
          },
          update: {
            ...mapped.data,
            ...catalogFields,
          },
          select: { id: true, legacyId: true },
        });

        this.sentenceIdCache.set(mapped.legacyId, sentencia.id);

        if (exists) {
          stats.sentenciasUpdated += 1;
        } else {
          stats.sentenciasCreated += 1;
        }
      } catch (error) {
        stats.errors += 1;
        stats.sentenciasSkipped += 1;
        this.logger.error(
          `Error importando sentencia legacyId=${mapped.legacyId}`,
          error,
        );
      }
    }
  }

  private async processSumariosBatch(rows: LegacyRow[], stats: ImportStats) {
    const mappedRows = rows.map((row) => mapLegacySumario(row));
    const legacyIds = mappedRows
      .map((row) => row.legacyId)
      .filter((value): value is string => Boolean(value));

    const existing = await this.prisma.sumario.findMany({
      where: { legacyId: { in: legacyIds } },
      select: { legacyId: true },
    });
    const existingIds = new Set(existing.map((row) => row.legacyId!));

    for (const mapped of mappedRows) {
      stats.sumariosRead += 1;

      if (!mapped.legacyId) {
        stats.sumariosSkipped += 1;
        stats.errors += 1;
        this.logger.error('Sumario omitido: no se pudo determinar legacyId');
        continue;
      }

      if (!mapped.sentenciaLegacyId) {
        stats.sumariosSkipped += 1;
        stats.errors += 1;
        this.logger.error(
          `Sumario legacyId=${mapped.legacyId} omitido: sin referencia a sentencia`,
        );
        continue;
      }

      const sentenciaId = this.sentenceIdCache.get(mapped.sentenciaLegacyId);
      if (!sentenciaId) {
        stats.sumariosSkipped += 1;
        stats.errors += 1;
        this.logger.error(
          `Sumario legacyId=${mapped.legacyId} omitido: sentencia legacyId=${mapped.sentenciaLegacyId} no encontrada`,
        );
        continue;
      }

      const exists = existingIds.has(mapped.legacyId);

      try {
        if (this.options.dryRun) {
          if (exists) {
            stats.sumariosUpdated += 1;
          } else {
            stats.sumariosCreated += 1;
          }
          continue;
        }

        await this.prisma.sumario.upsert({
          where: { legacyId: mapped.legacyId },
          create: {
            ...mapped.data,
            sentenciaId,
          },
          update: {
            ...mapped.data,
            sentenciaId,
          },
        });

        if (exists) {
          stats.sumariosUpdated += 1;
        } else {
          stats.sumariosCreated += 1;
        }
      } catch (error) {
        stats.errors += 1;
        stats.sumariosSkipped += 1;
        this.logger.error(
          `Error importando sumario legacyId=${mapped.legacyId}`,
          error,
        );
      }
    }
  }

  private async reloadSentenceCache() {
    if (this.options.dryRun && this.sentenceIdCache.size > 0) {
      return;
    }

    const sentencias = await this.prisma.sentencia.findMany({
      where: { legacyId: { not: null } },
      select: { id: true, legacyId: true },
    });

    this.sentenceIdCache = new Map(
      sentencias.map((sentencia) => [sentencia.legacyId!, sentencia.id]),
    );
  }

  private async resolveCatalogFields(input: {
    sala?: string;
    tipoFallo?: string;
    tribunalOrigen?: string;
  }) {
    const salaId = await this.ensureCatalogValue(
      'sala',
      input.sala,
      this.salaCache,
    );
    const tipoFalloId = await this.ensureCatalogValue(
      'tipoFallo',
      input.tipoFallo,
      this.tipoFalloCache,
    );
    const tribunalOrigenId = await this.ensureCatalogValue(
      'tribunalOrigen',
      input.tribunalOrigen,
      this.tribunalOrigenCache,
    );

    return {
      salaId,
      tipoFalloId,
      tribunalOrigenId,
      sala: input.sala ?? undefined,
      tipoFallo: input.tipoFallo ?? undefined,
      tribunalOrigen: input.tribunalOrigen ?? undefined,
    };
  }

  private async ensureCatalogValue(
    type: 'sala' | 'tipoFallo' | 'tribunalOrigen',
    value: string | undefined,
    cache: Map<string, number>,
  ) {
    const normalized = value?.trim();

    if (!normalized) {
      return undefined;
    }

    const cached = cache.get(normalized.toLowerCase());
    if (cached) {
      return cached;
    }

    if (this.options.dryRun) {
      return undefined;
    }

    if (type === 'sala') {
      const catalog = await this.prisma.sala.upsert({
        where: { nombre: normalized },
        update: { activa: true },
        create: { nombre: normalized, activa: true },
        select: { id: true },
      });
      cache.set(normalized.toLowerCase(), catalog.id);
      return catalog.id;
    }

    if (type === 'tipoFallo') {
      const catalog = await this.prisma.tipoFallo.upsert({
        where: { nombre: normalized },
        update: { activo: true },
        create: { nombre: normalized, activo: true },
        select: { id: true },
      });
      cache.set(normalized.toLowerCase(), catalog.id);
      return catalog.id;
    }

    const catalog = await this.prisma.tribunalOrigen.upsert({
      where: { nombre: normalized },
      update: { activo: true },
      create: { nombre: normalized, activo: true },
      select: { id: true },
    });
    cache.set(normalized.toLowerCase(), catalog.id);
    return catalog.id;
  }
}

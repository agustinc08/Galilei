import { open, type Database as SqliteDatabase } from 'sqlite';
import sqlite3 from 'sqlite3';
import { ImportLogger } from '../utils/import-logger';

type LegacyRow = Record<string, unknown>;

export class SqliteReaderService {
  private constructor(
    private readonly db: SqliteDatabase,
    private readonly logger: ImportLogger,
  ) {}

  static async create(sqlitePath: string, logger: ImportLogger) {
    const db = await open({
      filename: sqlitePath,
      driver: sqlite3.Database,
    });

    return new SqliteReaderService(db, logger);
  }

  async close() {
    await this.db.close();
  }

  async listTables() {
    const tables = await this.db.all<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );
    return tables.map((table) => table.name);
  }

  async resolveTableName(candidates: string[]) {
    const tables = await this.db.all<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    );
    const tableMap = new Map(
      tables.map((table) => [table.name.toLowerCase(), table.name]),
    );

    for (const candidate of candidates) {
      const match = tableMap.get(candidate.toLowerCase());
      if (match) {
        return match;
      }
    }

    return undefined;
  }

  async getColumns(tableName: string) {
    const rows = await this.db.all<{ name: string }[]>(
      `PRAGMA table_info("${tableName}")`,
    );

    return rows.map((row) => row.name);
  }

  async countRows(tableName: string) {
    const row = await this.db.get<{ total: number }>(
      `SELECT COUNT(*) as total FROM "${tableName}"`,
    );
    return Number(row?.total ?? 0);
  }

  async sampleRows(tableName: string, limit = 5) {
    return this.db.all<LegacyRow[]>(
      `SELECT * FROM "${tableName}" LIMIT ?`,
      limit,
    );
  }

  async getDistinctValues(tableName: string, columnName: string, limit = 100) {
    return this.db.all<{ value: unknown; total: number }[]>(
      `SELECT "${columnName}" as value, COUNT(*) as total
       FROM "${tableName}"
       WHERE "${columnName}" IS NOT NULL AND TRIM(CAST("${columnName}" AS TEXT)) <> ''
       GROUP BY "${columnName}"
       ORDER BY total DESC, value ASC
       LIMIT ?`,
      limit,
    );
  }

  async hasColumn(tableName: string, columnCandidates: string[]) {
    const columns = await this.getColumns(tableName);
    const lower = new Map(
      columns.map((column) => [column.toLowerCase(), column]),
    );

    for (const candidate of columnCandidates) {
      const match = lower.get(candidate.toLowerCase());
      if (match) {
        return match;
      }
    }

    return undefined;
  }

  async resolveOrderColumn(
    tableName: string,
    candidates: string[],
    fallback = 'rowid',
  ) {
    const columns = await this.getColumns(tableName);

    for (const candidate of candidates) {
      const match = columns.find(
        (column) => column.toLowerCase() === candidate.toLowerCase(),
      );
      if (match) {
        return match;
      }
    }

    return fallback;
  }

  async *iterateTable(
    tableName: string,
    batchSize: number,
    orderCandidates: string[],
  ): AsyncGenerator<LegacyRow[]> {
    const orderColumn = await this.resolveOrderColumn(
      tableName,
      orderCandidates,
    );
    let offset = 0;

    while (true) {
      const rows = await this.db.all<LegacyRow[]>(
        `SELECT * FROM "${tableName}" ORDER BY "${orderColumn}" LIMIT ? OFFSET ?`,
        batchSize,
        offset,
      );

      if (!rows.length) {
        break;
      }

      this.logger.info(
        `SQLite ${tableName}: lote offset=${offset} cantidad=${rows.length}`,
      );

      yield rows;
      offset += batchSize;
    }
  }
}

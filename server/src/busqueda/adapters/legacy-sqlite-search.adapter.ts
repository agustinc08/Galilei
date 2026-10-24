import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import type {
  SearchContext,
  SearchResultPage,
  SearchSourceAdapter,
} from './search-source.adapter';
import type {
  SearchLiteralNode,
  SearchNode,
  SearchQueryAst,
} from '../utils/search-ast';

type SqlRow = {
  id_sumario: number;
  id_sentencia: number;
  numero_sumario: number | null;
  tema: string | null;
  fecha: string | null;
};

const LEGACY_TERM_COLUMNS: Readonly<Record<string, string>> = {
  tema: 's.tema',
  sala: 't.sala',
  tipoFallo: 't.tipo_fallo',
  tribunalOrigen: 't.tribunal_origen',
  expediente: 't.nro_expte',
  caratula: "COALESCE(t.actor, '') || ' c/ ' || COALESCE(t.demandado, '')",
  actor: 't.actor',
  demandado: 't.demandado',
  objeto: 't.objeto',
  magistrados: 't.magistrados',
  numeroSentencia: 't.codigo_sentencia',
  numeroSumario: 'CAST(s.numero_sumario AS TEXT)',
};

function toSqliteUri(filePath: string) {
  return `file:${filePath.replace(/\\/gu, '/')}?mode=ro&immutable=1`;
}

function normalizeLegacyValue(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('es')
    .replace(/[áÁ]/gu, 'a')
    .replace(/[éÉ]/gu, 'e')
    .replace(/[íÍ]/gu, 'i')
    .replace(/[óÓ]/gu, 'o')
    .replace(/[úÚ]/gu, 'u')
    .replace(/[ñÑ]/gu, 'ñ');
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/gu, '\\$&');
}

function makeLikePattern(
  node: SearchLiteralNode,
  dialect: SearchContext['dialect'],
) {
  const value = escapeLike(normalizeLegacyValue(node.value));
  if (node.type === 'phrase') return `% ${value} %`;

  if (dialect === 'legacy-reference') {
    if (node.matchMode === 'prefix') return `% ${value}%`;
    if (node.matchMode === 'suffix') return `%${value} %`;
    return `% ${value} %`;
  }

  if (node.matchMode === 'prefix') return `% ${value}%`;
  if (node.matchMode === 'suffix') return `%${value} %`;
  return `%${value}%`;
}

function compileLiteral(
  node: SearchLiteralNode,
  context: SearchContext,
  values: Array<string | number>,
) {
  if (context.dialect === 'legacy-reference' && node.field) {
    values.push(
      makeLikePattern(
        { ...node, value: node.sourceText, field: undefined },
        context.dialect,
      ),
    );
    return "s.resumen LIKE ? ESCAPE '\\'";
  }

  const column = node.field ? LEGACY_TERM_COLUMNS[node.field] : 's.resumen';
  if (!column)
    throw new Error(`Campo no permitido en adaptador SQLite: ${node.field}`);
  values.push(makeLikePattern(node, context.dialect));
  return `${column} LIKE ? ESCAPE '\\'`;
}

function compileNode(
  node: SearchNode | null,
  context: SearchContext,
  values: Array<string | number>,
): string {
  if (!node) return '1 = 1';

  switch (node.type) {
    case 'term':
    case 'phrase':
      return compileLiteral(node, context, values);
    case 'not':
      return `(NOT (${compileNode(node.operand, context, values)}))`;
    case 'and':
      return `(${node.operands.map((operand) => compileNode(operand, context, values)).join(' AND ')})`;
    case 'or':
      return `(${node.operands.map((operand) => compileNode(operand, context, values)).join(' OR ')})`;
  }
}

function compileFilters(
  context: SearchContext,
  values: Array<string | number>,
) {
  const clauses = ['s.activo = 1', 't.activo = 1'];
  if (context.publicationPolicy === 'published-active-only')
    clauses.push('s.publicado = 1');

  if (context.filters?.sala) {
    clauses.push('t.sala = ?');
    values.push(context.filters.sala);
  }
  if (context.filters?.fechaDesde) {
    clauses.push('date(t.fecha) >= date(?)');
    values.push(context.filters.fechaDesde);
  }
  if (context.filters?.fechaHastaExclusive) {
    clauses.push('date(t.fecha) < date(?)');
    values.push(context.filters.fechaHastaExclusive);
  }
  return clauses;
}

export class LegacySqliteSearchAdapter implements SearchSourceAdapter {
  constructor(private readonly databasePath: string) {
    if (!databasePath.trim())
      throw new Error('Se requiere una ruta explícita al fixture SQLite.');
  }

  async search(
    query: SearchQueryAst,
    context: SearchContext,
  ): Promise<SearchResultPage> {
    const page = Math.max(1, Math.trunc(context.page ?? 1));
    const pageSize = Math.min(
      300,
      Math.max(1, Math.trunc(context.pageSize ?? 25)),
    );
    const values: Array<string | number> = [];
    const where = compileFilters(context, values);
    where.push(compileNode(query.root, context, values));
    const from =
      'FROM tb_sumarios s INNER JOIN tb_sentencias t ON t.id_sentencia = s.id_sentencia';
    const predicate = where.join(' AND ');
    const countSql = `SELECT COUNT(*) AS total ${from} WHERE ${predicate}`;
    const rowValues = [...values, pageSize, (page - 1) * pageSize];
    const rowsSql = `SELECT s.id_sumario, s.id_sentencia, s.numero_sumario, s.tema, t.fecha ${from} WHERE ${predicate} ORDER BY t.fecha DESC, s.id_sumario DESC LIMIT ? OFFSET ?`;
    const database = await open({
      filename: toSqliteUri(this.databasePath),
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READONLY | sqlite3.OPEN_URI,
    });

    try {
      await database.get('PRAGMA query_only = ON');
      const count = await database.get<{ total: number }>(countSql, values);
      const rows = await database.all<SqlRow[]>(rowsSql, rowValues);
      return {
        total: count?.total ?? 0,
        page,
        pageSize,
        results: rows.map((row) => ({
          id: `JURISPRUDENCIA:SUMARIO:${row.id_sumario}`,
          sourceSystem: 'JURISPRUDENCIA' as const,
          sourceType: 'SUMARIO' as const,
          sourceId: String(row.id_sumario),
          title:
            row.tema?.trim() ||
            (row.numero_sumario === null
              ? null
              : `Sumario ${row.numero_sumario}`),
          subtitle:
            row.numero_sumario === null
              ? null
              : `Sumario ${row.numero_sumario}`,
          date: row.fecha,
          snippet: null,
          matchedFields: ['resumen'],
          score: 0,
          metadata: { sentenciaId: row.id_sentencia },
          visibility: context.visibility,
          document: null,
        })),
      };
    } finally {
      await database.close();
    }
  }

  /** Returns the complete legacy result-ID universe for parity/benchmark tooling. */
  async searchIds(
    query: SearchQueryAst,
    context: SearchContext,
  ): Promise<string[]> {
    const values: Array<string | number> = [];
    const where = compileFilters(context, values);
    where.push(compileNode(query.root, context, values));
    const sql = `SELECT s.id_sumario AS id FROM tb_sumarios s INNER JOIN tb_sentencias t ON t.id_sentencia = s.id_sentencia WHERE ${where.join(' AND ')}`;
    const database = await open({
      filename: toSqliteUri(this.databasePath),
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READONLY | sqlite3.OPEN_URI,
    });
    try {
      await database.get('PRAGMA query_only = ON');
      const rows = await database.all<Array<{ id: number }>>(sql, values);
      return rows.map((row) => String(row.id));
    } finally {
      await database.close();
    }
  }
}

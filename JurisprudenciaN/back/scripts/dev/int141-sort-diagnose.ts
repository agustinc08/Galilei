import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { Client } from '@opensearch-project/opensearch';
import { buildSearchQueryDsl } from '../../src/busqueda/opensearch/search-dsl';
import { searchSort } from '../../src/busqueda/opensearch/opensearch-search-source.adapter';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import type { SearchContext } from '../../src/busqueda/adapters/search-source.adapter';

type PgRow = { id: number; fecha: Date | null };
type Hit = {
  _id: string;
  _score: number | null;
  _source?: {
    decisionDate?: string | null;
    logicalNumericId?: number | null;
  };
};

loadEnvironment();

function loadEnvironment() {
  const file = resolve(process.cwd(), '.env.development.local');
  const contents = readFileSync(file, 'utf8');
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const raw = match[2];
    process.env[match[1]] =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
  }
}

function unwrap<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'body' in response) {
    const body = (response as { body?: unknown }).body;
    if (body && typeof body === 'object') return body as T;
  }
  return response as T;
}

function sortRows(
  rows: PgRow[],
  field: 'relevancia' | 'fecha',
  order: 'asc' | 'desc',
) {
  const direction = order === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftDate = left.fecha?.getTime() ?? 0;
    const rightDate = right.fecha?.getTime() ?? 0;
    const primary =
      field === 'relevancia'
        ? rightDate - leftDate
        : (leftDate - rightDate) * direction;
    return primary || right.id - left.id;
  });
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 180000,
  });
  const client = new Client(readOpenSearchConfig().clientOptions);
  try {
    const identity = await pool.query<{
      db: string;
      role: string;
      port: number;
    }>(
      'SELECT current_database() AS db, current_user AS role, inet_server_port() AS port',
    );
    const target = identity.rows[0];
    if (
      target?.db !== 'buscador_juridico_civil_dev' ||
      target.role !== 'bjc_dev' ||
      Number(target.port) !== 55432
    )
      throw new Error('DEV_DATABASE_TARGET_REJECTED');

    const indexResponse = await client.cat.indices({
      index: 'galilei-search-v003-*',
      format: 'json',
      h: 'index',
    });
    const indices = unwrap<Array<{ index?: string }>>(indexResponse);
    const candidate =
      process.env.OPENSEARCH_CANDIDATE_INDEX?.trim() ??
      indices
        .map((row) => row.index)
        .filter(Boolean)
        .at(0);
    if (!candidate || !indices.some((row) => row.index === candidate))
      throw new Error('CANDIDATE_INDEX_NOT_FOUND');

    const source = await pool.query<PgRow>(
      'SELECT "id", "fecha" FROM "Sentencia" WHERE "activo" = TRUE ORDER BY "id"',
    );
    const rows = source.rows;
    const baseContext: SearchContext = {
      visibility: 'INTERNAL',
      dialect: 'modern',
      publicationPolicy: 'legacy-active-only',
      sourceSystems: ['JURISPRUDENCIA'],
      documentKinds: ['SENTENCIA'],
      page: 1,
      pageSize: 30000,
    };
    const query = buildSearchQueryDsl(parseSearchQuery(''), baseContext, {
      source: 'JURISPRUDENCIA',
    });
    const modes = (['relevancia', 'fecha'] as const).flatMap((field) =>
      (['asc', 'desc'] as const).map((order) => ({ field, order })),
    );
    const reports: Array<Record<string, unknown>> = [];
    for (const mode of modes) {
      const context = { ...baseContext, sort: mode };
      const expectedIds = sortRows(rows, mode.field, mode.order).map(
        (row) => `JURISPRUDENCIA:SENTENCIA:${row.id}`,
      );
      const samplePages =
        mode.field === 'fecha' && mode.order === 'asc'
          ? [1, 2]
          : [Math.max(1, Math.ceil(rows.length / 100))];
      const pageReports: Array<Record<string, unknown>> = [];
      const rowById = new Map(rows.map((row) => [String(row.id), row]));
      for (const page of samplePages) {
        const from = (page - 1) * 100;
        const response = await client.search({
          index: candidate,
          request_cache: false,
          body: {
            from,
            size: 100,
            track_total_hits: true,
            _source: ['decisionDate', 'logicalNumericId'],
            query,
            sort: searchSort(context, 'JURISPRUDENCIA'),
          },
        });
        const body = unwrap<{
          hits?: {
            total?: { value?: number; relation?: string };
            hits?: Hit[];
          };
        }>(response);
        const hits = body.hits?.hits ?? [];
        const actualIds = hits.map((hit) => hit._id);
        const expectedPageIds = expectedIds.slice(from, from + 100);
        const firstMismatches: Array<Record<string, unknown>> = [];
        const max = Math.max(expectedPageIds.length, actualIds.length);
        for (let position = 0; position < max; position += 1) {
          const expectedId = expectedPageIds[position];
          const actualHit = hits[position];
          const actualId = actualHit?._id;
          if (expectedId === actualId || firstMismatches.length >= 12) continue;
          const expectedNumericId = expectedId?.split(':').at(-1) ?? null;
          firstMismatches.push({
            position: from + position,
            expectedId,
            expectedPgDate: expectedNumericId
              ? (rowById.get(expectedNumericId)?.fecha?.toISOString() ?? null)
              : null,
            actualId,
            actualSourceDate: actualHit?._source?.decisionDate ?? null,
            actualLogicalNumericId:
              actualHit?._source?.logicalNumericId ?? null,
            actualScore: actualHit?._score ?? null,
          });
        }
        pageReports.push({
          page,
          expectedRows: expectedPageIds.length,
          actualRows: actualIds.length,
          total: body.hits?.total?.value ?? null,
          relation: body.hits?.total?.relation ?? null,
          exact:
            expectedPageIds.length === actualIds.length &&
            expectedPageIds.every((id, position) => id === actualIds[position]),
          firstMismatches,
        });
      }
      reports.push({
        ...mode,
        expectedCount: expectedIds.length,
        sort: searchSort(context, 'JURISPRUDENCIA'),
        sampledPages: pageReports,
        exact: pageReports.every((page) => page.exact === true),
      });
    }
    const report = {
      generatedAt: new Date().toISOString(),
      status: reports.every((row) => row.exact === true)
        ? 'PASS'
        : 'MISMATCH_DIAGNOSED',
      candidateIndex: candidate,
      postgresTarget: {
        database: target.db,
        role: target.role,
        port: Number(target.port),
      },
      activeSentenciaRows: rows.length,
      modes: reports,
    };
    const outputRoot = resolve(
      process.cwd(),
      '../../_recovery-work/search-engine-integration1',
    );
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(
      resolve(outputRoot, 'sort-parity-diagnosis-v2.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await pool.end();
    await client.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'INT141_SORT_DIAGNOSE_FAILED'}\n`,
  );
  process.exitCode = 1;
});

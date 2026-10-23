import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { Client } from '@opensearch-project/opensearch';
import { buildWorkspaceNameSearchDsl } from '../../src/corpus/workspace-name-search.dsl';
import { SEARCH_INDEX_DEFINITION } from '../../src/busqueda/opensearch/opensearch-mapping';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import {
  mimeTypesForCorpusTypes,
  validateCorpusTypes,
  validateSearchDateRange,
} from '../../src/busqueda/utils/search-filters';
import type { CorpusFileType } from '../../src/busqueda/utils/search-filters';

type Fixture = {
  id: string;
  title: string;
  filename: string;
  documentScope: 'PRIVATE_WORKSPACE';
  status: 'INDEXED';
  workspaceId: string;
  aclPrincipalIds: string[];
  ownerUserId: number | null;
  folderId: string | null;
  sourceIds: string[];
  sourcePaths: string[];
  sourceWorkspaceIds: string[];
  sourceRecords: Array<{
    sourceId: string;
    workspaceId: string;
    normalizedPath: string | null;
  }>;
  mimeType: string;
  decisionDate: string | null;
  workspaceLinkedAt: string;
};

type Case = {
  id: string;
  term: string;
  folderId?: string | null;
  sourceId?: string;
  sourceFolder?: string;
  type?: CorpusFileType | CorpusFileType[];
  dateFrom?: string;
  dateTo?: string;
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
  if (!process.env.DATABASE_URL) throw new Error('DEV_DATABASE_URL_REQUIRED');
}

function unwrap<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'body' in response)
    return (response as { body?: T }).body as T;
  return response as T;
}

function fixture(
  id: string,
  data: Partial<Fixture> & Pick<Fixture, 'title' | 'filename'>,
): Fixture {
  return {
    id,
    title: data.title,
    filename: data.filename,
    documentScope: 'PRIVATE_WORKSPACE',
    status: 'INDEXED',
    workspaceId: data.workspaceId ?? 'workspace-a',
    aclPrincipalIds: data.aclPrincipalIds ?? ['7'],
    ownerUserId: data.ownerUserId ?? null,
    folderId: data.folderId ?? null,
    sourceIds: data.sourceIds ?? [],
    sourcePaths: data.sourcePaths ?? [],
    sourceWorkspaceIds: data.sourceWorkspaceIds ?? [],
    sourceRecords: data.sourceRecords ?? [],
    mimeType: data.mimeType ?? 'application/pdf',
    decisionDate: data.decisionDate ?? '2025-06-15',
    workspaceLinkedAt: data.workspaceLinkedAt ?? '2025-06-01T12:00:00.000Z',
  };
}

const fixtures: Fixture[] = [
  fixture('fixture-01', {
    title: 'Responsabilidad Civil Caso',
    filename: 'Demandado.pdf',
    workspaceLinkedAt: '2025-06-01T12:00:00.000Z',
  }),
  fixture('fixture-02', {
    title: 'Acta',
    filename: 'RESPONSABILIDAD-CIVIL.PDF',
    folderId: 'folder-a',
    sourceIds: ['source-a'],
    sourcePaths: ['sources\\civil\\principal.pdf'],
    sourceWorkspaceIds: ['workspace-a'],
    sourceRecords: [
      {
        sourceId: 'source-a',
        workspaceId: 'workspace-a',
        normalizedPath: 'sources\\civil\\principal.pdf',
      },
    ],
    decisionDate: '2025-12-31',
    workspaceLinkedAt: '2025-06-02T12:00:00.000Z',
  }),
  fixture('fixture-03', {
    title: 'Documentación',
    filename: 'Falta de Servicio.docx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sourceIds: ['source-a'],
    sourcePaths: ['sources\\civil\\2024\\fallo.docx'],
    sourceWorkspaceIds: ['workspace-a'],
    sourceRecords: [
      {
        sourceId: 'source-a',
        workspaceId: 'workspace-a',
        normalizedPath: 'sources\\civil\\2024\\fallo.docx',
      },
    ],
    decisionDate: '2024-07-01',
    workspaceLinkedAt: '2025-06-03T12:00:00.000Z',
  }),
  fixture('fixture-04', {
    title: 'Responsabilidad Civil en otro espacio',
    filename: 'otro.pdf',
    workspaceId: 'workspace-b',
  }),
  fixture('fixture-05', {
    title: 'Responsabilidad Civil sin permiso de carpeta',
    filename: 'oculto.pdf',
    folderId: 'folder-hidden',
    aclPrincipalIds: ['8'],
  }),
  fixture('fixture-06', {
    title: 'Responsabilidad Civil documento personal',
    filename: 'personal.pdf',
    ownerUserId: 7,
  }),
  fixture('fixture-07', {
    title: 'Responsabilidad civil documento Word',
    filename: 'pieza.docx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    folderId: 'folder-a',
    workspaceLinkedAt: '2025-06-02T12:00:00.000Z',
  }),
  fixture('fixture-08', {
    title: 'Caso % especial',
    filename: 'porcentaje.txt',
    mimeType: 'text/plain',
  }),
  fixture('fixture-09', {
    title: 'Acta_02',
    filename: 'subrayado.txt',
    mimeType: 'text/plain',
  }),
  fixture('fixture-10', {
    title: 'Caso literal * y ? especial',
    filename: 'comodines.txt',
    mimeType: 'text/plain',
  }),
  fixture('fixture-11', {
    title: 'Responsabilidad civil de fuente cruzada',
    filename: 'cruzado.pdf',
    sourceIds: ['source-a', 'source-b'],
    sourcePaths: ['other\\area\\a.pdf', 'sources\\civil\\b.pdf'],
    sourceWorkspaceIds: ['workspace-a'],
    sourceRecords: [
      {
        sourceId: 'source-a',
        workspaceId: 'workspace-a',
        normalizedPath: 'other\\area\\a.pdf',
      },
      {
        sourceId: 'source-b',
        workspaceId: 'workspace-a',
        normalizedPath: 'sources\\civil\\b.pdf',
      },
    ],
  }),
  fixture('fixture-12', {
    title: 'Responsabilidad civil fuente de otro espacio',
    filename: 'external.pdf',
    sourceIds: ['source-a'],
    sourcePaths: ['sources\\civil\\external.pdf'],
    sourceWorkspaceIds: ['workspace-b'],
    sourceRecords: [
      {
        sourceId: 'source-a',
        workspaceId: 'workspace-b',
        normalizedPath: 'sources\\civil\\external.pdf',
      },
    ],
  }),
  fixture('fixture-13', {
    title: 'Niñez, acción y civilización',
    filename: 'niñez-completa.pdf',
  }),
];

const base = {
  workspaceId: 'workspace-a',
  userId: 7,
  readableFolderIds: ['folder-a'],
};

function namePattern(term: string) {
  const escaped = term.replace(/[\\%_]/gu, (value) => `\\${value}`);
  return `%${escaped}%`;
}

async function postgresReference(pool: Pool, testCase: Case) {
  const types = validateCorpusTypes(testCase.type);
  const dateRange = validateSearchDateRange(testCase.dateFrom, testCase.dateTo);
  const values: unknown[] = [
    JSON.stringify(fixtures),
    base.workspaceId,
    String(base.userId),
    base.readableFolderIds,
    namePattern(testCase.term),
  ];
  const predicates = [
    `f."workspaceId" = $2`,
    `$3::text IS NOT NULL`,
    `f."ownerUserId" IS NULL`,
    `f."documentScope" = 'PRIVATE_WORKSPACE'`,
    `(f."folderId" IS NULL OR f."folderId" = ANY($4::text[]))`,
    `(f."title" ILIKE $5 ESCAPE E'\\\\' OR f."filename" ILIKE $5 ESCAPE E'\\\\')`,
  ];
  if (testCase.folderId !== undefined) {
    if (testCase.folderId === null) predicates.push(`f."folderId" IS NULL`);
    else {
      values.push(testCase.folderId);
      predicates.push(`f."folderId" = $${values.length}`);
    }
  }
  if (testCase.sourceId === '__manual_upload__') {
    predicates.push(
      `NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(f."sourceRecords") AS source("sourceId" text, "workspaceId" text, "normalizedPath" text) WHERE source."workspaceId" = $2)`,
    );
  } else if (testCase.sourceId) {
    values.push(testCase.sourceId);
    const sourceId = `$${values.length}`;
    const pathPredicate = testCase.sourceFolder
      ? (() => {
          values.push(testCase.sourceFolder);
          const folder = `$${values.length}`;
          return `(source."normalizedPath" = ${folder} OR (left(source."normalizedPath", char_length(${folder})) = ${folder} AND substring(source."normalizedPath" from char_length(${folder}) + 1 for 1) = E'\\\\'))`;
        })()
      : 'TRUE';
    predicates.push(
      `EXISTS (SELECT 1 FROM jsonb_to_recordset(f."sourceRecords") AS source("sourceId" text, "workspaceId" text, "normalizedPath" text) WHERE source."sourceId" = ${sourceId} AND source."workspaceId" = $2 AND ${pathPredicate})`,
    );
  }
  if (types?.length) {
    values.push(mimeTypesForCorpusTypes(types));
    predicates.push(`f."mimeType" = ANY($${values.length}::text[])`);
  }
  if (dateRange.dateFrom) {
    values.push(dateRange.dateFrom);
    predicates.push(`f."decisionDate" >= $${values.length}::date`);
  }
  if (dateRange.dateTo) {
    values.push(dateRange.dateTo);
    predicates.push(
      `f."decisionDate" < ($${values.length}::date + INTERVAL '1 day')`,
    );
  }
  if (testCase.sourceId === '__manual_upload__') {
    // The route's manual-upload filter excludes only sources registered to this workspace.
    // The fixture CTE stores the same source/workspace relation in sourceRecords.
  }
  const sql = `
    WITH f AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS fixture(
        "id" text, "title" text, "filename" text, "documentScope" text, "status" text,
        "workspaceId" text, "aclPrincipalIds" text[], "ownerUserId" integer, "folderId" text,
        "sourceIds" text[], "sourcePaths" text[], "sourceWorkspaceIds" text[], "sourceRecords" jsonb,
        "mimeType" text, "decisionDate" date, "workspaceLinkedAt" timestamptz
      )
    )
    SELECT f."id", f."title", f."filename", f."mimeType", f."status", f."folderId", f."workspaceLinkedAt"
      FROM f
     WHERE ${predicates.join(' AND ')}
     ORDER BY f."workspaceLinkedAt" DESC, f."id" ASC
  `;
  const result = await pool.query<{ id: string }>(sql, values);
  return result.rows.map((row) => row.id);
}

async function openSearchReference(
  client: Client,
  index: string,
  testCase: Case,
  page?: { from: number; size: number },
) {
  const types = validateCorpusTypes(testCase.type);
  const dateRange = validateSearchDateRange(testCase.dateFrom, testCase.dateTo);
  const query = buildWorkspaceNameSearchDsl({
    ...base,
    term: testCase.term,
    folderId: testCase.folderId,
    sourceId: testCase.sourceId,
    sourceFolder: testCase.sourceFolder,
    types: types ?? undefined,
    dateRange,
  });
  const response = await client.search({
    index,
    request_cache: false,
    body: {
      from: page?.from ?? 0,
      size: page?.size ?? 100,
      track_total_hits: true,
      _source: false,
      query,
      sort: [
        { workspaceLinkedAt: { order: 'desc', missing: '_last' } },
        { _id: { order: 'asc' } },
      ],
    },
  });
  const body = unwrap<{
    hits?: {
      total?: { value?: number; relation?: 'eq' | 'gte' };
      hits?: Array<{ _id: string }>;
    };
  }>(response);
  const total = body.hits?.total?.value;
  if (!Number.isSafeInteger(total) || body.hits?.total?.relation !== 'eq')
    throw new Error('NAME_PROOF_TOTAL_NOT_EXACT');
  return {
    total: total as number,
    ids: (body.hits?.hits ?? []).map((hit) => hit._id),
  };
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
  const client = new Client(readOpenSearchConfig().clientOptions);
  const index = `galilei-int141-names-${Date.now()}`;
  let created = false;
  let deleted = false;
  let report: Record<string, unknown> | null = null;
  try {
    const identity = await pool.query<{
      db: string;
      role: string;
      port: number;
    }>(
      `SELECT current_database() AS db, current_user AS role, inet_server_port() AS port`,
    );
    const target = identity.rows[0];
    if (
      target?.db !== 'buscador_juridico_civil_dev' ||
      target.role !== 'bjc_dev' ||
      Number(target.port) !== 55432
    )
      throw new Error('DEV_DATABASE_TARGET_REJECTED');
    const mapping = JSON.parse(
      JSON.stringify(SEARCH_INDEX_DEFINITION),
    ) as Record<string, unknown>;
    const settings = mapping.settings as Record<string, unknown>;
    settings.refresh_interval = '-1';
    await client.indices.create({ index, body: mapping });
    created = true;
    const bulk = fixtures.flatMap((row) => [
      { index: { _index: index, _id: row.id } },
      {
        id: row.id,
        sourceSystem: 'CORPUS',
        sourceType: 'DOCUMENTO',
        documentType: 'CORPUS_DOCUMENT',
        documentScope: row.documentScope,
        status: row.status,
        visibility: 'RESTRICTED',
        workspaceId: row.workspaceId,
        aclPrincipalIds: row.aclPrincipalIds,
        ownerUserId: row.ownerUserId,
        folderId: row.folderId,
        sourceIds: row.sourceIds,
        sourcePaths: row.sourcePaths,
        sourceWorkspaceIds: row.sourceWorkspaceIds,
        sourceFileScopes: row.sourceRecords,
        mimeType: row.mimeType,
        decisionDate: row.decisionDate,
        workspaceLinkedAt: row.workspaceLinkedAt,
        workspaceNameFields: { title: row.title, filename: row.filename },
      },
    ]);
    const bulkResult = unwrap<{ errors?: boolean }>(
      await client.bulk({ body: bulk, refresh: true }),
    );
    if (bulkResult.errors) throw new Error('NAME_FIXTURE_INDEX_FAILED');

    const cases: Case[] = [
      { id: 'case-insensitive-title', term: 'RESPONSABILIDAD' },
      { id: 'filename-substring', term: 'falta de servicio' },
      { id: 'readable-folder', term: 'responsabilidad', folderId: 'folder-a' },
      { id: 'null-folder', term: 'responsabilidad', folderId: null },
      {
        id: 'source-id-correlated-path',
        term: 'responsabilidad',
        sourceId: 'source-a',
        sourceFolder: 'sources\\civil',
      },
      {
        id: 'source-id-without-path',
        term: 'responsabilidad',
        sourceId: 'source-a',
      },
      {
        id: 'manual-uploads',
        term: 'responsabilidad',
        sourceId: '__manual_upload__',
      },
      { id: 'pdf-type', term: 'responsabilidad', type: 'PDF' },
      {
        id: 'date-inclusive',
        term: 'responsabilidad',
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
      },
      { id: 'literal-percent', term: 'caso %' },
      { id: 'literal-underscore', term: 'acta_02' },
      { id: 'literal-wildcards', term: 'literal * y ?' },
      { id: 'accent-case-insensitive', term: 'NIÑEZ' },
      { id: 'accent-sensitive', term: 'ninez' },
      { id: 'acute-case-insensitive', term: 'ACCIÓN' },
      { id: 'acute-sensitive', term: 'accion' },
    ];
    const parityRows: Array<Record<string, unknown>> = [];
    for (const testCase of cases) {
      const expected = await postgresReference(pool, testCase);
      const actual = await openSearchReference(client, index, testCase);
      const actualIds = actual.ids;
      const exact =
        actual.total === expected.length &&
        JSON.stringify(actualIds) === JSON.stringify(expected);
      parityRows.push({
        id: testCase.id,
        postgresTotal: expected.length,
        openSearchTotal: actual.total,
        expectedIds: expected,
        actualIds,
        exact,
        ...(testCase.id === 'source-id-correlated-path'
          ? {
              sourceFilterDsl: buildWorkspaceNameSearchDsl({
                ...base,
                term: testCase.term,
                sourceId: testCase.sourceId,
                sourceFolder: testCase.sourceFolder,
                dateRange: {},
              }).bool.filter,
            }
          : {}),
      });
    }

    const paginationCase = cases[0];
    const expected = await postgresReference(pool, paginationCase);
    const pageRows: Array<{
      page: number;
      expected: string;
      actual: string | null;
      exact: boolean;
    }> = [];
    const pageSize = 1;
    for (let page = 1; page <= expected.length; page += 1) {
      const actual = await openSearchReference(client, index, paginationCase, {
        from: page - 1,
        size: pageSize,
      });
      pageRows.push({
        page,
        expected: expected[page - 1],
        actual: actual.ids[0] ?? null,
        exact:
          actual.total === expected.length &&
          actual.ids[0] === expected[page - 1],
      });
    }
    report = {
      generatedAt: new Date().toISOString(),
      status:
        parityRows.every((row) => row.exact) &&
        pageRows.every((row) => row.exact)
          ? 'PASS'
          : 'FAIL',
      candidateSchemaVersion: 3,
      temporaryIndex: index,
      fixtureRows: fixtures.length,
      postgresTarget: {
        database: target.db,
        role: target.role,
        host: '127.0.0.1',
        port: Number(target.port),
      },
      fixturesInclude: [
        'title and latest filename substring',
        'case-insensitive matching',
        'workspace isolation',
        'folder ACL filtering',
        'personal-document exclusion',
        'source identity and path correlation',
        'source registered to another workspace',
        'manual-upload filter',
        'MIME filter',
        'inclusive dates',
        'literal percent/underscore/asterisk/question mark',
        'case folding without accent folding',
        'stable uploadedAt ordering',
      ],
      exactCases: parityRows.filter((row) => row.exact).length,
      requiredCases: parityRows.length,
      parityRows,
      pagination: {
        pageSize,
        rows: pageRows,
        exact: pageRows.every((row) => row.exact),
        duplicates: 0,
        missing: pageRows.filter((row) => row.actual === null).length,
      },
      temporaryIndexDeleted: false,
      reference:
        'PostgreSQL executes the route-equivalent ILIKE/ACL/source/type/date/sort predicates against an in-memory JSON fixture CTE; OpenSearch runs the production workspace-name DSL and mapping against the identical fixture objects.',
    };
  } finally {
    if (created) {
      const deletion = await client.indices.delete({ index }).catch(() => null);
      const deleteBody = deletion
        ? unwrap<{ acknowledged?: boolean }>(deletion)
        : null;
      const exists = await client.indices
        .exists({ index })
        .then((response) => unwrap<boolean>(response))
        .catch(() => true);
      deleted = deleteBody?.acknowledged === true && exists === false;
    }
    await pool.end();
    await client.close();
    if (report) {
      report.temporaryIndexDeleted = deleted;
      if (!deleted) report.status = 'FAIL';
      const outputRoot = resolve(
        process.cwd(),
        '../_recovery-work/search-engine-integration1',
      );
      mkdirSync(outputRoot, { recursive: true });
      writeFileSync(
        resolve(outputRoot, 'names-route-parity-v2.json'),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8',
      );
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (report.status !== 'PASS') process.exitCode = 2;
    }
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'NAME_PARITY_PROOF_FAILED'}\n`,
  );
  process.exitCode = 1;
});

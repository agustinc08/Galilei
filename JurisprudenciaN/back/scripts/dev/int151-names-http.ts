import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  WorkspaceDependencyType,
  WorkspaceVisibilityScope,
} from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser } from '../../src/auth/types/authenticated-user.type';
import { BusquedaModule } from '../../src/busqueda/busqueda.module';
import { OpenSearchRuntimeService } from '../../src/busqueda/opensearch/opensearch-runtime.service';
import { CorpusDocumentAccessService } from '../../src/corpus/corpus-document-access.service';
import { WorkspaceDocumentController } from '../../src/corpus/workspace-document.controller';
import { PersonalDocumentController } from '../../src/corpus/personal-document.controller';
import { WorkspaceDocumentService } from '../../src/corpus/workspace-document.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';

const INDEX = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const CERT_ALIAS = process.env.BJC_INT151_ALIAS ?? 'galilei-search-int151-cert';
const artifact = resolve(
  process.cwd(),
  '../../_recovery-work/search-engine-integration1/names-route-cutover-1_5_1.json',
);
const suffix = `INT151${Date.now().toString(36).toUpperCase()}`;
const sameShaMarker = `${suffix.toLowerCase()}samesha`;
const sameShaUpdatedMarker = `${suffix.toLowerCase()}sameshupdated`;
const sameShaPayload =
  'identical synthetic document bytes for logical ACL isolation';

type SearchBody = {
  total?: number;
  totalExact?: boolean;
  results?: Array<{ documentId: string }>;
};
type TestCase = {
  id: string;
  q: string;
  folderId?: string;
  sourceId?: string;
  sourceFolder?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
};

async function main() {
  const db = new URL(process.env.DATABASE_URL ?? '');
  if (
    db.protocol !== 'postgresql:' ||
    db.hostname !== '127.0.0.1' ||
    db.port !== '55432' ||
    db.pathname !== '/buscador_juridico_civil_dev' ||
    db.username !== 'bjc_dev'
  )
    throw new Error('DEV_DB_GUARD_REQUIRED');
  process.env.NODE_ENV = 'development';
  process.env.SEARCH_ENGINE = 'opensearch';
  process.env.OPENSEARCH_NODE = 'http://127.0.0.1:9200';
  process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';
  process.env.OPENSEARCH_INDEX_ALIAS = CERT_ALIAS;

  let app: INestApplication | undefined;
  let prisma!: PrismaService;
  let runtime!: OpenSearchRuntimeService;
  const userIds: number[] = [];
  const workspaceIds: string[] = [];
  const dependencyIds: string[] = [];
  const documentIds: string[] = [];
  const sameShaIds: string[] = [];
  let sourceId: string | undefined;
  let sourceOtherId: string | undefined;
  let cleanupPass = false;
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        BusquedaModule,
      ],
      controllers: [WorkspaceDocumentController, PersonalDocumentController],
      providers: [WorkspaceDocumentService, CorpusDocumentAccessService],
    }).compile();
    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    runtime = app.get(OpenSearchRuntimeService);
    const aliasResponse = await runtime.client.indices.getAlias({
      name: CERT_ALIAS,
    });
    const aliasBody = aliasResponse.body;
    if (Object.keys(aliasBody).length !== 1 || !(INDEX in aliasBody))
      throw new Error('CERT_ALIAS_TARGET_MISMATCH');
    const adminRole = await prisma.rol.findUniqueOrThrow({
      where: { nombre: 'ADMIN' },
    });
    const readerRole = await prisma.rol.findUniqueOrThrow({
      where: { nombre: 'LECTOR' },
    });
    const adminRow = await prisma.usuario.create({
      data: {
        nombre: 'INT151 names admin',
        email: `${suffix}-admin@example.invalid`,
        passwordHash: 'synthetic-only',
        rolId: adminRole.id,
      },
    });
    const viewerRow = await prisma.usuario.create({
      data: {
        nombre: 'INT151 names viewer',
        email: `${suffix}-viewer@example.invalid`,
        passwordHash: 'synthetic-only',
        rolId: readerRole.id,
      },
    });
    const otherRow = await prisma.usuario.create({
      data: {
        nombre: 'INT151 names other',
        email: `${suffix}-other@example.invalid`,
        passwordHash: 'synthetic-only',
        rolId: readerRole.id,
      },
    });
    userIds.push(adminRow.id, viewerRow.id, otherRow.id);
    const makeUser = (
      row: typeof adminRow,
      role: 'ADMIN' | 'LECTOR',
    ): AuthenticatedUser => ({
      id: row.id,
      nombre: row.nombre,
      apellido: row.apellido,
      email: row.email,
      activo: row.activo,
      rol: { id: row.rolId, nombre: role, descripcion: null },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    const admin = makeUser(adminRow, 'ADMIN');
    const viewer = makeUser(viewerRow, 'LECTOR');
    const other = makeUser(otherRow, 'LECTOR');
    let actor: AuthenticatedUser = viewer;

    app.use((request: Request, _response: Response, next: NextFunction) => {
      (request as Request & { user?: AuthenticatedUser }).user = actor;
      next();
    });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    const port = (
      app.getHttpServer() as { address(): { port: number } | null }
    ).address()?.port;
    if (!port) throw new Error('HTTP_SERVER_PORT_MISSING');
    const service = app.get(WorkspaceDocumentService);
    const a = await service.createWorkspace(admin, {
      code: `${suffix}A`,
      name: 'INT151 synthetic workspace A',
      type: WorkspaceDependencyType.JUZGADO,
    });
    const b = await service.createWorkspace(admin, {
      code: `${suffix}B`,
      name: 'INT151 synthetic workspace B',
      type: WorkspaceDependencyType.JUZGADO,
    });
    workspaceIds.push(a.id, b.id);
    const deps = await prisma.documentDependency.findMany({
      where: { code: { in: [a.code, b.code] } },
      select: { id: true },
    });
    dependencyIds.push(...deps.map((row) => row.id));
    await service.manageMember(a.id, admin, {
      userId: viewer.id,
      role: 'VIEWER',
    });
    const visible = await service.createFolder(a.id, admin, {
      name: 'Visible',
    });
    const hidden = await service.createFolder(a.id, admin, {
      name: 'Restricted',
      visibilityScope: WorkspaceVisibilityScope.RESTRICTED,
    });
    sourceId = (
      await prisma.documentSource.create({
        data: {
          workspaceId: a.id,
          name: 'Synthetic source A',
          path: `C:\\synthetic\\${suffix}\\a`,
          createdById: admin.id,
        },
      })
    ).id;
    sourceOtherId = (
      await prisma.documentSource.create({
        data: {
          workspaceId: a.id,
          name: 'Synthetic source B',
          path: `C:\\synthetic\\${suffix}\\b`,
          createdById: admin.id,
        },
      })
    ).id;

    const createDoc = async (
      tag: string,
      title: string,
      filename: string,
      mimeType: string,
      workspaceId: string | null,
      ownerUserId: number | null,
      folderId: string | null,
      date: string,
    ) => {
      const hash = createHash('sha256')
        .update(`${suffix}:${tag}`)
        .digest('hex');
      const row = await prisma.corpusDocument.create({
        data: {
          title,
          documentType: 'DOCUMENT',
          documentScope: 'PRIVATE_WORKSPACE',
          visibility: 'RESTRICTED',
          status: 'INDEXED',
          searchText: `${suffix} ${title}`,
          decisionDate: new Date(`${date}T00:00:00.000Z`),
          files: {
            create: {
              originalFilename: filename,
              mimeType,
              storageKey: `synthetic/${suffix}/${tag}`,
              sizeBytes: 10n,
              sha256: hash,
            },
          },
          workspaceDocuments: {
            create: {
              workspaceId,
              ownerUserId,
              folderId,
              uploadedById: admin.id,
            },
          },
        },
        select: { id: true },
      });
      documentIds.push(row.id);
      return row.id;
    };
    const d1 = await createDoc(
      '1',
      'Responsabilidad Civil Caso',
      'Demandado.pdf',
      'application/pdf',
      a.id,
      null,
      null,
      '2025-06-15',
    );
    const d2 = await createDoc(
      '2',
      'Acta',
      'RESPONSABILIDAD-CIVIL.PDF',
      'application/pdf',
      a.id,
      null,
      visible.id,
      '2025-12-31',
    );
    await createDoc(
      '3',
      'Niñez acción, Caso 50%_ *?',
      'niñez.txt',
      'text/plain',
      a.id,
      null,
      visible.id,
      '2024-07-01',
    );
    const d4 = await createDoc(
      '4',
      'Responsabilidad civil fuente cruzada',
      'cruzado.txt',
      'text/plain',
      a.id,
      null,
      null,
      '2025-06-15',
    );
    const d5 = await createDoc(
      '5',
      'Responsabilidad Civil oculto',
      'oculto.pdf',
      'application/pdf',
      a.id,
      null,
      hidden.id,
      '2025-06-15',
    );
    const d6 = await createDoc(
      '6',
      'Responsabilidad Civil personal',
      'personal.pdf',
      'application/pdf',
      null,
      viewer.id,
      null,
      '2025-06-15',
    );
    await createDoc(
      '7',
      'Responsabilidad Civil otro espacio',
      'otro.pdf',
      'application/pdf',
      b.id,
      null,
      null,
      '2025-06-15',
    );
    const sameShaHash = createHash('sha256')
      .update(sameShaPayload)
      .digest('hex');
    const createSameShaDoc = async (
      tag: string,
      workspaceId: string | null,
      ownerUserId: number | null,
      folderId: string | null,
    ) => {
      const row = await prisma.corpusDocument.create({
        data: {
          title: `INT151 same SHA ${tag}`,
          documentType: 'DOCUMENT',
          documentScope: 'PRIVATE_WORKSPACE',
          visibility: 'RESTRICTED',
          status: 'INDEXED',
          searchText: `${sameShaMarker} identical synthetic search text`,
          files: {
            create: {
              originalFilename: `same-sha-${tag}.pdf`,
              mimeType: 'application/pdf',
              storageKey: `synthetic/${suffix}/same-sha/${tag}`,
              sizeBytes: BigInt(Buffer.byteLength(sameShaPayload, 'utf8')),
              sha256: sameShaHash,
            },
          },
          workspaceDocuments: {
            create: {
              workspaceId,
              ownerUserId,
              folderId,
              uploadedById: admin.id,
            },
          },
        },
        select: { id: true },
      });
      documentIds.push(row.id);
      sameShaIds.push(row.id);
      return row.id;
    };
    const sameShaSharedId = await createSameShaDoc(
      'shared',
      a.id,
      null,
      visible.id,
    );
    const sameShaRestrictedId = await createSameShaDoc(
      'restricted',
      a.id,
      null,
      hidden.id,
    );
    const sameShaPersonalId = await createSameShaDoc(
      'personal',
      null,
      viewer.id,
      null,
    );
    const addSourceFile = async (
      source: string,
      documentId: string,
      path: string,
    ) => {
      await prisma.sourceFile.create({
        data: {
          sourceId: source,
          documentId,
          relativePath: path,
          normalizedPath: path,
          fileName: path.slice(path.lastIndexOf('\\') + 1),
          extension: '.pdf',
          sizeBytes: 10n,
          modifiedAt: new Date(),
        },
      });
    };
    await addSourceFile(sourceId, d2, 'sources\\civil\\principal.pdf');
    await addSourceFile(sourceId, d4, 'other\\area\\a.pdf');
    await addSourceFile(sourceOtherId, d4, 'sources\\civil\\b.pdf');
    await drain(runtime);
    await runtime.client.indices.refresh({ index: INDEX });
    if ((await runtime.activeSchemaVersion()) !== 3)
      throw new Error('NAMES_SCHEMA_V3_REQUIRED');

    const cases: TestCase[] = [
      { id: 'case-insensitive-title', q: 'RESPONSABILIDAD' },
      { id: 'filename-substring', q: 'DEMANDADO' },
      { id: 'readable-folder', q: 'responsabilidad', folderId: visible.id },
      { id: 'root-folder', q: 'responsabilidad', folderId: 'ROOT' },
      {
        id: 'source-id-correlated-path',
        q: 'responsabilidad',
        sourceId,
        sourceFolder: 'sources\\civil',
      },
      { id: 'source-id-without-path', q: 'responsabilidad', sourceId },
      {
        id: 'manual-uploads',
        q: 'responsabilidad',
        sourceId: '__manual_upload__',
      },
      { id: 'pdf-type', q: 'responsabilidad', type: 'PDF' },
      {
        id: 'date-inclusive',
        q: 'responsabilidad',
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
      },
      { id: 'literal-percent', q: '50%' },
      { id: 'literal-underscore', q: '%_' },
      { id: 'literal-wildcards', q: '*?' },
      { id: 'accent-case-insensitive', q: 'NIÑEZ' },
      { id: 'accent-sensitive', q: 'NINEZ' },
      { id: 'acute-case-insensitive', q: 'ACCIÓN' },
      { id: 'acute-sensitive', q: 'ACCION' },
    ];

    const raw = prisma.$queryRaw.bind(prisma) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    let openSearchModeIlikCalls = 0;
    let openSearchCalls = 0;
    let lastSearchDsl = '';
    Object.defineProperty(prisma, '$queryRaw', {
      configurable: true,
      value: (...args: unknown[]) => {
        if (
          process.env.SEARCH_ENGINE === 'opensearch' &&
          String((args[0] as { sql?: string })?.sql ?? '').includes('ILIKE')
        )
          openSearchModeIlikCalls += 1;
        return raw(...args);
      },
    });
    const search = runtime.client.search.bind(runtime.client) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    Object.defineProperty(runtime.client, 'search', {
      configurable: true,
      value: (...args: unknown[]) => {
        openSearchCalls += 1;
        lastSearchDsl = JSON.stringify(
          (args[0] as { body?: { query?: unknown } })?.body?.query ?? {},
        );
        return search(...args);
      },
    });
    const request = async (testCase: TestCase) => {
      const url = new URL(
        `http://127.0.0.1:${port}/api/workspaces/${a.id}/search/names`,
      );
      for (const [key, value] of Object.entries(testCase)) {
        if (key !== 'id' && value !== undefined)
          url.searchParams.set(key, value);
      }
      url.searchParams.set('pageSize', '100');
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await response.json()) as SearchBody;
      return {
        status: response.status,
        total: body.total,
        totalExact: body.totalExact,
        ids: (body.results ?? []).map((row) => row.documentId),
      };
    };
    const rows: Array<{ pass: boolean; [key: string]: unknown }> = [];
    for (const testCase of cases) {
      process.env.SEARCH_ENGINE = 'legacy';
      const expected = await request(testCase);
      process.env.SEARCH_ENGINE = 'opensearch';
      const actual = await request(testCase);
      const pass =
        expected.status === 200 &&
        actual.status === 200 &&
        actual.totalExact === true &&
        expected.total === actual.total &&
        JSON.stringify(expected.ids) === JSON.stringify(actual.ids);
      rows.push({
        id: testCase.id,
        expectedStatus: expected.status,
        actualStatus: actual.status,
        expectedTotal: expected.total,
        actualTotal: actual.total,
        expectedIdsSha256: hashIds(expected.ids),
        actualIdsSha256: hashIds(actual.ids),
        pass,
      });
    }
    process.env.SEARCH_ENGINE = 'opensearch';
    const content = async (path: string, as: AuthenticatedUser) => {
      actor = as;
      lastSearchDsl = '';
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await response.json()) as {
        total?: number;
        results?: Array<{ sourceId: string }>;
      };
      return {
        status: response.status,
        total: body.total ?? null,
        ids: (body.results ?? []).map((row) => row.sourceId).sort(),
        engineScope: lastSearchDsl,
      };
    };
    const sameShaFiles = await prisma.corpusDocumentFile.findMany({
      where: { documentId: { in: sameShaIds } },
      select: { documentId: true, sha256: true },
    });
    const sameShaMgetBefore = await runtime.client.mget({
      index: INDEX,
      body: { ids: sameShaIds },
    });
    const sameShaMgetBeforeRows =
      (
        sameShaMgetBefore as unknown as {
          body?: { docs?: Array<{ _id?: string; found?: boolean }> };
        }
      ).body?.docs ?? [];
    const sameShaInitial = {
      viewerShared: await content(
        `/api/workspaces/${a.id}/search?q=${encodeURIComponent(sameShaMarker)}`,
        viewer,
      ),
      adminSharedAndRestricted: await content(
        `/api/workspaces/${a.id}/search?q=${encodeURIComponent(sameShaMarker)}`,
        admin,
      ),
      personalOwner: await content(
        `/api/personal/search?q=${encodeURIComponent(sameShaMarker)}`,
        viewer,
      ),
    };
    const sameShaInitialPass =
      sameShaFiles.length === 3 &&
      sameShaFiles.every((row) => row.sha256 === sameShaHash) &&
      sameShaMgetBeforeRows.length === 3 &&
      sameShaMgetBeforeRows.every((row) => row.found === true) &&
      JSON.stringify(sameShaInitial.viewerShared.ids) ===
        JSON.stringify([sameShaSharedId]) &&
      sameShaInitial.viewerShared.total === 1 &&
      sameShaInitial.viewerShared.engineScope.includes('aclPrincipalIds') &&
      JSON.stringify(sameShaInitial.adminSharedAndRestricted.ids) ===
        JSON.stringify([sameShaSharedId, sameShaRestrictedId].sort()) &&
      sameShaInitial.adminSharedAndRestricted.total === 2 &&
      JSON.stringify(sameShaInitial.personalOwner.ids) ===
        JSON.stringify([sameShaPersonalId]) &&
      sameShaInitial.personalOwner.total === 1 &&
      sameShaInitial.personalOwner.engineScope.includes('ownerUserId');

    await prisma.corpusDocument.update({
      where: { id: sameShaSharedId },
      data: {
        searchText: `${sameShaUpdatedMarker} identical synthetic search text`,
      },
    });
    await drain(runtime);
    await runtime.client.indices.refresh({ index: INDEX });
    const sameShaAfterUpdate = {
      viewerOldTerm: await content(
        `/api/workspaces/${a.id}/search?q=${encodeURIComponent(sameShaMarker)}`,
        viewer,
      ),
      viewerNewTerm: await content(
        `/api/workspaces/${a.id}/search?q=${encodeURIComponent(sameShaUpdatedMarker)}`,
        viewer,
      ),
      adminOldTerm: await content(
        `/api/workspaces/${a.id}/search?q=${encodeURIComponent(sameShaMarker)}`,
        admin,
      ),
      personalOldTerm: await content(
        `/api/personal/search?q=${encodeURIComponent(sameShaMarker)}`,
        viewer,
      ),
    };
    const sameShaUpdatePass =
      sameShaAfterUpdate.viewerOldTerm.total === 0 &&
      sameShaAfterUpdate.viewerOldTerm.ids.length === 0 &&
      sameShaAfterUpdate.viewerNewTerm.total === 1 &&
      JSON.stringify(sameShaAfterUpdate.viewerNewTerm.ids) ===
        JSON.stringify([sameShaSharedId]) &&
      sameShaAfterUpdate.adminOldTerm.total === 1 &&
      JSON.stringify(sameShaAfterUpdate.adminOldTerm.ids) ===
        JSON.stringify([sameShaRestrictedId]) &&
      sameShaAfterUpdate.personalOldTerm.total === 1 &&
      JSON.stringify(sameShaAfterUpdate.personalOldTerm.ids) ===
        JSON.stringify([sameShaPersonalId]);

    await prisma.corpusDocument.delete({ where: { id: sameShaSharedId } });
    await drain(runtime);
    await runtime.client.indices.refresh({ index: INDEX });
    const sameShaMgetAfter = await runtime.client.mget({
      index: INDEX,
      body: { ids: sameShaIds },
    });
    const sameShaMgetAfterRows =
      (
        sameShaMgetAfter as unknown as {
          body?: { docs?: Array<{ _id?: string; found?: boolean }> };
        }
      ).body?.docs ?? [];
    const sameShaAfterDelete = {
      viewerUpdatedTerm: await content(
        `/api/workspaces/${a.id}/search?q=${encodeURIComponent(sameShaUpdatedMarker)}`,
        viewer,
      ),
      adminRestrictedSurvives: await content(
        `/api/workspaces/${a.id}/search?q=${encodeURIComponent(sameShaMarker)}`,
        admin,
      ),
      personalSurvives: await content(
        `/api/personal/search?q=${encodeURIComponent(sameShaMarker)}`,
        viewer,
      ),
    };
    const sameShaDeletePass =
      sameShaMgetAfterRows.length === 3 &&
      sameShaMgetAfterRows.filter((row) => row.found === true).length === 2 &&
      sameShaAfterDelete.viewerUpdatedTerm.total === 0 &&
      sameShaAfterDelete.viewerUpdatedTerm.ids.length === 0 &&
      sameShaAfterDelete.adminRestrictedSurvives.total === 1 &&
      JSON.stringify(sameShaAfterDelete.adminRestrictedSurvives.ids) ===
        JSON.stringify([sameShaRestrictedId]) &&
      sameShaAfterDelete.personalSurvives.total === 1 &&
      JSON.stringify(sameShaAfterDelete.personalSurvives.ids) ===
        JSON.stringify([sameShaPersonalId]);
    const sameShaPass =
      sameShaInitialPass && sameShaUpdatePass && sameShaDeletePass;
    const sameShaOutput = {
      generatedAt: new Date().toISOString(),
      candidate: INDEX,
      route: 'GET /api/workspaces/:id/search and GET /api/personal/search',
      fixture: {
        logicalDocuments: sameShaIds.length,
        sameFileSha256: sameShaHash,
        personalIdSha256: hashIds([sameShaPersonalId]),
        sharedIdSha256: hashIds([sameShaSharedId]),
        restrictedIdSha256: hashIds([sameShaRestrictedId]),
      },
      visibility: {
        initial: {
          viewerSharedTotal: sameShaInitial.viewerShared.total,
          adminSharedAndRestrictedTotal:
            sameShaInitial.adminSharedAndRestricted.total,
          personalOwnerTotal: sameShaInitial.personalOwner.total,
          pass: sameShaInitialPass,
        },
        afterUpdate: {
          viewerOldTermTotal: sameShaAfterUpdate.viewerOldTerm.total,
          viewerNewTermIdsSha256: hashIds(sameShaAfterUpdate.viewerNewTerm.ids),
          adminRestrictedSurvives: sameShaAfterUpdate.adminOldTerm.total === 1,
          personalSurvives: sameShaAfterUpdate.personalOldTerm.total === 1,
          pass: sameShaUpdatePass,
        },
        afterDelete: {
          sharedSearchDocsRemain: sameShaMgetAfterRows.filter(
            (row) => row.found,
          ).length,
          restrictedTotal: sameShaAfterDelete.adminRestrictedSurvives.total,
          personalTotal: sameShaAfterDelete.personalSurvives.total,
          pass: sameShaDeletePass,
        },
      },
      distinctLogicalIds: new Set(sameShaIds).size === 3,
      pass: sameShaPass && new Set(sameShaIds).size === 3,
    };
    writeFileSync(
      resolve(artifact, '../same-sha-1_5.json'),
      `${JSON.stringify(sameShaOutput, null, 2)}\n`,
      'utf8',
    );
    if (!sameShaPass) process.exitCode = 1;
    const aclRows = [
      {
        id: 'shared-member',
        expected: [d1, d4].sort(),
        result: await content(
          `/api/workspaces/${a.id}/search?q=responsabilidad`,
          viewer,
        ),
      },
      {
        id: 'creator-admin-restricted',
        expected: [d1, d4, d5].sort(),
        result: await content(
          `/api/workspaces/${a.id}/search?q=responsabilidad`,
          admin,
        ),
      },
      {
        id: 'shared-nonmember',
        expected: [],
        result: await content(
          `/api/workspaces/${a.id}/search?q=responsabilidad`,
          other,
        ),
      },
      {
        id: 'personal-owner',
        expected: [d6],
        result: await content('/api/personal/search?q=responsabilidad', viewer),
      },
      {
        id: 'personal-nonowner',
        expected: [],
        result: await content('/api/personal/search?q=responsabilidad', other),
      },
      {
        id: 'other-workspace-denied',
        expected: [],
        result: await content(
          `/api/workspaces/${b.id}/search?q=responsabilidad`,
          viewer,
        ),
      },
    ];
    await service.manageMember(a.id, admin, {
      userId: viewer.id,
      role: 'VIEWER',
      active: false,
    });
    await drain(runtime);
    await runtime.client.indices.refresh({ index: INDEX });
    aclRows.push({
      id: 'membership-revoked',
      expected: [],
      result: await content(
        `/api/workspaces/${a.id}/search?q=responsabilidad`,
        viewer,
      ),
    });
    const aclChecks = aclRows.map((row) => {
      const expectedStatus = [
        'shared-nonmember',
        'other-workspace-denied',
        'membership-revoked',
      ].includes(row.id)
        ? 404
        : 200;
      const pass =
        row.result.status === expectedStatus &&
        (expectedStatus !== 200 || row.result.total === row.expected.length) &&
        JSON.stringify(row.result.ids) === JSON.stringify(row.expected);
      return {
        id: row.id,
        expectedStatus,
        actualStatus: row.result.status,
        expectedTotal: row.expected.length,
        actualTotal: row.result.total,
        expectedIdsSha256: hashIds(row.expected),
        actualIdsSha256: hashIds(row.result.ids),
        engineScopeApplied:
          expectedStatus !== 200 ||
          (row.id.startsWith('personal')
            ? row.result.engineScope.includes('ownerUserId')
            : row.result.engineScope.includes('aclPrincipalIds') &&
              row.result.engineScope.includes('workspaceId')),
        pass,
      };
    });
    const denied = aclRows.filter((row) =>
      [
        'shared-nonmember',
        'personal-nonowner',
        'other-workspace-denied',
        'membership-revoked',
      ].includes(row.id),
    );
    const resultLeaks = denied.reduce(
      (sum, row) => sum + row.result.ids.length,
      0,
    );
    const countLeaks = denied.reduce(
      (sum, row) => sum + Math.max(0, row.result.total ?? 0),
      0,
    );
    const aclOutput = {
      generatedAt: new Date().toISOString(),
      candidate: INDEX,
      route: 'GET /api/workspaces/:id/search and GET /api/personal/search',
      fixtureUsers: userIds.length,
      fixtureDocuments: documentIds.length,
      cases: aclChecks.length,
      passed: aclChecks.filter((row) => row.pass && row.engineScopeApplied)
        .length,
      resultLeaks,
      countLeaks,
      rows: aclChecks,
      pass:
        aclChecks.every((row) => row.pass && row.engineScopeApplied) &&
        resultLeaks === 0 &&
        countLeaks === 0,
    };
    writeFileSync(
      resolve(artifact, '../acl-http-matrix-1_5_1.json'),
      `${JSON.stringify(aclOutput, null, 2)}\n`,
      'utf8',
    );
    console.log(`ACL HTTP: ${aclOutput.passed}/${aclOutput.cases}`);
    if (!aclOutput.pass) process.exitCode = 1;
    actor = admin;
    Object.defineProperty(runtime.client, 'search', {
      configurable: true,
      value: () => {
        throw new Error(
          'synthetic engine outage http://127.0.0.1:9200 internal marker',
        );
      },
    });
    const outageUrl = new URL(
      `http://127.0.0.1:${port}/api/workspaces/${a.id}/search/names`,
    );
    outageUrl.searchParams.set('q', 'responsabilidad');
    const outageResponse = await fetch(outageUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    const outageBody = await outageResponse.text();
    const namesOutagePass =
      outageResponse.status === 503 &&
      !/synthetic engine outage|127\.0\.0\.1:9200|stack|password|DATABASE_URL/iu.test(
        outageBody,
      ) &&
      openSearchModeIlikCalls === 0;
    const publicOutageResponse = await fetch(
      `http://127.0.0.1:${port}/api/public/busqueda?q=responsabilidad`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const publicOutageBody = await publicOutageResponse.text();
    const publicOutagePass =
      publicOutageResponse.status === 503 &&
      !/synthetic engine outage|127\.0\.0\.1:9200|stack|password|DATABASE_URL/iu.test(
        publicOutageBody,
      ) &&
      openSearchModeIlikCalls === 0;
    const namesOutput = {
      generatedAt: new Date().toISOString(),
      candidate: INDEX,
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      route: 'GET /api/workspaces/:workspaceId/search/names',
      fixtureUsers: userIds.length,
      fixtureWorkspaces: workspaceIds.length,
      fixtureDocuments: documentIds.length,
      fixtureSources: 2,
      reference:
        'same real HTTP endpoint in explicit legacy mode, identical DB fixture and actor',
      exactCases: rows.filter((row) => row.pass).length,
      requiredCases: cases.length,
      openSearchModeIlikCalls,
      openSearchCalls,
      failClosed: {
        workspaceNames: {
          status: outageResponse.status,
          bodySafe: namesOutagePass,
          legacyIlikCalls: openSearchModeIlikCalls,
        },
        publicSearch: {
          status: publicOutageResponse.status,
          bodySafe: publicOutagePass,
          legacyIlikCalls: openSearchModeIlikCalls,
        },
        legacyIlikCalls: openSearchModeIlikCalls,
      },
      rows,
      pass:
        rows.length === 16 &&
        rows.every((row) => row.pass) &&
        sameShaPass &&
        openSearchModeIlikCalls === 0 &&
        openSearchCalls >= 16 &&
        namesOutagePass &&
        publicOutagePass,
    };
    mkdirSync(resolve(artifact, '..'), { recursive: true });
    writeFileSync(
      artifact,
      `${JSON.stringify(namesOutput, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify({ ...namesOutput, rows: undefined }, null, 2));
    if (!namesOutput.pass) process.exitCode = 1;
  } finally {
    if (prisma) {
      await prisma.sourceFile
        .deleteMany({
          where: {
            sourceId: {
              in: [sourceId, sourceOtherId].filter((id): id is string =>
                Boolean(id),
              ),
            },
          },
        })
        .catch(() => undefined);
      await prisma.documentSource
        .deleteMany({
          where: {
            id: {
              in: [sourceId, sourceOtherId].filter((id): id is string =>
                Boolean(id),
              ),
            },
          },
        })
        .catch(() => undefined);
      if (documentIds.length)
        await prisma.corpusDocument
          .deleteMany({ where: { id: { in: documentIds } } })
          .catch(() => undefined);
      if (workspaceIds.length)
        await prisma.workspaceFolder
          .deleteMany({ where: { workspaceId: { in: workspaceIds } } })
          .catch(() => undefined);
      if (workspaceIds.length)
        await prisma.documentWorkspace
          .deleteMany({ where: { id: { in: workspaceIds } } })
          .catch(() => undefined);
      if (dependencyIds.length)
        await prisma.documentDependency
          .deleteMany({ where: { id: { in: dependencyIds } } })
          .catch(() => undefined);
      if (userIds.length)
        await prisma.usuario
          .deleteMany({ where: { id: { in: userIds } } })
          .catch(() => undefined);
      if (runtime) {
        await drain(runtime).catch(() => undefined);
        await runtime.client.indices
          .refresh({ index: INDEX })
          .catch(() => undefined);
        const mget = await runtime.client.mget({
          index: INDEX,
          body: { ids: documentIds },
        });
        const body = (
          mget as unknown as { body?: { docs?: Array<{ found?: boolean }> } }
        ).body;
        cleanupPass = (body?.docs ?? []).every((row) => row.found === false);
      }
      const residues = {
        users: await prisma.usuario
          .count({ where: { id: { in: userIds } } })
          .catch(() => -1),
        workspaces: await prisma.documentWorkspace
          .count({ where: { id: { in: workspaceIds } } })
          .catch(() => -1),
        documents: await prisma.corpusDocument
          .count({ where: { id: { in: documentIds } } })
          .catch(() => -1),
        sources: await prisma.documentSource
          .count({
            where: {
              id: {
                in: [sourceId, sourceOtherId].filter((id): id is string =>
                  Boolean(id),
                ),
              },
            },
          })
          .catch(() => -1),
      };
      const cleanup = {
        generatedAt: new Date().toISOString(),
        fixture: suffix,
        residues,
        indexDocsRemoved: cleanupPass,
        outbox: runtime ? await runtime.repository.outboxStatus() : null,
        pass:
          cleanupPass &&
          Object.values(residues).every((count) => count === 0) &&
          Boolean(runtime) &&
          (await runtime.repository.outboxStatus()).pending === 0 &&
          (await runtime.repository.outboxStatus()).failed === 0,
      };
      writeFileSync(
        resolve(artifact, '../names-fixture-cleanup-1_5_1.json'),
        `${JSON.stringify(cleanup, null, 2)}\n`,
        'utf8',
      );
      if (!cleanup.pass) process.exitCode = 1;
    }
    if (app) await app.close().catch(() => undefined);
  }
}

async function drain(runtime: OpenSearchRuntimeService) {
  const until = Date.now() + 120_000;
  for (;;) {
    const status = await runtime.repository.outboxStatus();
    if (status.failed) throw new Error('NAMES_OUTBOX_FAILED');
    if (!status.pending) return;
    if (Date.now() > until) throw new Error('NAMES_OUTBOX_TIMEOUT');
    await runtime.syncWorker.tick();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
}

function hashIds(ids: string[]) {
  return createHash('sha256').update(ids.join('\n')).digest('hex');
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'NAMES_HTTP_CERT_FAILED',
  );
  process.exitCode = 1;
});

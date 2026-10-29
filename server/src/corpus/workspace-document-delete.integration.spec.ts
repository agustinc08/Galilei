import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { jest } from '@jest/globals';
import type { BusquedaService } from '../busqueda/busqueda.service';
import { parseSearchQuery } from '../busqueda/utils/search-parser';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { LogsService } from '../logs/logs.service';
import { CatalogosService } from '../catalogos/catalogos.service';
import { EventosConsultaService } from '../estadisticas/eventos-consulta.service';
import { SentenciasService } from '../sentencias/sentencias.service';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import { LocalDocumentStorageAdapter } from './document-storage.adapter';
import { CorpusSearchSourceAdapter } from './corpus-search.adapter';
import { WorkspaceDocumentService } from './workspace-document.service';

const enabled = process.env.SPRINT15_POSTGRES_TEST === '1';
const testStorage = path.resolve(
  process.cwd(),
  `../_dev-corpus-storage-test/workspace-delete-${process.pid}`,
);

describe('Workspace official deletion lifecycle', () => {
  jest.setTimeout(120_000);
  let prisma: PrismaService;
  let service: WorkspaceDocumentService;
  let storage: LocalDocumentStorageAdapter;
  let source: CorpusSearchSourceAdapter;
  const previousStoragePath = process.env.BJC_CORPUS_STORAGE_PATH;
  const userIds: number[] = [];
  const workspaceIds: string[] = [];
  const dependencyIds: string[] = [];
  const documentIds: string[] = [];
  const sentenceIds: number[] = [];
  const suffix =
    `${Date.now()}${Math.random().toString(16).slice(2, 6)}`.toUpperCase();

  const asUser = (
    id: number,
    email: string,
    roleId: number,
    roleName: string,
  ): AuthenticatedUser => ({
    id,
    nombre: email,
    apellido: null,
    email,
    activo: true,
    rol: { id: roleId, nombre: roleName, descripcion: null },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeAll(async () => {
    if (!enabled) return;
    prisma = new PrismaService();
    process.env.BJC_CORPUS_STORAGE_PATH = testStorage;
    storage = new LocalDocumentStorageAdapter(testStorage);
    await prisma.$connect();
    service = new WorkspaceDocumentService(
      prisma,
      {} as BusquedaService,
      new CorpusDocumentAccessService(prisma),
      storage,
    );
    const [adminRole, lectorRole] = await Promise.all([
      prisma.rol.findUniqueOrThrow({ where: { nombre: 'ADMIN' } }),
      prisma.rol.findUniqueOrThrow({ where: { nombre: 'LECTOR' } }),
    ]);
    const [admin, viewer] = await Promise.all([
      prisma.usuario.create({
        data: {
          nombre: 'Workspace delete QA admin',
          email: `workspace-delete-admin-${suffix}@example.invalid`,
          passwordHash: 'synthetic-only',
          rolId: adminRole.id,
        },
      }),
      prisma.usuario.create({
        data: {
          nombre: 'Workspace delete QA viewer',
          email: `workspace-delete-viewer-${suffix}@example.invalid`,
          passwordHash: 'synthetic-only',
          rolId: lectorRole.id,
        },
      }),
    ]);
    userIds.push(admin.id, viewer.id);
    adminUser = asUser(admin.id, admin.email, adminRole.id, adminRole.nombre);
    viewerUser = asUser(
      viewer.id,
      viewer.email,
      lectorRole.id,
      lectorRole.nombre,
    );
  });

  let adminUser: AuthenticatedUser;
  let viewerUser: AuthenticatedUser;

  afterAll(async () => {
    if (!enabled) return;
    if (source) await source.close();
    if (workspaceIds.length)
      await prisma.documentWorkspace.deleteMany({
        where: { id: { in: workspaceIds } },
      });
    if (documentIds.length)
      await prisma.corpusDocument.deleteMany({
        where: { id: { in: documentIds } },
      });
    if (dependencyIds.length)
      await prisma.documentDependency.deleteMany({
        where: { id: { in: dependencyIds } },
      });
    if (sentenceIds.length)
      await prisma.sentencia.deleteMany({
        where: { id: { in: sentenceIds } },
      });
    if (userIds.length)
      await prisma.usuario.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    if (previousStoragePath === undefined)
      delete process.env.BJC_CORPUS_STORAGE_PATH;
    else process.env.BJC_CORPUS_STORAGE_PATH = previousStoragePath;
    const safeRoot = path.resolve(process.cwd(), '../_dev-corpus-storage-test');
    if (testStorage.startsWith(`${safeRoot}${path.sep}`))
      await rm(testStorage, { recursive: true, force: true });
  });

  (enabled ? it : it.skip)(
    'enforces ACL, deletes exact rows transactionally, preserves shared/orphan blobs, audits and enqueues Search',
    async () => {
      const workspaceA = await service.createWorkspace(adminUser, {
        code: `WDEL${suffix}A`,
        name: 'Workspace deletion QA A',
        type: 'SALA',
      });
      workspaceIds.push(workspaceA.id);
      const workspaceB = await service.createWorkspace(adminUser, {
        code: `WDEL${suffix}B`,
        name: 'Workspace deletion QA B',
        type: 'JUZGADO',
      });
      workspaceIds.push(workspaceB.id);
      const dependencies = await prisma.documentDependency.findMany({
        where: { code: { in: [workspaceA.code, workspaceB.code] } },
        select: { id: true },
      });
      dependencyIds.push(...dependencies.map(({ id }) => id));
      await service.manageMember(workspaceA.id, adminUser, {
        userId: viewerUser.id,
        role: 'VIEWER',
      });
      const nonemptyFolder = await service.createFolder(
        workspaceA.id,
        adminUser,
        { name: `Nonempty ${suffix}` },
      );
      const emptyFolder = await service.createFolder(workspaceA.id, adminUser, {
        name: `Empty ${suffix}`,
      });
      const pdf = await readFile(
        path.join(
          process.cwd(),
          'scripts/dev/fixtures/corpus/fallo-fixture.pdf',
        ),
      );
      const pdfUpload = {
        originalname: `shared-${suffix}.pdf`,
        mimetype: 'application/pdf',
        buffer: pdf,
        size: pdf.byteLength,
      };
      const uploadA = await service.upload(
        workspaceA.id,
        adminUser,
        [pdfUpload],
        nonemptyFolder.id,
      );
      const uploadB = await service.upload(workspaceB.id, adminUser, [
        pdfUpload,
      ]);
      const uploadText = await service.upload(workspaceA.id, adminUser, [
        {
          originalname: `unique-${suffix}.txt`,
          mimetype: 'text/plain',
          buffer: Buffer.from(`unique private QA content ${suffix}`),
          size: Buffer.byteLength(`unique private QA content ${suffix}`),
        },
      ]);
      const sharedIdA = uploadA.results[0].documentId;
      const sharedIdB = uploadB.results[0].documentId;
      const uniqueId = uploadText.results[0].documentId;
      documentIds.push(sharedIdA, sharedIdB, uniqueId);
      expect(uploadA.results[0].status).toBe('INDEXED');
      expect(uploadB.results[0].status).toBe('INDEXED');
      expect(uploadText.results[0].status).toBe('INDEXED');
      const [fileA, fileB, uniqueFile] = await Promise.all([
        prisma.corpusDocumentFile.findFirstOrThrow({
          where: { documentId: sharedIdA },
        }),
        prisma.corpusDocumentFile.findFirstOrThrow({
          where: { documentId: sharedIdB },
        }),
        prisma.corpusDocumentFile.findFirstOrThrow({
          where: { documentId: uniqueId },
        }),
      ]);
      expect(fileA.storageKey).toBe(fileB.storageKey);
      const sharedBytes = await storage.get(fileA.storageKey);
      const uniqueBytes = await storage.get(uniqueFile.storageKey);

      await expect(
        service.deleteDocument(
          workspaceA.id,
          sharedIdA,
          viewerUser,
          'QA role restriction',
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.deleteDocument(
          workspaceA.id,
          `missing-${suffix}`,
          adminUser,
          'QA nonexistent document',
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.deleteFolder(
          workspaceA.id,
          nonemptyFolder.id,
          adminUser,
          'QA nonempty folder',
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await prisma.workspaceFolder.findUnique({
          where: { id: nonemptyFolder.id },
        }),
      ).not.toBeNull();
      await expect(
        service.deleteFolder(
          workspaceA.id,
          emptyFolder.id,
          viewerUser,
          'QA role restriction',
        ),
      ).rejects.toMatchObject({ status: 403 });
      const knownFolderOutboxIds = new Set(
        (
          await prisma.searchIndexOutbox.findMany({
            where: { documentKey: `CORPUS:${sharedIdA}` },
            select: { id: true },
          })
        ).map(({ id }) => String(id)),
      );
      expect(
        await service.deleteFolder(
          workspaceA.id,
          emptyFolder.id,
          adminUser,
          'QA empty folder removal',
        ),
      ).toEqual({ deleted: true, folderId: emptyFolder.id });
      await expect(
        service.deleteFolder(
          workspaceA.id,
          emptyFolder.id,
          adminUser,
          'QA idempotent retry',
        ),
      ).rejects.toMatchObject({ status: 404 });
      const folderOutbox = await prisma.searchIndexOutbox.findMany({
        where: { documentKey: `CORPUS:${sharedIdA}` },
        select: { id: true, operation: true },
      });
      expect(
        folderOutbox.some(
          ({ id, operation }) =>
            !knownFolderOutboxIds.has(String(id)) && operation === 'UPSERT',
        ),
      ).toBe(true);
      expect(
        await prisma.accionLog.count({
          where: {
            usuarioId: adminUser.id,
            entidad: 'WorkspaceFolder',
            accion: 'WORKSPACE_FOLDER_DELETE',
            datosDespues: { path: ['folderId'], equals: emptyFolder.id },
          },
        }),
      ).toBe(1);

      const knownDocumentOutboxIds = new Set(
        (
          await prisma.searchIndexOutbox.findMany({
            where: { documentKey: `CORPUS:${sharedIdA}` },
            select: { id: true },
          })
        ).map(({ id }) => String(id)),
      );
      const sharedDelete = await service.deleteDocument(
        workspaceA.id,
        sharedIdA,
        adminUser,
        'QA shared blob removal',
      );
      expect(sharedDelete).toMatchObject({
        deleted: true,
        documentId: sharedIdA,
        corpusDocumentDeleted: true,
        physicalBlobsDeleted: 0,
        sharedBlobsPreserved: 1,
        blobReferenceCountBefore: 2,
        blobReferenceCountAfter: 1,
      });
      expect(
        await prisma.corpusDocument.findUnique({ where: { id: sharedIdA } }),
      ).toBeNull();
      expect(
        await prisma.corpusDocument.findUnique({ where: { id: sharedIdB } }),
      ).not.toBeNull();
      expect(
        await prisma.corpusDocumentFile.count({
          where: {
            storageProvider: fileA.storageProvider,
            storageKey: fileA.storageKey,
          },
        }),
      ).toBe(1);
      expect(await storage.get(fileA.storageKey)).toEqual(sharedBytes);
      const documentOutbox = await prisma.searchIndexOutbox.findMany({
        where: { documentKey: `CORPUS:${sharedIdA}` },
        select: { id: true, operation: true },
      });
      expect(
        documentOutbox.some(
          ({ id, operation }) =>
            !knownDocumentOutboxIds.has(String(id)) && operation === 'DELETE',
        ),
      ).toBe(true);
      await expect(
        service.deleteDocument(
          workspaceA.id,
          sharedIdA,
          adminUser,
          'QA idempotent retry',
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        await prisma.accionLog.count({
          where: {
            usuarioId: adminUser.id,
            entidad: 'WorkspaceDocument',
            accion: 'WORKSPACE_DOCUMENT_DELETE',
            datosDespues: { path: ['documentId'], equals: sharedIdA },
          },
        }),
      ).toBe(1);

      const uniqueDelete = await service.deleteDocument(
        workspaceA.id,
        uniqueId,
        adminUser,
        'QA unique blob removal',
      );
      expect(uniqueDelete).toMatchObject({
        corpusDocumentDeleted: true,
        physicalBlobsDeleted: 0,
        sharedBlobsPreserved: 0,
        orphanBlobCandidatesPreserved: 1,
        blobReferenceCountBefore: 1,
        blobReferenceCountAfter: 0,
      });
      expect(await storage.get(uniqueFile.storageKey)).toEqual(uniqueBytes);
    },
  );

  (enabled ? it : it.skip)(
    'allows only the personal owner to remove a document through the official audited lifecycle',
    async () => {
      const pdf = await readFile(
        path.join(
          process.cwd(),
          'scripts/dev/fixtures/corpus/fallo-fixture.pdf',
        ),
      );
      const upload = await service.uploadPersonal(adminUser, [
        {
          originalname: `personal-delete-${suffix}.pdf`,
          mimetype: 'application/pdf',
          buffer: pdf,
          size: pdf.byteLength,
        },
      ]);
      const documentId = upload.results[0]?.documentId;
      expect(documentId).toBeTruthy();
      documentIds.push(documentId);
      const file = await prisma.corpusDocumentFile.findFirstOrThrow({
        where: { documentId },
      });
      const otherDocumentReferences = await prisma.corpusDocumentFile.count({
        where: {
          storageProvider: file.storageProvider,
          storageKey: file.storageKey,
          documentId: { not: documentId },
        },
      });
      const bytesBeforeDelete = await storage.get(file.storageKey);
      const knownOutboxIds = new Set(
        (
          await prisma.searchIndexOutbox.findMany({
            where: { documentKey: `CORPUS:${documentId}` },
            select: { id: true },
          })
        ).map(({ id }) => String(id)),
      );

      await expect(
        service.deletePersonalDocument(
          documentId,
          viewerUser,
          'QA non-owner deletion attempt',
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        await prisma.corpusDocument.findUnique({ where: { id: documentId } }),
      ).not.toBeNull();

      await expect(
        service.deletePersonalDocument(documentId, adminUser, '  '),
      ).rejects.toMatchObject({ status: 400 });
      const deleted = await service.deletePersonalDocument(
        documentId,
        adminUser,
        'QA personal document removal',
      );
      expect(deleted).toMatchObject({
        deleted: true,
        documentId,
        corpusDocumentDeleted: true,
        physicalBlobsDeleted: 0,
        sharedBlobsPreserved: otherDocumentReferences > 0 ? 1 : 0,
        orphanBlobCandidatesPreserved: otherDocumentReferences === 0 ? 1 : 0,
        blobReferenceCountBefore: otherDocumentReferences + 1,
        blobReferenceCountAfter: otherDocumentReferences,
      });
      expect(
        await prisma.corpusDocument.findUnique({ where: { id: documentId } }),
      ).toBeNull();
      expect(await storage.get(file.storageKey)).toEqual(bytesBeforeDelete);
      const deleteEvents = await prisma.searchIndexOutbox.findMany({
        where: { documentKey: `CORPUS:${documentId}`, operation: 'DELETE' },
        select: { id: true },
      });
      expect(
        deleteEvents.some(({ id }) => !knownOutboxIds.has(String(id))),
      ).toBe(true);
      expect(
        await prisma.accionLog.count({
          where: {
            usuarioId: adminUser.id,
            entidad: 'PersonalDocument',
            accion: 'PERSONAL_DOCUMENT_DELETE',
            datosDespues: { path: ['documentId'], equals: documentId },
          },
        }),
      ).toBe(1);
    },
  );

  (enabled ? it : it.skip)(
    'attaches an exact PDF for a published judgment even when Corpus is INTERNAL, keeps it workspace scoped, and gates Search/Viewer by publication',
    async () => {
      const workspace = await service.createWorkspace(adminUser, {
        code: `WATTACH${suffix}`,
        name: 'Workspace real jurisprudence attachment QA',
        type: 'SALA',
      });
      workspaceIds.push(workspace.id);
      const dependency = await prisma.documentDependency.findUniqueOrThrow({
        where: { code: workspace.code },
        select: { id: true },
      });
      dependencyIds.push(dependency.id);
      await service.manageMember(workspace.id, adminUser, {
        userId: viewerUser.id,
        role: 'VIEWER',
      });
      const marker = `QAATTACH${suffix}`;
      const sentence = await prisma.sentencia.create({
        data: {
          numeroSentencia: marker,
          legacyId: marker,
          estadoCarga: 'PUBLICADA',
          publicado: true,
          publishedAt: new Date(),
          activo: true,
          fecha: new Date('2026-01-15T00:00:00.000Z'),
        },
        select: { id: true },
      });
      sentenceIds.push(sentence.id);
      const pdf = await readFile(
        path.join(
          process.cwd(),
          'scripts/dev/fixtures/corpus/fallo-fixture.pdf',
        ),
      );
      const stored = await storage.put(`published-${marker}.pdf`, pdf);
      const absolutePdfPath = path.resolve(testStorage, stored.storageKey);
      const document = await prisma.corpusDocument.create({
        data: {
          title: `Fallo ${marker}`,
          caseNumber: marker,
          chamber: 'Sala QA',
          documentScope: 'GENERAL',
          visibility: 'INTERNAL',
          status: 'INDEXED',
          editorialStatus: 'NO_REVIEWED',
          anonymizationStatus: 'REVIEW_REQUIRED',
          searchText: `responsabilidad civil ${marker} daño`,
          files: {
            create: {
              storageProvider: 'LOCAL_DEV',
              storageKey: stored.storageKey,
              originalFilename: `published-${marker}.pdf`,
              mimeType: 'application/pdf',
              sizeBytes: BigInt(stored.sizeBytes),
              sha256: stored.sha256,
            },
          },
          links: {
            create: {
              targetDomain: 'JURISPRUDENCIA',
              targetType: 'SENTENCIA',
              targetId: String(sentence.id),
              relationship: 'ASSOCIATED_WITH',
            },
          },
        },
        select: { id: true },
      });
      documentIds.push(document.id);
      await prisma.archivoPdf.create({
        data: {
          nombreArchivo: `published-${marker}.pdf`,
          nombreOriginal: `published-${marker}.pdf`,
          rutaArchivo: absolutePdfPath,
          mimeType: 'application/pdf',
          tamanioBytes: pdf.byteLength,
          sentenciaId: sentence.id,
        },
      });
      source = new CorpusSearchSourceAdapter(undefined, 'predicate-v1');
      const fileReferencesBeforeAttach = await prisma.corpusDocumentFile.count({
        where: {
          storageProvider: 'LOCAL_DEV',
          storageKey: stored.storageKey,
        },
      });
      const attachment = await service.attachPublishedJudgment(
        workspace.id,
        sentence.id,
        adminUser,
        { reason: 'QA source and publication verification' },
      );
      expect(attachment).toMatchObject({
        documentId: document.id,
        sentenceId: sentence.id,
        blobReused: true,
        sha256: stored.sha256,
      });
      expect(
        await prisma.corpusDocumentFile.count({
          where: {
            storageProvider: 'LOCAL_DEV',
            storageKey: stored.storageKey,
          },
        }),
      ).toBe(fileReferencesBeforeAttach);
      const visible = await source.search(
        parseSearchQuery(marker),
        {
          visibility: 'ADMIN',
          dialect: 'modern',
          publicationPolicy: 'legacy-active-only',
          sourceSystems: ['CORPUS'],
          page: 1,
          pageSize: 20,
          documentScope: {
            kind: 'WORKSPACE',
            workspaceId: workspace.id,
            userId: adminUser.id,
          },
        },
        [document.id],
      );
      expect(visible.results.map((row) => row.sourceId)).toContain(document.id);
      const nameMatches = await service.searchNames(
        workspace.id,
        viewerUser,
        marker,
      );
      expect(nameMatches.results.map((row) => row.documentId)).toContain(
        document.id,
      );
      const namedMatch = nameMatches.results.find(
        (row) => row.documentId === document.id,
      );
      expect(namedMatch?.matchedIn.length).toBeGreaterThan(0);
      const workspaceSearchService = new WorkspaceDocumentService(
        prisma,
        {
          federatedSearch: async (
            query: string,
            _operator: 'AND',
            context: Parameters<CorpusSearchSourceAdapter['search']>[1],
          ) => source.search(parseSearchQuery(query), context),
        } as never,
        new CorpusDocumentAccessService(prisma),
        storage,
      );
      const workspaceSearch = await workspaceSearchService.searchWorkspace(
        workspace.id,
        viewerUser,
        marker,
      );
      expect(workspaceSearch?.results.map((row) => row.sourceId)).toContain(
        document.id,
      );
      expect(
        workspaceSearch?.documentCoverage.textAvailableDocuments,
      ).toBeGreaterThan(0);
      const publicVisible = await source.search(
        parseSearchQuery(marker),
        {
          visibility: 'PUBLIC',
          dialect: 'modern',
          publicationPolicy: 'legacy-active-only',
          sourceSystems: ['CORPUS'],
          page: 1,
          pageSize: 20,
        },
        [document.id],
      );
      expect(publicVisible.results.map((row) => row.sourceId)).not.toContain(
        document.id,
      );
      const viewedFile = await service.file(
        workspace.id,
        document.id,
        viewerUser,
      );
      expect(viewedFile).toMatchObject({
        filename: `published-${marker}.pdf`,
        sha256: stored.sha256,
      });

      const archive = new SentenciasService(
        prisma,
        {} as CatalogosService,
        {} as EventosConsultaService,
        new LogsService(prisma),
      );
      await archive.archive(sentence.id, adminUser.id);
      await expect(
        service.file(workspace.id, document.id, viewerUser),
      ).rejects.toMatchObject({ status: 404 });
      const hidden = await source.search(
        parseSearchQuery(marker),
        {
          visibility: 'ADMIN',
          dialect: 'modern',
          publicationPolicy: 'legacy-active-only',
          sourceSystems: ['CORPUS'],
          page: 1,
          pageSize: 20,
          documentScope: {
            kind: 'WORKSPACE',
            workspaceId: workspace.id,
            userId: adminUser.id,
          },
        },
        [document.id],
      );
      expect(hidden.results.map((row) => row.sourceId)).not.toContain(
        document.id,
      );
    },
  );
});

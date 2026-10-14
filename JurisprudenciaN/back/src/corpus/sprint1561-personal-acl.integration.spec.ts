import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceDependencyType, WorkspaceRole, WorkspaceVisibilityScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { parseSearchQuery } from '../busqueda/utils/search-parser';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import { CorpusSearchSourceAdapter } from './corpus-search.adapter';
import { LocalDocumentStorageAdapter } from './document-storage.adapter';
import { WorkspaceDocumentService } from './workspace-document.service';

const enabled = process.env.SPRINT1561_POSTGRES_TEST === '1';
const suffix = `${Date.now()}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const storageRoot = path.resolve(process.cwd(), `../../_dev-corpus-storage-test/sprint1561-${suffix}`);

describe('Sprint 15.6.1 personal documents and restricted folder ACL PostgreSQL integration', () => {
  const prisma = new PrismaService();
  let searchSource: CorpusSearchSourceAdapter;
  let documents: WorkspaceDocumentService;
  let access: CorpusDocumentAccessService;
  const previousStoragePath = process.env.BJC_CORPUS_STORAGE_PATH;
  const userIds: number[] = [];
  const workspaceIds: string[] = [];
  const dependencyIds: string[] = [];
  const documentIds: string[] = [];
  let admin: AuthenticatedUser;
  let grantee: AuthenticatedUser;
  let otherMember: AuthenticatedUser;

  beforeAll(async () => {
    if (!enabled) return;
    await mkdir(storageRoot, { recursive: true });
    process.env.BJC_CORPUS_STORAGE_PATH = storageRoot;
    await prisma.$connect();
    searchSource = new CorpusSearchSourceAdapter();
    access = new CorpusDocumentAccessService(prisma);
    const search = {
      federatedSearch: async (
        query: string,
        _operator: 'AND',
        context: Parameters<CorpusSearchSourceAdapter['search']>[1],
      ) => searchSource.search(parseSearchQuery(query), context),
    };
    documents = new WorkspaceDocumentService(
      prisma,
      search as never,
      access,
      new LocalDocumentStorageAdapter(storageRoot),
    );
    const [adminRole, readerRole] = await Promise.all([
      prisma.rol.findUniqueOrThrow({ where: { nombre: 'ADMIN' } }),
      prisma.rol.findUniqueOrThrow({ where: { nombre: 'LECTOR' } }),
    ]);
    const rows = await Promise.all(
      [
        ['admin', adminRole.id],
        ['grantee', readerRole.id],
        ['other', readerRole.id],
      ].map(([label, rolId]) =>
        prisma.usuario.create({
          data: {
            nombre: `Sprint 15.6.1 ${label}`,
            email: `sprint1561-${label}-${suffix}@example.invalid`,
            passwordHash: 'synthetic-only',
            rolId: Number(rolId),
          },
        }),
      ),
    );
    userIds.push(...rows.map((row) => row.id));
    const makeUser = (row: (typeof rows)[number]): AuthenticatedUser => ({
      id: row.id,
      nombre: row.nombre,
      apellido: null,
      email: row.email,
      activo: true,
      rol: { id: row.rolId, nombre: row.id === rows[0].id ? 'ADMIN' : 'LECTOR', descripcion: null },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    [admin, grantee, otherMember] = rows.map(makeUser);
  });

  afterAll(async () => {
    if (!enabled) return;
    if (searchSource) await searchSource.close();
    await prisma.workspaceDocument.deleteMany({
      where: {
        OR: [
          { workspaceId: { in: workspaceIds } },
          { ownerUserId: { in: userIds } },
        ],
      },
    });
    await prisma.workspaceFolder.deleteMany({
      where: {
        OR: [
          { workspaceId: { in: workspaceIds } },
          { ownerUserId: { in: userIds } },
        ],
      },
    });
    if (workspaceIds.length)
      await prisma.documentWorkspace.deleteMany({ where: { id: { in: workspaceIds } } });
    if (documentIds.length)
      await prisma.corpusDocument.deleteMany({ where: { id: { in: [...new Set(documentIds)] } } });
    if (dependencyIds.length)
      await prisma.documentDependency.deleteMany({ where: { id: { in: dependencyIds } } });
    if (userIds.length)
      await prisma.usuario.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    if (previousStoragePath === undefined) delete process.env.BJC_CORPUS_STORAGE_PATH;
    else process.env.BJC_CORPUS_STORAGE_PATH = previousStoragePath;
    const safeRoot = path.resolve(process.cwd(), '../../_dev-corpus-storage-test');
    if (storageRoot.startsWith(`${safeRoot}${path.sep}`))
      await rm(storageRoot, { recursive: true, force: true });
  });

  (enabled ? it : it.skip)(
    'isolates personal scope and enforces restricted folder inheritance across Search, Viewer, names, and file access',
    async () => {
      const workspace = await documents.createWorkspace(admin, {
        code: `S1561${suffix}`,
        name: 'Sprint 15.6.1 synthetic dependency',
        type: WorkspaceDependencyType.JUZGADO,
      });
      workspaceIds.push(workspace.id);
      const dependency = await prisma.documentDependency.findUniqueOrThrow({
        where: { code: workspace.code },
        select: { id: true },
      });
      dependencyIds.push(dependency.id);
      await documents.manageMember(workspace.id, admin, {
        userId: grantee.id,
        role: WorkspaceRole.EDITOR,
      });
      await documents.manageMember(workspace.id, admin, {
        userId: otherMember.id,
        role: WorkspaceRole.VIEWER,
      });

      const restricted = await documents.createFolder(workspace.id, admin, {
        name: `Restringida ${suffix}`,
        visibilityScope: WorkspaceVisibilityScope.RESTRICTED,
        userIds: [grantee.id],
      });
      const inherited = await documents.createFolder(workspace.id, admin, {
        name: `Heredada ${suffix}`,
        parentId: restricted.id,
      });
      await expect(documents.createFolder(workspace.id, admin, {
        name: `Ampliacion implicita ${suffix}`,
        parentId: restricted.id,
        visibilityScope: WorkspaceVisibilityScope.DEPENDENCY_SHARED,
      })).rejects.toMatchObject({ status: 400 });
      await expect(documents.setRestrictedFolderMembers(workspace.id, inherited.id, admin, {
        visibilityScope: WorkspaceVisibilityScope.DEPENDENCY_SHARED,
        confirmAccessChange: true,
      })).rejects.toMatchObject({ status: 400 });
      const creatorOnly = await documents.createFolder(workspace.id, grantee, {
        name: `Creada por editora ${suffix}`,
        visibilityScope: WorkspaceVisibilityScope.RESTRICTED,
      });
      expect((await documents.folders(workspace.id, grantee)).map((item) => item.id)).toEqual(
        expect.arrayContaining([restricted.id, inherited.id, creatorOnly.id]),
      );
      expect((await documents.folders(workspace.id, grantee)).find((item) => item.id === creatorOnly.id)?.canManageAccess).toBe(true);
      expect((await documents.folders(workspace.id, otherMember)).map((item) => item.id)).not.toEqual(
        expect.arrayContaining([restricted.id, inherited.id, creatorOnly.id]),
      );

      const payload = Buffer.from(`SPRINT1561PERSONALACL${suffix} acceso restringido y privado`, 'utf8');
      const filename = `sprint1561-${suffix}.txt`;
      const upload = {
        originalname: filename,
        mimetype: 'text/plain',
        buffer: payload,
        size: payload.byteLength,
      };
      const workspaceUpload = await documents.upload(workspace.id, admin, [upload], inherited.id);
      const workspaceDocumentId = workspaceUpload.results[0]?.documentId;
      expect(workspaceUpload.results[0]).toMatchObject({ status: 'INDEXED', duplicate: false });
      documentIds.push(workspaceDocumentId);
      const repeatedWorkspaceUpload = await documents.upload(workspace.id, admin, [upload], inherited.id);
      expect(repeatedWorkspaceUpload.results[0]).toMatchObject({ documentId: workspaceDocumentId, duplicate: true });

      const personalFolder = await documents.createPersonalFolder(grantee, { name: `Sólo yo ${suffix}` });
      const personalUpload = await documents.uploadPersonal(grantee, [upload], personalFolder.id);
      const personalDocumentId = personalUpload.results[0]?.documentId;
      expect(personalUpload.results[0]).toMatchObject({ status: 'INDEXED', duplicate: false });
      documentIds.push(personalDocumentId);
      expect(personalDocumentId).not.toBe(workspaceDocumentId);
      const repeatedPersonalUpload = await documents.uploadPersonal(grantee, [upload], personalFolder.id);
      expect(repeatedPersonalUpload.results[0]).toMatchObject({ documentId: personalDocumentId, duplicate: true });
      const [workspaceFile, personalFile] = await Promise.all([
        prisma.corpusDocumentFile.findFirstOrThrow({ where: { documentId: workspaceDocumentId }, select: { sha256: true, storageKey: true } }),
        prisma.corpusDocumentFile.findFirstOrThrow({ where: { documentId: personalDocumentId }, select: { sha256: true, storageKey: true } }),
      ]);
      expect(personalFile.sha256).toBe(workspaceFile.sha256);
      expect(personalFile.storageKey).toBe(workspaceFile.storageKey);

      const networkSource = await prisma.documentSource.create({
        data: {
          workspaceId: workspace.id,
          name: `Sprint 15.6.1 synthetic network source ${suffix}`,
          path: `C:\\sprint1561\\${suffix}`,
          createdById: admin.id,
        },
      });
      await prisma.sourceFile.create({
        data: {
          sourceId: networkSource.id,
          relativePath: 'source-document.txt',
          normalizedPath: 'source-document.txt',
          fileName: 'source-document.txt',
          extension: '.txt',
          sizeBytes: BigInt(payload.byteLength),
          modifiedAt: new Date(),
          sha256: workspaceFile.sha256,
          documentId: workspaceDocumentId,
        },
      });
      await expect(
        documents.makeDocumentPersonal(workspace.id, workspaceDocumentId, admin, {
          confirmAccessChange: true,
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (await documents.documentsInWorkspace(workspace.id, admin)).find((item) => item.documentId === workspaceDocumentId)?.canMakePersonal,
      ).toBe(false);

      const token = `SPRINT1561PERSONALACL${suffix}`;
      const [allowedWorkspaceSearch, deniedWorkspaceSearch, ownerPersonalSearch, otherPersonalSearch] = await Promise.all([
        documents.searchWorkspace(workspace.id, grantee, token),
        documents.searchWorkspace(workspace.id, otherMember, token),
        documents.searchPersonal(grantee, token),
        documents.searchPersonal(otherMember, token),
      ]);
      expect(allowedWorkspaceSearch?.results.map((item) => item.sourceId)).toContain(workspaceDocumentId);
      expect(deniedWorkspaceSearch?.results.map((item) => item.sourceId)).not.toContain(workspaceDocumentId);
      expect(ownerPersonalSearch?.results.map((item) => item.sourceId)).toContain(personalDocumentId);
      expect(otherPersonalSearch?.results.map((item) => item.sourceId)).not.toContain(personalDocumentId);
      expect((await documents.documentsInWorkspace(workspace.id, grantee)).map((item) => item.documentId)).toContain(workspaceDocumentId);
      expect((await documents.documentsInWorkspace(workspace.id, otherMember)).map((item) => item.documentId)).not.toContain(workspaceDocumentId);
      expect((await documents.searchNames(workspace.id, grantee, suffix)).results.map((item) => item.documentId)).toContain(workspaceDocumentId);
      expect((await documents.searchNames(workspace.id, otherMember, suffix)).results.map((item) => item.documentId)).not.toContain(workspaceDocumentId);
      expect((await documents.personalDocuments(grantee, personalFolder.id)).map((item) => item.document.id)).toContain(personalDocumentId);
      expect((await documents.personalDocuments(otherMember, personalFolder.id).catch(() => [])).map((item) => item.document.id)).not.toContain(personalDocumentId);
      expect((await documents.personalDocuments(admin)).map((item) => item.document.id)).not.toContain(personalDocumentId);

      const general = await searchSource.search(parseSearchQuery(token), {
        visibility: 'ADMIN',
        dialect: 'modern',
        publicationPolicy: 'legacy-active-only',
        sourceSystems: ['CORPUS'],
        page: 1,
        pageSize: 20,
        documentScope: { kind: 'GENERAL' },
      });
      expect(general.results.map((item) => item.sourceId)).not.toEqual(
        expect.arrayContaining([workspaceDocumentId, personalDocumentId]),
      );
      await expect(access.metadata(workspaceDocumentId, 'RESTRICTED', undefined, workspace.id, otherMember.id)).rejects.toMatchObject({ status: 404 });
      await expect(access.matches(workspaceDocumentId, 'RESTRICTED', token, workspace.id, otherMember.id)).rejects.toMatchObject({ status: 404 });
      await expect(access.file(workspaceDocumentId, 'RESTRICTED', workspace.id, otherMember.id)).rejects.toMatchObject({ status: 404 });
      await expect(access.metadata(personalDocumentId, 'RESTRICTED', undefined, undefined, otherMember.id)).rejects.toMatchObject({ status: 404 });
      await expect(access.matches(personalDocumentId, 'RESTRICTED', token, undefined, otherMember.id)).rejects.toMatchObject({ status: 404 });
      await expect(access.file(personalDocumentId, 'RESTRICTED', undefined, otherMember.id)).rejects.toMatchObject({ status: 404 });
      await expect(access.metadata(personalDocumentId, 'ADMIN')).rejects.toMatchObject({ status: 404 });

      const authorizedMetadata = await documents.metadata(workspace.id, workspaceDocumentId, grantee);
      expect(authorizedMetadata.file?.href).toBe(`/api/workspaces/${workspace.id}/documents/${workspaceDocumentId}/file`);
      const personalMetadata = await documents.personalMetadata(personalDocumentId, grantee);
      expect(personalMetadata.file?.href).toBe(`/api/personal/documents/${personalDocumentId}/file`);
      expect((await documents.personalFile(personalDocumentId, grantee)).content).toEqual(payload);
      expect((await documents.file(workspace.id, workspaceDocumentId, grantee)).content).toEqual(payload);

      await documents.setRestrictedFolderMembers(workspace.id, restricted.id, admin, {
        visibilityScope: WorkspaceVisibilityScope.RESTRICTED,
        userIds: [],
      });
      expect((await documents.folders(workspace.id, grantee)).map((item) => item.id)).not.toContain(restricted.id);
      await expect(access.metadata(workspaceDocumentId, 'RESTRICTED', undefined, workspace.id, grantee.id)).rejects.toMatchObject({ status: 404 });
      expect((await documents.personalFile(personalDocumentId, grantee)).content).toEqual(payload);

      await documents.setRestrictedFolderMembers(workspace.id, restricted.id, admin, {
        visibilityScope: WorkspaceVisibilityScope.RESTRICTED,
        userIds: [grantee.id],
      });
      await documents.manageMember(workspace.id, admin, {
        userId: grantee.id,
        role: WorkspaceRole.VIEWER,
        active: false,
      });
      await expect(access.metadata(workspaceDocumentId, 'RESTRICTED', undefined, workspace.id, grantee.id)).rejects.toMatchObject({ status: 404 });
      expect((await documents.personalFile(personalDocumentId, grantee)).content).toEqual(payload);
    },
  );
});

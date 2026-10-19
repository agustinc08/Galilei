import { access as pathAccess, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@opensearch-project/opensearch';
import {
  WorkspaceDependencyType,
  WorkspaceRole,
  WorkspaceVisibilityScope,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { OpenSearchDocumentRepository } from '../busqueda/opensearch/opensearch-document.repository';
import { OpenSearchIndexService } from '../busqueda/opensearch/opensearch-index.service';
import { OpenSearchSearchSourceAdapter } from '../busqueda/opensearch/opensearch-search-source.adapter';
import { parseSearchQuery } from '../busqueda/utils/search-parser';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import { CorpusSearchSourceAdapter } from './corpus-search.adapter';
import { LocalDocumentStorageAdapter } from './document-storage.adapter';
import { WorkspaceDocumentService } from './workspace-document.service';

const enabled = process.env.SPRINT1561_POSTGRES_TEST === '1';
const suffix =
  `${Date.now()}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const storageRoot = path.resolve(
  process.cwd(),
  `../../_dev-corpus-storage-test/sprint1561-${suffix}`,
);

function personalResultDocumentIds(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return (rows as unknown[]).flatMap((row) => {
    if (typeof row !== 'object' || row === null || !('document' in row)) {
      return [];
    }
    const document = row.document;
    if (
      typeof document !== 'object' ||
      document === null ||
      !('id' in document)
    ) {
      return [];
    }
    return typeof document.id === 'string' ? [document.id] : [];
  });
}

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
  let outboxBaseline = { pending: 0, failed: 0 };
  let admin: AuthenticatedUser;
  let grantee: AuthenticatedUser;
  let otherMember: AuthenticatedUser;
  let outsider: AuthenticatedUser;

  beforeAll(async () => {
    if (!enabled) return;
    await mkdir(storageRoot, { recursive: true });
    process.env.BJC_CORPUS_STORAGE_PATH = storageRoot;
    await prisma.$connect();
    outboxBaseline = {
      pending: await prisma.searchIndexOutbox.count({
        where: { processedAt: null, failedAt: null },
      }),
      failed: await prisma.searchIndexOutbox.count({
        where: { failedAt: { not: null } },
      }),
    };
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
        ['outsider', readerRole.id],
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
      rol: {
        id: row.rolId,
        nombre: row.id === rows[0].id ? 'ADMIN' : 'LECTOR',
        descripcion: null,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    [admin, grantee, otherMember] = rows.slice(0, 3).map(makeUser);
    outsider = makeUser(rows[3]);
  });

  afterAll(async () => {
    if (!enabled) return;
    if (searchSource) await searchSource.close();
    const syntheticDocumentIds = [...new Set(documentIds)];
    const syntheticDocumentKeys = syntheticDocumentIds.map(
      (id) => `CORPUS:${id}`,
    );
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
      await prisma.documentWorkspace.deleteMany({
        where: { id: { in: workspaceIds } },
      });
    if (documentIds.length)
      await prisma.corpusDocument.deleteMany({
        where: { id: { in: [...new Set(documentIds)] } },
      });
    if (dependencyIds.length)
      await prisma.documentDependency.deleteMany({
        where: { id: { in: dependencyIds } },
      });
    if (userIds.length)
      await prisma.usuario.deleteMany({ where: { id: { in: userIds } } });

    const qaOutboxBeforeProjectionCleanup = syntheticDocumentKeys.length
      ? await prisma.searchIndexOutbox.findMany({
          where: { documentKey: { in: syntheticDocumentKeys } },
          select: { id: true },
        })
      : [];
    let searchProjectionCleanup: 'PASS' | 'FAILED' | 'NOT_REQUIRED' =
      syntheticDocumentKeys.length ? 'FAILED' : 'NOT_REQUIRED';
    let remainingSyntheticSearchDocuments: number | null = null;
    if (syntheticDocumentKeys.length) {
      const openSearchClient = new Client({
        node: 'http://127.0.0.1:9200',
        requestTimeout: 5000,
        maxRetries: 0,
      });
      const index = new OpenSearchIndexService(
        openSearchClient,
        new OpenSearchDocumentRepository(),
        'galilei-search-active',
      );
      try {
        for (const key of syntheticDocumentKeys) await index.indexKey(key);
        await openSearchClient.indices.refresh({
          index: 'galilei-search-active',
        });
        const response = await openSearchClient.search({
          index: 'galilei-search-active',
          body: {
            size: 0,
            track_total_hits: true,
            query: { ids: { values: syntheticDocumentIds } },
          },
        });
        const body =
          (
            response as unknown as {
              body?: { hits?: { total?: { value?: number } } };
            }
          ).body ??
          (response as unknown as { hits?: { total?: { value?: number } } });
        remainingSyntheticSearchDocuments = Number(
          body.hits?.total?.value ?? 0,
        );
        if (remainingSyntheticSearchDocuments === 0) {
          if (qaOutboxBeforeProjectionCleanup.length)
            await prisma.searchIndexOutbox.updateMany({
              where: {
                id: {
                  in: qaOutboxBeforeProjectionCleanup.map((event) => event.id),
                },
              },
              data: {
                processedAt: new Date(),
                failedAt: null,
                leaseUntil: null,
                lastError: null,
              },
            });
          searchProjectionCleanup = 'PASS';
        }
      } finally {
        await index.close();
        await openSearchClient.close();
      }
    }
    const qaOutboxAfterCleanup = syntheticDocumentKeys.length
      ? await prisma.searchIndexOutbox.findMany({
          where: { documentKey: { in: syntheticDocumentKeys } },
          select: { id: true, processedAt: true, failedAt: true },
        })
      : [];
    const [remainingPending, remainingFailed] = await Promise.all([
      prisma.searchIndexOutbox.count({
        where: { processedAt: null, failedAt: null },
      }),
      prisma.searchIndexOutbox.count({ where: { failedAt: { not: null } } }),
    ]);
    const remainingCorpusDocuments = syntheticDocumentIds.length
      ? await prisma.corpusDocument.count({
          where: { id: { in: syntheticDocumentIds } },
        })
      : 0;
    const [
      remainingWorkspaceDocuments,
      remainingFolders,
      remainingMemberships,
      remainingGrants,
      remainingWorkspaceRows,
      remainingOcrJobs,
      remainingDependencies,
      remainingUsers,
      remainingSearchTokens,
    ] = await Promise.all([
      prisma.workspaceDocument.count({
        where: {
          OR: [
            { workspaceId: { in: workspaceIds } },
            { ownerUserId: { in: userIds } },
          ],
        },
      }),
      prisma.workspaceFolder.count({
        where: {
          OR: [
            { workspaceId: { in: workspaceIds } },
            { ownerUserId: { in: userIds } },
          ],
        },
      }),
      prisma.workspaceMembership.count({
        where: { workspaceId: { in: workspaceIds } },
      }),
      prisma.workspaceFolderGrant.count({
        where: {
          OR: [
            { folder: { workspaceId: { in: workspaceIds } } },
            { folder: { ownerUserId: { in: userIds } } },
          ],
        },
      }),
      prisma.documentWorkspace.count({ where: { id: { in: workspaceIds } } }),
      prisma.corpusOcrJob.count({
        where: { documentId: { in: syntheticDocumentIds } },
      }),
      prisma.documentDependency.count({ where: { id: { in: dependencyIds } } }),
      prisma.usuario.count({ where: { id: { in: userIds } } }),
      syntheticDocumentIds.length
        ? prisma.$queryRawUnsafe<Array<{ count: string }>>(
            'SELECT count(*)::text AS count FROM "CorpusSearchToken" WHERE "documentId" = ANY($1::text[])',
            syntheticDocumentIds,
          )
        : Promise.resolve([{ count: '0' }]),
    ]);
    await prisma.$disconnect();
    if (previousStoragePath === undefined)
      delete process.env.BJC_CORPUS_STORAGE_PATH;
    else process.env.BJC_CORPUS_STORAGE_PATH = previousStoragePath;
    const safeRoot = path.resolve(
      process.cwd(),
      '../../_dev-corpus-storage-test',
    );
    if (storageRoot.startsWith(`${safeRoot}${path.sep}`))
      await rm(storageRoot, { recursive: true, force: true });
    const storageRootExists = await pathAccess(storageRoot)
      .then(() => true)
      .catch(() => false);
    const residualCounts = {
      workspaceDocuments: remainingWorkspaceDocuments,
      folders: remainingFolders,
      memberships: remainingMemberships,
      folderGrants: remainingGrants,
      workspaces: remainingWorkspaceRows,
      corpusDocuments: remainingCorpusDocuments,
      searchTokens: Number(remainingSearchTokens[0]?.count ?? 0),
      ocrJobs: remainingOcrJobs,
      dependencies: remainingDependencies,
      users: remainingUsers,
    };
    const cleanupResult =
      Object.values(residualCounts).every((count) => count === 0) &&
      searchProjectionCleanup !== 'FAILED' &&
      remainingSyntheticSearchDocuments === 0 &&
      qaOutboxAfterCleanup.every(
        (event) => event.processedAt !== null && event.failedAt === null,
      ) &&
      remainingPending === outboxBaseline.pending &&
      remainingFailed === outboxBaseline.failed &&
      !storageRootExists
        ? 'PASS'
        : 'REVIEW_REQUIRED';
    const cleanupVerification = {
      syntheticDocumentIds,
      syntheticDocumentKeys,
      databaseResiduals: residualCounts,
      searchProjection: {
        result: searchProjectionCleanup,
        remainingSyntheticDocuments: remainingSyntheticSearchDocuments,
      },
      outbox: {
        syntheticRows: qaOutboxAfterCleanup.length,
        qaOutboxEventIds: qaOutboxAfterCleanup.map((event) => String(event.id)),
        pending: qaOutboxAfterCleanup.filter(
          (event) => event.processedAt === null && event.failedAt === null,
        ).length,
        failed: qaOutboxAfterCleanup.filter((event) => event.failedAt !== null)
          .length,
        baseline: outboxBaseline,
        after: { pending: remainingPending, failed: remainingFailed },
      },
      storageRootExists,
      result: cleanupResult,
    };
    const artifactRoot = process.env.COPERNIC_ACL_ARTIFACT_ROOT;
    if (artifactRoot) {
      await mkdir(artifactRoot, { recursive: true });
      await writeFile(
        path.join(artifactRoot, 'cleanup-verification.json'),
        `${JSON.stringify(cleanupVerification, null, 2)}\n`,
        'utf8',
      );
    }
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
      await expect(
        documents.createFolder(workspace.id, admin, {
          name: `Ampliacion implicita ${suffix}`,
          parentId: restricted.id,
          visibilityScope: WorkspaceVisibilityScope.DEPENDENCY_SHARED,
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        documents.setRestrictedFolderMembers(
          workspace.id,
          inherited.id,
          admin,
          {
            visibilityScope: WorkspaceVisibilityScope.DEPENDENCY_SHARED,
            confirmAccessChange: true,
          },
        ),
      ).rejects.toMatchObject({ status: 400 });
      const creatorOnly = await documents.createFolder(workspace.id, grantee, {
        name: `Creada por editora ${suffix}`,
        visibilityScope: WorkspaceVisibilityScope.RESTRICTED,
      });
      expect(
        (await documents.folders(workspace.id, grantee)).map((item) => item.id),
      ).toEqual(
        expect.arrayContaining([restricted.id, inherited.id, creatorOnly.id]),
      );
      expect(
        (await documents.folders(workspace.id, grantee)).find(
          (item) => item.id === creatorOnly.id,
        )?.canManageAccess,
      ).toBe(true);
      expect(
        (await documents.folders(workspace.id, otherMember)).map(
          (item) => item.id,
        ),
      ).not.toEqual(
        expect.arrayContaining([restricted.id, inherited.id, creatorOnly.id]),
      );

      const payload = Buffer.from(
        `SPRINT1561PERSONALACL${suffix} acceso restringido y privado`,
        'utf8',
      );
      const filename = `sprint1561-${suffix}.txt`;
      const upload = {
        originalname: filename,
        mimetype: 'text/plain',
        buffer: payload,
        size: payload.byteLength,
      };

      // A workspace has one logical association per document. Put the shared
      // association in a second dependency so the same content can also stay
      // restricted in the first without conflating the two ACL decisions.
      const sharedWorkspace = await documents.createWorkspace(admin, {
        code: `S1561SH${suffix}`,
        name: 'Sprint 15.6.1 synthetic shared dependency',
        type: WorkspaceDependencyType.JUZGADO,
      });
      workspaceIds.push(sharedWorkspace.id);
      const sharedDependency =
        await prisma.documentDependency.findUniqueOrThrow({
          where: { code: sharedWorkspace.code },
          select: { id: true },
        });
      dependencyIds.push(sharedDependency.id);
      await documents.manageMember(sharedWorkspace.id, admin, {
        userId: grantee.id,
        role: WorkspaceRole.EDITOR,
      });
      await documents.manageMember(sharedWorkspace.id, admin, {
        userId: otherMember.id,
        role: WorkspaceRole.VIEWER,
      });
      const sharedFolder = await documents.createFolder(
        sharedWorkspace.id,
        admin,
        {
          name: `Compartida ${suffix}`,
          visibilityScope: WorkspaceVisibilityScope.DEPENDENCY_SHARED,
        },
      );

      const workspaceUpload = await documents.upload(
        workspace.id,
        admin,
        [upload],
        inherited.id,
      );
      const workspaceDocumentId = workspaceUpload.results[0]?.documentId;
      expect(workspaceUpload.results[0]).toMatchObject({
        status: 'INDEXED',
        duplicate: false,
      });
      documentIds.push(workspaceDocumentId);
      const repeatedWorkspaceUpload = await documents.upload(
        workspace.id,
        admin,
        [upload],
        inherited.id,
      );
      expect(repeatedWorkspaceUpload.results[0]).toMatchObject({
        documentId: workspaceDocumentId,
        duplicate: true,
      });

      const sharedUpload = await documents.upload(
        sharedWorkspace.id,
        admin,
        [upload],
        sharedFolder.id,
      );
      const sharedDocumentId = sharedUpload.results[0]?.documentId;
      expect(sharedUpload.results[0]).toMatchObject({
        status: 'INDEXED',
        duplicate: false,
      });
      documentIds.push(sharedDocumentId);
      expect(sharedDocumentId).not.toBe(workspaceDocumentId);

      const personalFolder = await documents.createPersonalFolder(grantee, {
        name: `Sólo yo ${suffix}`,
      });
      const personalUpload = await documents.uploadPersonal(
        grantee,
        [upload],
        personalFolder.id,
      );
      const personalDocumentId = personalUpload.results[0]?.documentId;
      expect(personalUpload.results[0]).toMatchObject({
        status: 'INDEXED',
        duplicate: false,
      });
      documentIds.push(personalDocumentId);
      expect(personalDocumentId).not.toBe(workspaceDocumentId);
      expect(personalDocumentId).not.toBe(sharedDocumentId);
      const repeatedPersonalUpload = await documents.uploadPersonal(
        grantee,
        [upload],
        personalFolder.id,
      );
      expect(repeatedPersonalUpload.results[0]).toMatchObject({
        documentId: personalDocumentId,
        duplicate: true,
      });
      const [workspaceFile, sharedFile, personalFile] = await Promise.all([
        prisma.corpusDocumentFile.findFirstOrThrow({
          where: { documentId: workspaceDocumentId },
          select: { sha256: true, storageKey: true },
        }),
        prisma.corpusDocumentFile.findFirstOrThrow({
          where: { documentId: sharedDocumentId },
          select: { sha256: true, storageKey: true },
        }),
        prisma.corpusDocumentFile.findFirstOrThrow({
          where: { documentId: personalDocumentId },
          select: { sha256: true, storageKey: true },
        }),
      ]);
      expect(sharedFile.sha256).toBe(workspaceFile.sha256);
      expect(sharedFile.storageKey).toBe(workspaceFile.storageKey);
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
        documents.makeDocumentPersonal(
          workspace.id,
          workspaceDocumentId,
          admin,
          {
            confirmAccessChange: true,
          },
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (await documents.documentsInWorkspace(workspace.id, admin)).find(
          (item) => item.documentId === workspaceDocumentId,
        )?.canMakePersonal,
      ).toBe(false);

      const token = `SPRINT1561PERSONALACL${suffix}`;
      const [
        allowedWorkspaceSearch,
        deniedWorkspaceSearch,
        sharedWorkspaceSearch,
        sharedWorkspaceSearchAsOther,
        ownerPersonalSearch,
        otherPersonalSearch,
      ] = await Promise.all([
        documents.searchWorkspace(workspace.id, grantee, token),
        documents.searchWorkspace(workspace.id, otherMember, token),
        documents.searchWorkspace(sharedWorkspace.id, grantee, token),
        documents.searchWorkspace(sharedWorkspace.id, otherMember, token),
        documents.searchPersonal(grantee, token),
        documents.searchPersonal(otherMember, token),
      ]);
      expect(
        allowedWorkspaceSearch?.results.map((item) => item.sourceId),
      ).toContain(workspaceDocumentId);
      expect(
        deniedWorkspaceSearch?.results.map((item) => item.sourceId),
      ).not.toContain(workspaceDocumentId);
      expect(
        sharedWorkspaceSearch?.results.map((item) => item.sourceId),
      ).toContain(sharedDocumentId);
      expect(
        sharedWorkspaceSearchAsOther?.results.map((item) => item.sourceId),
      ).toContain(sharedDocumentId);
      expect(
        ownerPersonalSearch?.results.map((item) => item.sourceId),
      ).toContain(personalDocumentId);
      expect(
        ownerPersonalSearch?.results.map((item) => item.sourceId),
      ).not.toEqual(
        expect.arrayContaining([workspaceDocumentId, sharedDocumentId]),
      );
      expect(
        otherPersonalSearch?.results.map((item) => item.sourceId),
      ).not.toContain(personalDocumentId);

      const paginationToken = `QARESTRICTEDPAGING${suffix}INTERNAL`;
      const deniedFolder = await documents.createFolder(workspace.id, admin, {
        name: `QA denegada ${suffix}`,
        visibilityScope: WorkspaceVisibilityScope.RESTRICTED,
        userIds: [],
      });
      const paginationCandidates: string[] = [];
      const paginationAuthorizedIds: string[] = [];
      const paginationDeniedIds: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const isAuthorized = index === 1 || index === 3;
        const content = Buffer.from(
          `${paginationToken} candidate ${index}`,
          'utf8',
        );
        const upload = await documents.upload(
          workspace.id,
          admin,
          [
            {
              originalname: `qa-restricted-page-${suffix}-${index}.txt`,
              mimetype: 'text/plain',
              buffer: content,
              size: content.byteLength,
            },
          ],
          isAuthorized ? restricted.id : deniedFolder.id,
        );
        const id = upload.results[0]?.documentId;
        expect(upload.results[0]?.status).toBe('INDEXED');
        expect(id).toBeTruthy();
        documentIds.push(id);
        paginationCandidates.push(id);
        (isAuthorized ? paginationAuthorizedIds : paginationDeniedIds).push(id);
      }

      type Candidate = {
        workspaceId: string | null;
        ownerUserId: number | null;
        projectedPrincipalIds: Set<string>;
      };
      const candidates = new Map<string, Candidate>([
        [
          workspaceDocumentId,
          {
            workspaceId: workspace.id,
            ownerUserId: null,
            projectedPrincipalIds: new Set([
              String(admin.id),
              String(grantee.id),
            ]),
          },
        ],
        [
          sharedDocumentId,
          {
            workspaceId: sharedWorkspace.id,
            ownerUserId: null,
            projectedPrincipalIds: new Set([
              String(admin.id),
              String(grantee.id),
              String(otherMember.id),
            ]),
          },
        ],
        [
          personalDocumentId,
          {
            workspaceId: null,
            ownerUserId: grantee.id,
            projectedPrincipalIds: new Set(),
          },
        ],
        ...paginationCandidates.map(
          (id) =>
            [
              id,
              {
                workspaceId: workspace.id,
                ownerUserId: null,
                // Deliberately over-broad stale ACL projection: PostgreSQL
                // must remove unauthorized IDs before count and page selection.
                projectedPrincipalIds: new Set([
                  String(admin.id),
                  String(grantee.id),
                ]),
              },
            ] as const,
        ),
      ]);
      const candidatesByToken = new Map<string, string[]>([
        [token, [workspaceDocumentId, sharedDocumentId, personalDocumentId]],
        [paginationToken, paginationCandidates],
      ]);
      const rawSearch = jest.fn(
        (request: {
          body?: {
            from?: number;
            size?: number;
            query?: unknown;
            search_after?: unknown[];
          };
        }) => {
          const serializedQuery = JSON.stringify(
            request.body?.query ?? {},
          ).toLowerCase();
          const queryToken = [...candidatesByToken.keys()].find((candidate) =>
            serializedQuery.includes(candidate.toLowerCase()),
          );
          let matchingIds = queryToken
            ? candidatesByToken.get(queryToken)!
            : [];
          const workspaceMatch = serializedQuery.match(
            /"workspaceid":"([^"]+)"/u,
          );
          const ownerMatch = serializedQuery.match(/"owneruserid":"([^"]+)"/u);
          const aclMatch = serializedQuery.match(/"aclprincipalids":"(\d+)"/u);
          matchingIds = matchingIds.filter((id) => {
            const candidate = candidates.get(id);
            if (!candidate) return false;
            if (workspaceMatch && candidate.workspaceId !== workspaceMatch[1])
              return false;
            if (ownerMatch && String(candidate.ownerUserId) !== ownerMatch[1])
              return false;
            if (aclMatch && !candidate.projectedPrincipalIds.has(aclMatch[1]))
              return false;
            return true;
          });
          const after = request.body?.search_after;
          const start = Array.isArray(after)
            ? Number(after[0]) + 1
            : Math.max(0, request.body?.from ?? 0);
          const size = Math.max(1, request.body?.size ?? 10);
          const hits = matchingIds
            .slice(start, start + size)
            .map((id, offset) => ({
              _id: id,
              _score: 1,
              sort: [start + offset],
            }));
          return Promise.resolve({
            body: {
              hits: {
                total: { value: matchingIds.length, relation: 'eq' as const },
                hits,
              },
            },
          });
        },
      );
      const openSearchBacked = new OpenSearchSearchSourceAdapter(
        {
          createPit: jest.fn().mockResolvedValue({
            body: { pit_id: `synthetic-${suffix}` },
          }),
          search: rawSearch,
          deletePit: jest.fn().mockResolvedValue({ body: { succeeded: true } }),
        } as unknown as Client,
        'synthetic-restricted-acl-index',
        'CORPUS',
        (query, context, ids) => searchSource.search(query, context, ids),
      );
      const privateSearchContext = {
        visibility: 'ADMIN' as const,
        dialect: 'modern' as const,
        publicationPolicy: 'legacy-active-only' as const,
        sourceSystems: ['CORPUS' as const],
        page: 1,
        pageSize: 10,
        documentScope: {
          kind: 'WORKSPACE' as const,
          workspaceId: workspace.id,
          userId: grantee.id,
        },
      };
      const runSearch = async (
        queryText: string,
        context: Parameters<OpenSearchSearchSourceAdapter['search']>[1],
      ) => {
        const result = await openSearchBacked.search(
          parseSearchQuery(queryText),
          context,
        );
        return {
          total: result.total,
          totalExact: result.totalExact ?? true,
          page: result.page,
          pageSize: result.pageSize,
          hasMore: result.hasMore ?? false,
          resultIds: result.results.map((item) => item.sourceId),
          resultScores: result.results.map((item) => item.score),
        };
      };
      const runPrivateSearch = () => runSearch(token, privateSearchContext);
      const captureStatus = async (operation: () => Promise<unknown>) => {
        try {
          await operation();
          return 200;
        } catch (error) {
          const candidate = error as {
            getStatus?: () => number;
            status?: number;
          };
          return typeof candidate.getStatus === 'function'
            ? candidate.getStatus()
            : (candidate.status ?? 500);
        }
      };
      const runViewerChecks = async () => ({
        metadata: await captureStatus(() =>
          access.metadata(
            workspaceDocumentId,
            'RESTRICTED',
            undefined,
            workspace.id,
            grantee.id,
          ),
        ),
        matches: await captureStatus(() =>
          access.matches(
            workspaceDocumentId,
            'RESTRICTED',
            token,
            workspace.id,
            grantee.id,
          ),
        ),
        file: await captureStatus(() =>
          access.file(
            workspaceDocumentId,
            'RESTRICTED',
            workspace.id,
            grantee.id,
          ),
        ),
      });
      const privateBefore = await runPrivateSearch();
      const viewerBefore = await runViewerChecks();
      const adminSearch = await runSearch(token, {
        ...privateSearchContext,
        documentScope: {
          ...privateSearchContext.documentScope,
          userId: admin.id,
        },
      });
      const restrictedDeniedSearch = await runSearch(token, {
        ...privateSearchContext,
        documentScope: {
          ...privateSearchContext.documentScope,
          userId: otherMember.id,
        },
      });
      const nonMemberSearch = await runSearch(token, {
        ...privateSearchContext,
        documentScope: {
          ...privateSearchContext.documentScope,
          userId: outsider.id,
        },
      });
      const personalOwnerSearch = await runSearch(token, {
        ...privateSearchContext,
        documentScope: { kind: 'PERSONAL', userId: grantee.id },
      });
      const personalDeniedSearch = await runSearch(token, {
        ...privateSearchContext,
        documentScope: { kind: 'PERSONAL', userId: otherMember.id },
      });
      const sharedMemberSearch = await runSearch(token, {
        ...privateSearchContext,
        documentScope: {
          kind: 'WORKSPACE',
          workspaceId: sharedWorkspace.id,
          userId: otherMember.id,
        },
      });
      const sharedNonMemberSearch = await runSearch(token, {
        ...privateSearchContext,
        documentScope: {
          kind: 'WORKSPACE',
          workspaceId: sharedWorkspace.id,
          userId: outsider.id,
        },
      });
      const paginationPages = await Promise.all(
        [1, 2].map((requestedPage) =>
          runSearch(paginationToken, {
            ...privateSearchContext,
            page: requestedPage,
            pageSize: 1,
          }),
        ),
      );
      const paginationProfile = openSearchBacked.getLastSearchProfile();
      expect(
        (await documents.documentsInWorkspace(workspace.id, grantee)).map(
          (item) => item.documentId,
        ),
      ).toContain(workspaceDocumentId);
      expect(
        (await documents.documentsInWorkspace(workspace.id, otherMember)).map(
          (item) => item.documentId,
        ),
      ).not.toContain(workspaceDocumentId);
      expect(
        (await documents.documentsInWorkspace(sharedWorkspace.id, grantee)).map(
          (item) => item.documentId,
        ),
      ).toContain(sharedDocumentId);
      expect(
        (
          await documents.documentsInWorkspace(sharedWorkspace.id, otherMember)
        ).map((item) => item.documentId),
      ).toContain(sharedDocumentId);
      expect(
        (
          await documents.searchNames(workspace.id, grantee, suffix)
        ).results.map((item) => item.documentId),
      ).toContain(workspaceDocumentId);
      expect(
        (
          await documents.searchNames(workspace.id, otherMember, suffix)
        ).results.map((item) => item.documentId),
      ).not.toContain(workspaceDocumentId);
      expect(
        (
          await documents.searchNames(sharedWorkspace.id, grantee, suffix)
        ).results.map((item) => item.documentId),
      ).toContain(sharedDocumentId);
      expect(
        (
          await documents.searchNames(sharedWorkspace.id, otherMember, suffix)
        ).results.map((item) => item.documentId),
      ).toContain(sharedDocumentId);
      expect(
        personalResultDocumentIds(
          await documents.personalDocuments(grantee, personalFolder.id),
        ),
      ).toContain(personalDocumentId);
      expect(
        personalResultDocumentIds(
          await documents
            .personalDocuments(otherMember, personalFolder.id)
            .catch(() => []),
        ),
      ).not.toContain(personalDocumentId);
      expect(
        personalResultDocumentIds(await documents.personalDocuments(admin)),
      ).not.toContain(personalDocumentId);

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
        expect.arrayContaining([
          workspaceDocumentId,
          sharedDocumentId,
          personalDocumentId,
        ]),
      );
      await expect(
        access.metadata(
          workspaceDocumentId,
          'RESTRICTED',
          undefined,
          workspace.id,
          otherMember.id,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        access.matches(
          workspaceDocumentId,
          'RESTRICTED',
          token,
          workspace.id,
          otherMember.id,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        access.file(
          workspaceDocumentId,
          'RESTRICTED',
          workspace.id,
          otherMember.id,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        access.metadata(
          personalDocumentId,
          'RESTRICTED',
          undefined,
          undefined,
          otherMember.id,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        access.matches(
          personalDocumentId,
          'RESTRICTED',
          token,
          undefined,
          otherMember.id,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        access.file(
          personalDocumentId,
          'RESTRICTED',
          undefined,
          otherMember.id,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        access.metadata(personalDocumentId, 'ADMIN'),
      ).rejects.toMatchObject({ status: 404 });

      const authorizedMetadata = await documents.metadata(
        workspace.id,
        workspaceDocumentId,
        grantee,
      );
      expect(authorizedMetadata.file?.href).toBe(
        `/api/workspaces/${workspace.id}/documents/${workspaceDocumentId}/file`,
      );
      const sharedMetadata = await documents.metadata(
        sharedWorkspace.id,
        sharedDocumentId,
        otherMember,
      );
      expect(sharedMetadata.file?.href).toBe(
        `/api/workspaces/${sharedWorkspace.id}/documents/${sharedDocumentId}/file`,
      );
      const personalMetadata = await documents.personalMetadata(
        personalDocumentId,
        grantee,
      );
      expect(personalMetadata.file?.href).toBe(
        `/api/personal/documents/${personalDocumentId}/file`,
      );
      expect(
        (await documents.personalFile(personalDocumentId, grantee)).content,
      ).toEqual(payload);
      expect(
        (await documents.file(workspace.id, workspaceDocumentId, grantee))
          .content,
      ).toEqual(payload);
      expect(
        (
          await documents.file(
            sharedWorkspace.id,
            sharedDocumentId,
            otherMember,
          )
        ).content,
      ).toEqual(payload);
      await expect(
        access.metadata(
          sharedDocumentId,
          'RESTRICTED',
          undefined,
          sharedWorkspace.id,
          otherMember.id,
        ),
      ).resolves.toMatchObject({ id: sharedDocumentId });
      await expect(
        access.metadata(
          sharedDocumentId,
          'RESTRICTED',
          undefined,
          sharedWorkspace.id,
          grantee.id,
        ),
      ).resolves.toMatchObject({ id: sharedDocumentId });
      await expect(
        access.matches(
          sharedDocumentId,
          'RESTRICTED',
          token,
          sharedWorkspace.id,
          otherMember.id,
        ),
      ).resolves.toBeDefined();
      await expect(
        access.file(
          sharedDocumentId,
          'RESTRICTED',
          sharedWorkspace.id,
          otherMember.id,
        ),
      ).resolves.toMatchObject({ sha256: sharedFile.sha256 });

      await documents.setRestrictedFolderMembers(
        workspace.id,
        restricted.id,
        admin,
        {
          visibilityScope: WorkspaceVisibilityScope.RESTRICTED,
          userIds: [],
        },
      );
      const privateRevokedWithStaleProjection = await runPrivateSearch();
      const viewerRevoked = await runViewerChecks();
      candidates
        .get(workspaceDocumentId)
        ?.projectedPrincipalIds.delete(String(grantee.id));
      const privateRevokedAfterProjectionRefresh = await runPrivateSearch();
      expect(
        (await documents.folders(workspace.id, grantee)).map((item) => item.id),
      ).not.toContain(restricted.id);
      await expect(
        access.metadata(
          workspaceDocumentId,
          'RESTRICTED',
          undefined,
          workspace.id,
          grantee.id,
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await documents.personalFile(personalDocumentId, grantee)).content,
      ).toEqual(payload);

      await documents.setRestrictedFolderMembers(
        workspace.id,
        restricted.id,
        admin,
        {
          visibilityScope: WorkspaceVisibilityScope.RESTRICTED,
          userIds: [grantee.id],
        },
      );
      const privateRestoredWithStaleProjection = await runPrivateSearch();
      const viewerRestored = await runViewerChecks();
      const aclLifecycle = {
        backendRestarted: false,
        before: { search: privateBefore, viewer: viewerBefore },
        revokedWithStaleProjection: {
          search: privateRevokedWithStaleProjection,
          viewer: viewerRevoked,
        },
        revokedAfterProjectionRefresh: privateRevokedAfterProjectionRefresh,
        restoredWithStaleProjection: {
          search: privateRestoredWithStaleProjection,
          viewer: viewerRestored,
        },
        userMatrix: {
          restrictedAdmin: adminSearch,
          restrictedAllowed: privateBefore,
          restrictedDenied: restrictedDeniedSearch,
          nonMember: nonMemberSearch,
          personalOwner: personalOwnerSearch,
          personalOther: personalDeniedSearch,
          sharedMember: sharedMemberSearch,
          sharedNonMember: sharedNonMemberSearch,
        },
        pagination: {
          rawCandidateIds: paginationCandidates,
          expectedAuthorizedIds: paginationAuthorizedIds,
          expectedDeniedIds: paginationDeniedIds,
          pages: paginationPages,
          uniqueResultIds: [
            ...new Set(paginationPages.flatMap((item) => item.resultIds)),
          ],
          profile: paginationProfile,
        },
      };
      const artifactRoot = process.env.COPERNIC_ACL_ARTIFACT_ROOT;
      if (artifactRoot) {
        await mkdir(artifactRoot, { recursive: true });
        const artifacts = [
          ['restricted-lifecycle-observed.json', aclLifecycle],
          [
            'restricted-revoke-test.json',
            {
              before: privateBefore,
              afterRevokeWithStaleProjection: privateRevokedWithStaleProjection,
              afterProjectionRefresh: privateRevokedAfterProjectionRefresh,
              backendRestarted: false,
            },
          ],
          [
            'restricted-restore-test.json',
            {
              afterRestoreWithStaleProjection:
                privateRestoredWithStaleProjection,
              backendRestarted: false,
              convergence:
                'immediate live PostgreSQL authorization; no outbox wait',
            },
          ],
          [
            'restricted-viewer-test.json',
            {
              before: viewerBefore,
              revoked: viewerRevoked,
              restored: viewerRestored,
              routeContract: 'metadata/matches/file services map denial to 404',
            },
          ],
          [
            'pagination-acl-tests.json',
            {
              rawCandidateCount: 5,
              authorizedIds: paginationAuthorizedIds,
              deniedIds: paginationDeniedIds,
              pages: paginationPages,
              uniqueResultIds: [
                ...new Set(paginationPages.flatMap((item) => item.resultIds)),
              ],
              profile: paginationProfile,
            },
          ],
          [
            'personal-regression.json',
            { owner: personalOwnerSearch, unauthorized: personalDeniedSearch },
          ],
          [
            'shared-regression.json',
            { member: sharedMemberSearch, nonMember: sharedNonMemberSearch },
          ],
          [
            'same-sha-regression.json',
            {
              sharedBinarySha256: workspaceFile.sha256,
              logicalDocumentIds: [
                workspaceDocumentId,
                sharedDocumentId,
                personalDocumentId,
              ],
              distinctLogicalDocuments:
                new Set([
                  workspaceDocumentId,
                  sharedDocumentId,
                  personalDocumentId,
                ]).size === 3,
              scopedSearches: {
                restricted: privateBefore.resultIds,
                shared: sharedMemberSearch.resultIds,
                personal: personalOwnerSearch.resultIds,
              },
            },
          ],
          [
            'multi-dependency-regression.json',
            {
              dependencyA: {
                workspaceId: workspace.id,
                results: privateBefore.resultIds,
              },
              dependencyB: {
                workspaceId: sharedWorkspace.id,
                results: sharedMemberSearch.resultIds,
              },
              crossDependencyLeak:
                privateBefore.resultIds.includes(sharedDocumentId) ||
                sharedMemberSearch.resultIds.includes(workspaceDocumentId),
              outsider: sharedNonMemberSearch,
            },
          ],
        ] as const;
        await Promise.all(
          artifacts.map(([name, value]) =>
            writeFile(
              path.join(artifactRoot, name),
              `${JSON.stringify(value, null, 2)}\n`,
              'utf8',
            ),
          ),
        );
      }
      expect(privateBefore).toMatchObject({
        total: 1,
        totalExact: true,
        resultIds: [workspaceDocumentId],
      });
      expect(viewerBefore).toEqual({ metadata: 200, matches: 200, file: 200 });
      expect(privateRevokedWithStaleProjection).toMatchObject({
        total: 0,
        totalExact: true,
        resultIds: [],
      });
      expect(viewerRevoked).toEqual({ metadata: 404, matches: 404, file: 404 });
      expect(privateRevokedAfterProjectionRefresh).toMatchObject({
        total: 0,
        totalExact: true,
        resultIds: [],
      });
      expect(privateRestoredWithStaleProjection).toMatchObject({
        total: 1,
        totalExact: true,
        resultIds: [workspaceDocumentId],
      });
      expect(viewerRestored).toEqual({
        metadata: 200,
        matches: 200,
        file: 200,
      });
      expect(adminSearch).toMatchObject({
        total: 1,
        resultIds: [workspaceDocumentId],
      });
      expect(restrictedDeniedSearch).toMatchObject({ total: 0, resultIds: [] });
      expect(nonMemberSearch).toMatchObject({ total: 0, resultIds: [] });
      expect(personalOwnerSearch).toMatchObject({
        total: 1,
        resultIds: [personalDocumentId],
      });
      expect(personalDeniedSearch).toMatchObject({ total: 0, resultIds: [] });
      expect(sharedMemberSearch).toMatchObject({
        total: 1,
        resultIds: [sharedDocumentId],
      });
      expect(sharedNonMemberSearch).toMatchObject({ total: 0, resultIds: [] });
      expect(paginationPages).toEqual([
        expect.objectContaining({
          total: 2,
          totalExact: true,
          page: 1,
          pageSize: 1,
          hasMore: true,
          resultIds: [paginationAuthorizedIds[0]],
        }),
        expect.objectContaining({
          total: 2,
          totalExact: true,
          page: 2,
          pageSize: 1,
          hasMore: false,
          resultIds: [paginationAuthorizedIds[1]],
        }),
      ]);
      expect(
        new Set(paginationPages.flatMap((item) => item.resultIds)),
      ).toEqual(new Set(paginationAuthorizedIds));
      expect(
        paginationPages
          .flatMap((item) => item.resultIds)
          .some((id) => paginationDeniedIds.includes(id)),
      ).toBe(false);
      expect(paginationProfile?.candidateStrategy).toBe(
        'opensearch-ordered-batched-live-acl-before-count-and-page',
      );
      expect(paginationProfile?.stageTimings).toMatchObject({
        rawCandidateCount: 5,
        authorizedTotal: 2,
        postgresAuthorizationBatchCount: 1,
      });
      await documents.manageMember(workspace.id, admin, {
        userId: grantee.id,
        role: WorkspaceRole.VIEWER,
        active: false,
      });
      await expect(
        access.metadata(
          workspaceDocumentId,
          'RESTRICTED',
          undefined,
          workspace.id,
          grantee.id,
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await documents.personalFile(personalDocumentId, grantee)).content,
      ).toEqual(payload);
    },
  );
});

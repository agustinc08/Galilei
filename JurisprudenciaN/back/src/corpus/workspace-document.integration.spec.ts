import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { parseSearchQuery } from '../busqueda/utils/search-parser';
import { WorkspaceDocumentService } from './workspace-document.service';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import { CorpusSearchSourceAdapter } from './corpus-search.adapter';
import { LocalDocumentStorageAdapter } from './document-storage.adapter';

const enabled = process.env.SPRINT15_POSTGRES_TEST === '1';
const testStorage = path.resolve(
  process.cwd(),
  '../../_dev-corpus-storage-test/sprint15-workspaces',
);

describe('Sprint 15 private workspace PostgreSQL isolation', () => {
  const prisma = new PrismaService();
  let source: CorpusSearchSourceAdapter;
  let service: WorkspaceDocumentService;
  let access: CorpusDocumentAccessService;
  let storage: LocalDocumentStorageAdapter;
  const previousStoragePath = process.env.BJC_CORPUS_STORAGE_PATH;
  const userIds: number[] = [];
  const workspaceIds: string[] = [];
  const dependencyIds: string[] = [];
  const documentIds: string[] = [];
  const suffix =
    `${Date.now()}${Math.random().toString(16).slice(2, 6)}`.toUpperCase();
  const makeUser = (id: number, email: string): AuthenticatedUser => ({
    id,
    nombre: email,
    apellido: null,
    email,
    activo: true,
    rol: { id: 0, nombre: 'ADMIN', descripcion: null },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  let adminA: AuthenticatedUser;
  let adminB: AuthenticatedUser;
  let viewer: AuthenticatedUser;

  beforeAll(async () => {
    if (!enabled) return;
    process.env.BJC_CORPUS_STORAGE_PATH = testStorage;
    await prisma.$connect();
    source = new CorpusSearchSourceAdapter();
    storage = new LocalDocumentStorageAdapter(testStorage);
    access = new CorpusDocumentAccessService(prisma);
    const search = {
      federatedSearch: async (
        query: string,
        _operator: 'AND',
        context: Parameters<CorpusSearchSourceAdapter['search']>[1],
      ) => source.search(parseSearchQuery(query), context),
    };
    service = new WorkspaceDocumentService(
      prisma,
      search as never,
      access,
      storage,
    );
    const adminRole = await prisma.rol.findUniqueOrThrow({
      where: { nombre: 'ADMIN' },
    });
    const lectRole = await prisma.rol.findUniqueOrThrow({
      where: { nombre: 'LECTOR' },
    });
    const a = await prisma.usuario.create({
      data: {
        nombre: 'Synthetic Workspace A',
        email: `sprint15-a-${suffix}@example.invalid`,
        passwordHash: 'synthetic-only',
        rolId: adminRole.id,
      },
    });
    const b = await prisma.usuario.create({
      data: {
        nombre: 'Synthetic Workspace B',
        email: `sprint15-b-${suffix}@example.invalid`,
        passwordHash: 'synthetic-only',
        rolId: adminRole.id,
      },
    });
    const c = await prisma.usuario.create({
      data: {
        nombre: 'Synthetic Workspace Viewer',
        email: `sprint15-view-${suffix}@example.invalid`,
        passwordHash: 'synthetic-only',
        rolId: lectRole.id,
      },
    });
    userIds.push(a.id, b.id, c.id);
    adminA = makeUser(a.id, a.email);
    adminB = makeUser(b.id, b.email);
    viewer = {
      ...makeUser(c.id, c.email),
      rol: { id: lectRole.id, nombre: 'LECTOR', descripcion: null },
    };
  });

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
    if (userIds.length)
      await prisma.usuario.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    if (previousStoragePath === undefined)
      delete process.env.BJC_CORPUS_STORAGE_PATH;
    else process.env.BJC_CORPUS_STORAGE_PATH = previousStoragePath;
    const safeRoot = path.resolve(
      process.cwd(),
      '../../_dev-corpus-storage-test',
    );
    if (testStorage.startsWith(`${safeRoot}${path.sep}`))
      await rm(testStorage, { recursive: true, force: true });
  });

  (enabled ? it : it.skip)(
    'isolates search, counts, direct viewer/download and generic Corpus; deduplicates blob across workspaces',
    async () => {
      const workspaceA = await service.createWorkspace(adminA, {
        code: `SPRINT15A${suffix}`,
        name: 'Synthetic Juzgado Civil 64',
        type: 'JUZGADO',
      });
      const workspaceB = await service.createWorkspace(adminB, {
        code: `SPRINT15B${suffix}`,
        name: 'Synthetic Juzgado Civil 23',
        type: 'JUZGADO',
      });
      workspaceIds.push(workspaceA.id, workspaceB.id);
      expect(await service.administeredWorkspaces(adminA)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: workspaceA.id, active: true }),
          expect.objectContaining({ id: workspaceB.id, active: true }),
        ]),
      );
      const deps = await prisma.documentDependency.findMany({
        where: { code: { in: [workspaceA.code, workspaceB.code] } },
        select: { id: true },
      });
      dependencyIds.push(...deps.map((item) => item.id));
      await service.manageMember(workspaceA.id, adminA, {
        userId: viewer.id,
        role: 'VIEWER',
      });
      const folder = await service.createFolder(workspaceA.id, adminA, {
        name: 'Presentaciones',
      });
      expect(
        await service.renameFolder(workspaceA.id, folder.id, adminA, {
          name: 'Presentaciones 2026',
        }),
      ).toMatchObject({ name: 'Presentaciones 2026' });
      await expect(
        service.renameFolder(workspaceA.id, folder.id, adminB, {
          name: 'Fuera de alcance',
        }),
      ).rejects.toMatchObject({ status: 404 });
      const foreignFolder = await service.createFolder(workspaceB.id, adminB, {
        name: 'Privada B',
      });
      const pdf = await readFile(
        path.join(
          process.cwd(),
          'scripts/dev/fixtures/corpus/fallo-fixture.pdf',
        ),
      );
      const upload = {
        originalname: 'sprint15-fixture.pdf',
        mimetype: 'application/pdf',
        buffer: pdf,
        size: pdf.byteLength,
      };
      const a = await service.upload(
        workspaceA.id,
        adminA,
        [upload],
        folder.id,
      );
      const repeatedA = await service.upload(
        workspaceA.id,
        adminA,
        [upload],
        folder.id,
      );
      const b = await service.upload(workspaceB.id, adminB, [upload]);
      const idA = a.results[0].documentId;
      const idB = b.results[0].documentId;
      expect(repeatedA.results[0]).toMatchObject({
        documentId: idA,
        duplicate: true,
      });
      expect(
        await prisma.workspaceDocument.count({
          where: { workspaceId: workspaceA.id, documentId: idA },
        }),
      ).toBe(1);
      documentIds.push(idA, idB);
      expect(idA).not.toBe(idB);
      const [fileA, fileB] = await Promise.all([
        prisma.corpusDocumentFile.findFirstOrThrow({
          where: { documentId: idA },
        }),
        prisma.corpusDocumentFile.findFirstOrThrow({
          where: { documentId: idB },
        }),
      ]);
      expect(fileA.sha256).toBe(fileB.sha256);
      expect(fileA.storageKey).toBe(fileB.storageKey);

      const partialUpload = await service.upload(workspaceA.id, adminA, [
        {
          ...upload,
          originalname: 'archivo-corrupto.pdf',
          buffer: Buffer.from('%PDF-archivo-roto'),
          size: 16,
        },
        upload,
      ]);
      expect(partialUpload.results.map((result) => result.status)).toEqual([
        'ERROR',
        expect.any(String),
      ]);
      expect(partialUpload.results[1].duplicate).toBe(true);
      const nameResults = await service.searchNames(
        workspaceA.id,
        viewer,
        'sprint15-fixture',
      );
      expect(nameResults.total).toBe(1);
      expect(nameResults.results[0]).toMatchObject({
        documentId: idA,
        filename: 'sprint15-fixture.pdf',
      });
      const folderSearch = await service.searchWorkspace(
        workspaceA.id,
        adminA,
        'JORGE',
        1,
        20,
        folder.id,
      );
      expect(folderSearch?.results.map((result) => result.sourceId)).toContain(
        idA,
      );
      const rootSearch = await service.searchWorkspace(
        workspaceA.id,
        adminA,
        'JORGE',
        1,
        20,
        null,
      );
      expect(
        rootSearch?.results.map((result) => result.sourceId),
      ).not.toContain(idA);
      await expect(
        service.searchWorkspace(
          workspaceA.id,
          adminA,
          'JORGE',
          1,
          20,
          foreignFolder.id,
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        await service.memberCandidates(workspaceA.id, adminA, viewer.email),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: viewer.id, email: viewer.email }),
        ]),
      );

      const [aSearch, bSearch] = await Promise.all([
        service.searchWorkspace(
          workspaceA.id,
          adminA,
          '"JORGE PORCEL FIXTURE"',
        ),
        service.searchWorkspace(
          workspaceB.id,
          adminB,
          '"JORGE PORCEL FIXTURE"',
        ),
      ]);
      if (!aSearch || !bSearch)
        throw new Error('Federated Corpus search is unavailable.');
      expect(aSearch.total).toBe(1);
      expect(aSearch.results.map((row) => row.sourceId)).toContain(idA);
      expect(bSearch.total).toBe(1);
      expect(bSearch.results.map((row) => row.sourceId)).toContain(idB);
      expect(bSearch.results.map((row) => row.sourceId)).not.toContain(idA);
      expect(aSearch.results[0].document?.href).toBe(
        `/api/workspaces/${workspaceA.id}/documents/${idA}/file`,
      );
      const general = await source.search(
        parseSearchQuery('"JORGE PORCEL FIXTURE"'),
        {
          visibility: 'ADMIN',
          dialect: 'modern',
          publicationPolicy: 'legacy-active-only',
          page: 1,
          pageSize: 20,
        },
      );
      expect(
        general.results.some(
          (row) => row.sourceId === idA || row.sourceId === idB,
        ),
      ).toBe(false);
      const timeSearch = async (run: () => Promise<unknown>) => {
        const samples: number[] = [];
        let failures = 0;
        const sample = async () => {
          const started = performance.now();
          try {
            await run();
            samples.push(Number((performance.now() - started).toFixed(2)));
          } catch {
            failures += 1;
          }
        };
        await sample();
        for (let index = 0; index < 3; index += 1) {
          await sample();
        }
        const ordered = [...samples].sort((left, right) => left - right);
        return {
          p50Ms: ordered.length
            ? ordered[Math.floor((ordered.length - 1) / 2)]
            : null,
          p95Ms: ordered.length
            ? ordered[Math.ceil(ordered.length * 0.95) - 1]
            : null,
          failures,
          successfulSamples: ordered.length,
        };
      };
      const generalContext = {
        visibility: 'ADMIN' as const,
        dialect: 'modern' as const,
        publicationPolicy: 'legacy-active-only' as const,
        page: 1,
        pageSize: 20,
      };
      const performanceSample = {
        generalTerm: await timeSearch(() =>
          source.search(parseSearchQuery('responsabilidad'), generalContext),
        ),
        generalPhrase: await timeSearch(() =>
          source.search(
            parseSearchQuery('"responsabilidad civil"'),
            generalContext,
          ),
        ),
        privateTerm: await timeSearch(() =>
          service.searchWorkspace(workspaceA.id, adminA, 'JORGE'),
        ),
        privatePhrase: await timeSearch(() =>
          service.searchWorkspace(
            workspaceA.id,
            adminA,
            '"JORGE PORCEL FIXTURE"',
          ),
        ),
      };
      console.log(
        `SPRINT15_SEARCH_PERFORMANCE=${JSON.stringify(performanceSample)}`,
      );

      await expect(
        service.metadata(workspaceB.id, idA, adminB),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.matches(workspaceB.id, idA, adminB, 'JORGE'),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.file(workspaceB.id, idA, adminB),
      ).rejects.toMatchObject({ status: 404 });
      expect((await service.metadata(workspaceA.id, idA, adminA)).id).toBe(idA);
      expect((await service.file(workspaceA.id, idA, adminA)).sha256).toBe(
        fileA.sha256,
      );
      expect(
        (await service.matches(workspaceA.id, idA, adminA, 'JORGE')).total,
      ).toBeGreaterThan(0);
      const viewerSearch = await service.searchWorkspace(
        workspaceA.id,
        viewer,
        'JORGE',
      );
      expect(viewerSearch?.results.map((row) => row.sourceId)).toContain(idA);
      await expect(
        service.metadata(workspaceA.id, idA, adminB),
      ).rejects.toMatchObject({ status: 404 });
      await expect(access.metadata(idA, 'ADMIN')).rejects.toMatchObject({
        status: 404,
      });
      await expect(access.file(idA, 'ADMIN')).rejects.toMatchObject({
        status: 404,
      });
      expect(
        (
          await service.documentsInWorkspace(workspaceA.id, adminA, folder.id)
        ).map((item) => item.documentId),
      ).toContain(idA);
      await expect(
        service.upload(workspaceA.id, viewer, [upload]),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.createFolder(workspaceA.id, viewer, { name: 'Sin permiso' }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.moveDocument(workspaceA.id, idA, viewer, null),
      ).rejects.toMatchObject({ status: 403 });
      expect(await service.members(workspaceA.id, adminA)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: viewer.id,
            role: 'VIEWER',
            active: true,
          }),
        ]),
      );
      await expect(
        service.moveDocument(workspaceA.id, idA, adminB, null),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.moveDocument(workspaceA.id, idA, adminA, foreignFolder.id),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        await service.moveDocument(workspaceA.id, idA, adminA, null),
      ).toMatchObject({ documentId: idA, folderId: null });
      await expect(
        service.documentsInWorkspace(workspaceA.id, adminB),
      ).rejects.toMatchObject({ status: 404 });
      expect(await service.mine(adminB)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: workspaceB.id }),
        ]),
      );
      expect(await service.mine(adminB)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: workspaceA.id }),
        ]),
      );
      expect(await service.activity(workspaceA.id, adminA)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ accion: 'FOLDER_RENAME' }),
          expect.objectContaining({ accion: 'MEMBER_UPSERT' }),
        ]),
      );
      await expect(
        service.activity(workspaceA.id, adminB),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.setWorkspaceActive(workspaceA.id, adminA, false),
      ).resolves.toMatchObject({ active: false });
      await expect(
        service.documentsInWorkspace(workspaceA.id, adminA),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.setWorkspaceActive(workspaceA.id, adminA, true),
      ).resolves.toMatchObject({ active: true });
      await expect(
        service.manageMember(workspaceA.id, adminA, {
          userId: adminA.id,
          role: 'ADMIN',
          active: false,
        }),
      ).rejects.toMatchObject({ status: 400 });

      const benchmarkRows: Array<Record<string, unknown>> = [];
      for (const size of [100, 500, 1000]) {
        const workspace = await service.createWorkspace(adminA, {
          code: `S15B${size}${suffix}`,
          name: `Synthetic workspace benchmark ${size}`,
          type: 'DEPENDENCIA',
        });
        workspaceIds.push(workspace.id);
        const dependency = await prisma.documentDependency.findUniqueOrThrow({
          where: { code: workspace.code },
          select: { id: true },
        });
        dependencyIds.push(dependency.id);
        const ids = Array.from(
          { length: size },
          (_, index) => `s15bm_${suffix.toLowerCase()}_${size}_${index}`,
        );
        documentIds.push(...ids);
        await prisma.corpusDocument.createMany({
          data: ids.map((id, index) => ({
            id,
            title: `Synthetic private benchmark ${size} document ${index + 1}`,
            documentType: 'PRIVATE_BENCHMARK',
            jurisdiction: 'CIVIL',
            visibility: 'RESTRICTED',
            documentScope: 'PRIVATE_WORKSPACE' as const,
            status: 'INDEXED',
            searchText: `sprint151needle phrase target synthetic private document ${index + 1}`,
          })),
        });
        await prisma.workspaceDocument.createMany({
          data: ids.map((documentId) => ({
            workspaceId: workspace.id,
            documentId,
            uploadedById: adminA.id,
          })),
        });
        const tokenRows = ids.flatMap((id) =>
          ['sprint151needle', 'phrase', 'target'].map(
            (token) => Prisma.sql`(${id}, ${token})`,
          ),
        );
        await prisma.$executeRaw(
          Prisma.sql`INSERT INTO "CorpusSearchToken" ("documentId", "token") VALUES ${Prisma.join(tokenRows)}`,
        );

        const measure = async (query: string, expectExactTotal: boolean) => {
          const samples: Array<{ totalMs: number; adapterMs: number }> = [];
          let reportedTotal = 0;
          let reportedTotalExact = false;
          for (let index = 0; index < 6; index += 1) {
            const startedAt = performance.now();
            const result = await service.searchWorkspace(
              workspace.id,
              adminA,
              query,
            );
            const totalMs = performance.now() - startedAt;
            const adapterMs =
              source.getLastSearchProfile()?.stageTimings?.totalAdapterMs;
            if (index > 0)
              samples.push({
                totalMs,
                adapterMs: typeof adapterMs === 'number' ? adapterMs : totalMs,
              });
            reportedTotal = result?.total ?? 0;
            reportedTotalExact = result?.totalExact ?? false;
            expect(result?.results.length).toBeGreaterThan(0);
            if (expectExactTotal) {
              expect(result?.total).toBe(size);
              expect(result?.totalExact).toBe(true);
            } else {
              expect(result?.total).toBeLessThanOrEqual(size);
              if (result?.totalExact) expect(result.total).toBe(size);
            }
          }
          const percentile = (values: number[], p: number) =>
            [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
          const total = samples.map((sample) => sample.totalMs);
          const adapter = samples.map((sample) => sample.adapterMs);
          return {
            p50Ms: percentile(total, 0.5),
            p95Ms: percentile(total, 0.95),
            reportedTotal,
            totalExact: reportedTotalExact,
            adapterP50Ms: percentile(adapter, 0.5),
            adapterP95Ms: percentile(adapter, 0.95),
            membershipAndResponseP50Ms: percentile(
              samples.map((sample) =>
                Math.max(0, sample.totalMs - sample.adapterMs),
              ),
              0.5,
            ),
          };
        };
        const sqlMeasure = async () => {
          const runCountQuery = async (scoped: boolean) => {
            const startedAt = performance.now();
            if (scoped) {
              await prisma.$queryRaw`
                SELECT count(*) FROM "CorpusDocument" AS document
                 WHERE document."id" = ANY(${ids}::text[])
                   AND document."documentScope" = 'PRIVATE_WORKSPACE'
                   AND document."status" = 'INDEXED'
                   AND document."searchText" ILIKE '%sprint151needle%'
                   AND EXISTS (
                     SELECT 1 FROM "WorkspaceDocument" AS workspaceDocument
                      WHERE workspaceDocument."documentId" = document."id"
                        AND workspaceDocument."workspaceId" = ${workspace.id}
                   )
              `;
            } else {
              await prisma.$queryRaw`
                SELECT count(*) FROM "CorpusDocument" AS document
                 WHERE document."id" = ANY(${ids}::text[])
                   AND document."documentScope" = 'PRIVATE_WORKSPACE'
                   AND document."status" = 'INDEXED'
                   AND document."searchText" ILIKE '%sprint151needle%'
              `;
            }
            return performance.now() - startedAt;
          };
          await runCountQuery(false);
          await runCountQuery(true);
          const unscopedSamples: number[] = [];
          const scopedSamples: number[] = [];
          const deltas: number[] = [];
          for (let index = 0; index < 6; index += 1) {
            const unscopedFirst = index % 2 === 0;
            const first = await runCountQuery(!unscopedFirst);
            const second = await runCountQuery(unscopedFirst);
            const unscoped = unscopedFirst ? first : second;
            const scoped = unscopedFirst ? second : first;
            unscopedSamples.push(unscoped);
            scopedSamples.push(scoped);
            deltas.push(scoped - unscoped);
          }
          const percentile = (values: number[], p: number) =>
            [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
          return {
            unscoped: {
              p50Ms: percentile(unscopedSamples, 0.5),
              p95Ms: percentile(unscopedSamples, 0.95),
            },
            scoped: {
              p50Ms: percentile(scopedSamples, 0.5),
              p95Ms: percentile(scopedSamples, 0.95),
            },
            aclDelta: {
              p50Ms: percentile(deltas, 0.5),
              p95Ms: percentile(deltas, 0.95),
            },
          };
        };
        const term = await measure('sprint151needle', true);
        const phrase = await measure('"sprint151needle phrase target"', false);
        const countComparison = await sqlMeasure();
        if (size === 500) {
          const aclPlan = await prisma.$queryRaw<
            Array<{ 'QUERY PLAN': unknown }>
          >`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT count(*) FROM "CorpusDocument" AS document
             WHERE document."id" = ANY(${ids}::text[])
               AND document."documentScope" = 'PRIVATE_WORKSPACE'
               AND document."status" = 'INDEXED'
               AND document."searchText" ILIKE '%sprint151needle%'
               AND EXISTS (
                 SELECT 1 FROM "WorkspaceDocument" AS workspaceDocument
                  WHERE workspaceDocument."documentId" = document."id"
                    AND workspaceDocument."workspaceId" = ${workspace.id}
               )
          `;
          console.log(
            `SPRINT151_PRIVATE_TERM_ACL_EXPLAIN=${JSON.stringify(
              aclPlan[0]?.['QUERY PLAN'],
            )
              .replace(/s15bm_[a-z0-9_]+/gu, '<synthetic-id>')
              .slice(0, 4000)}`,
          );
        }
        benchmarkRows.push({
          documents: size,
          term,
          phrase,
          aclSqlCountComparison: countComparison,
        });
      }
      console.log(
        `SPRINT151_PRIVATE_SEARCH_BENCHMARK=${JSON.stringify(benchmarkRows)}`,
      );
    },
  );
});

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
      documentIds.push(idA, idB);
      const textUpload = await service.upload(
        workspaceA.id,
        adminA,
        [
          {
            originalname: 'sprint15-note.txt',
            mimetype: 'text/plain',
            buffer: Buffer.from('JORGE PORCEL texto privado sintético'),
            size: Buffer.byteLength('JORGE PORCEL texto privado sintético'),
          },
        ],
        folder.id,
      );
      const idText = textUpload.results[0].documentId;
      documentIds.push(idText);
      const formatMarkers = {
        rtf: `sprint154amanualrtf${suffix}`,
        docx: `sprint154amanualdocx${suffix}`,
        odt: `sprint154amanualodt${suffix}`,
      };
      const rtfBuffer = Buffer.from(
        `{\\rtf1\\ansi ${formatMarkers.rtf} responsabilidad civil}`,
        'ascii',
      );
      const docxBuffer = makeWorkspaceOfficeZip([
        [
          '[Content_Types].xml',
          '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ],
        [
          'word/document.xml',
          `<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>${formatMarkers.docx} responsabilidad civil</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>celda</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
        ],
        [
          'word/_rels/document.xml.rels',
          '<Relationships><Relationship Target="https://example.invalid/ignored" TargetMode="External"/></Relationships>',
        ],
      ]);
      const odtBuffer = makeWorkspaceOfficeZip([
        ['mimetype', 'application/vnd.oasis.opendocument.text'],
        [
          'content.xml',
          `<office:document-content xmlns:office="urn:office" xmlns:text="urn:text"><office:body><office:text><text:p>${formatMarkers.odt} responsabilidad civil</text:p></office:text></office:body></office:document-content>`,
        ],
      ]);
      const officeUploads = await service.upload(
        workspaceA.id,
        adminA,
        [
          {
            originalname: 'sprint154a-fixture.rtf',
            mimetype: 'application/pdf',
            buffer: rtfBuffer,
            size: rtfBuffer.byteLength,
          },
          {
            originalname: 'sprint154a-fixture.docx',
            mimetype: 'text/plain',
            buffer: docxBuffer,
            size: docxBuffer.byteLength,
          },
          {
            originalname: 'sprint154a-fixture.odt',
            mimetype: 'application/octet-stream',
            buffer: odtBuffer,
            size: odtBuffer.byteLength,
          },
        ],
        folder.id,
      );
      const formatCases = [
        {
          key: 'rtf',
          type: 'RTF',
          mime: 'application/rtf',
          filename: 'sprint154a-fixture.rtf',
        },
        {
          key: 'docx',
          type: 'DOCX',
          mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          filename: 'sprint154a-fixture.docx',
        },
        {
          key: 'odt',
          type: 'ODT',
          mime: 'application/vnd.oasis.opendocument.text',
          filename: 'sprint154a-fixture.odt',
        },
      ] as const;
      expect(officeUploads.results.map((item) => item.status)).toEqual([
        'INDEXED',
        'INDEXED',
        'INDEXED',
      ]);
      const officeIds = officeUploads.results.map((item) => item.documentId);
      documentIds.push(...officeIds);
      for (let index = 0; index < formatCases.length; index += 1) {
        const format = formatCases[index];
        const documentId = officeIds[index];
        const ingestion = await prisma.corpusIngestionRecord.findFirstOrThrow({
          where: { documentId },
          select: { metadataOriginal: true },
        });
        expect(ingestion.metadataOriginal).toMatchObject({
          extractionProvenance: {
            formatDetected: format.type,
            mimeDetected: format.mime,
            detectionMethod:
              format.type === 'RTF' ? 'RTF_SIGNATURE' : 'ZIP_PACKAGE_SIGNATURE',
          },
        });
        const filtered = await service.searchWorkspace(
          workspaceA.id,
          viewer,
          formatMarkers[format.key],
          1,
          20,
          folder.id,
          undefined,
          undefined,
          { type: format.type },
        );
        expect(filtered?.results.map((row) => row.sourceId)).toEqual([
          documentId,
        ]);
        const matches = await service.matches(
          workspaceA.id,
          documentId,
          viewer,
          formatMarkers[format.key],
        );
        expect(matches.matches.length).toBeGreaterThan(0);
        const original = await service.file(workspaceA.id, documentId, viewer);
        expect(original).toMatchObject({
          mimeType: format.mime,
          filename: format.filename,
        });
        await expect(
          service.file(workspaceB.id, documentId, adminB),
        ).rejects.toMatchObject({ status: 404 });
      }
      await prisma.corpusDocument.updateMany({
        where: { id: { in: [idA, idText] } },
        data: { decisionDate: new Date('2025-06-10T00:00:00.000Z') },
      });
      await prisma.corpusDocument.update({
        where: { id: idB },
        data: { decisionDate: new Date('2026-06-10T00:00:00.000Z') },
      });
      expect(repeatedA.results[0]).toMatchObject({
        documentId: idA,
        duplicate: true,
      });
      expect(
        await prisma.workspaceDocument.count({
          where: { workspaceId: workspaceA.id, documentId: idA },
        }),
      ).toBe(1);
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
      const pdfDateFiltered = await service.searchWorkspace(
        workspaceA.id,
        viewer,
        'JORGE',
        1,
        20,
        folder.id,
        undefined,
        undefined,
        { type: 'PDF', dateFrom: '2025-01-01', dateTo: '2025-12-31' },
      );
      expect(pdfDateFiltered?.results.map((row) => row.sourceId)).toEqual([
        idA,
      ]);
      const textTypeFiltered = await service.searchWorkspace(
        workspaceA.id,
        viewer,
        'JORGE',
        1,
        20,
        folder.id,
        undefined,
        undefined,
        { type: 'TXT' },
      );
      expect(textTypeFiltered?.results.map((row) => row.sourceId)).toEqual([
        idText,
      ]);
      const combinedNameFilter = await service.searchNames(
        workspaceA.id,
        viewer,
        'sprint15-fixture',
        folder.id,
        1,
        20,
        undefined,
        undefined,
        { type: 'PDF', dateFrom: '2025-01-01', dateTo: '2025-12-31' },
      );
      expect(combinedNameFilter.results.map((row) => row.documentId)).toEqual([
        idA,
      ]);
      const textNameFilter = await service.searchNames(
        workspaceA.id,
        viewer,
        'sprint15-note',
        folder.id,
        1,
        20,
        undefined,
        undefined,
        { type: 'TXT' },
      );
      expect(textNameFilter.results.map((row) => row.documentId)).toEqual([
        idText,
      ]);
      await expect(
        service.searchWorkspace(
          workspaceA.id,
          viewer,
          'JORGE',
          1,
          20,
          folder.id,
          undefined,
          undefined,
          { dateFrom: '2026-01-01', dateTo: '2025-01-01' },
        ),
      ).rejects.toMatchObject({ status: 400 });
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
      const filterBenchmarkCases: Array<{
        name: string;
        folderId?: string;
        sourceId?: string;
        filters?: { type?: string; dateFrom?: string; dateTo?: string };
        expectedIds: string[];
      }> = [
        {
          name: 'source',
          sourceId: '__manual_upload__',
          expectedIds: [idA, idText],
        },
        {
          name: 'folder',
          folderId: folder.id,
          expectedIds: [idA, idText],
        },
        {
          name: 'type',
          filters: { type: 'PDF' },
          expectedIds: [idA],
        },
        {
          name: 'date',
          filters: { dateFrom: '2025-01-01', dateTo: '2025-12-31' },
          expectedIds: [idA, idText],
        },
        {
          name: 'combined',
          folderId: folder.id,
          sourceId: '__manual_upload__',
          filters: {
            type: 'PDF',
            dateFrom: '2025-01-01',
            dateTo: '2025-12-31',
          },
          expectedIds: [idA],
        },
      ];
      const percentile = (values: number[], fraction: number) =>
        [...values].sort((left, right) => left - right)[
          Math.max(0, Math.ceil(values.length * fraction) - 1)
        ];
      const filterBenchmarkRows: Array<Record<string, unknown>> = [];
      for (const filterCase of filterBenchmarkCases) {
        const samples: number[] = [];
        for (let index = 0; index <= 10; index += 1) {
          const startedAt = performance.now();
          const result = await service.searchWorkspace(
            workspaceA.id,
            viewer,
            'JORGE',
            1,
            20,
            filterCase.folderId,
            filterCase.sourceId,
            undefined,
            filterCase.filters,
          );
          const elapsedMs = performance.now() - startedAt;
          expect(
            (result?.results.map((row) => row.sourceId) ?? []).sort(),
          ).toEqual([...filterCase.expectedIds].sort());
          expect(result?.totalExact).toBe(true);
          if (index > 0) samples.push(elapsedMs);
        }
        filterBenchmarkRows.push({
          filter: filterCase.name,
          warmupRequests: 1,
          measuredRequests: samples.length,
          p50Ms: Number(percentile(samples, 0.5).toFixed(2)),
          p95Ms: Number(percentile(samples, 0.95).toFixed(2)),
          expectedResults: filterCase.expectedIds.length,
        });
      }
      const filterBenchmarkRoot = path.resolve(
        process.cwd(),
        '../../_recovery-work/sprint1531',
      );
      await mkdir(filterBenchmarkRoot, { recursive: true });
      await writeFile(
        path.join(filterBenchmarkRoot, 'filter-benchmark.json'),
        `${JSON.stringify(
          {
            environment: {
              endpoint: '127.0.0.1:55432',
              database: 'buscador_juridico_civil_dev',
              role: 'bjc_dev',
            },
            corpus: 'synthetic private workspace fixtures',
            queryTextPersisted: false,
            warmupRequests: 1,
            measuredRequests: 10,
            filters: filterBenchmarkRows,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      console.log(
        `SPRINT1531_FILTER_BENCHMARK=${JSON.stringify(filterBenchmarkRows)}`,
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
      const queryShapeRows: Array<Record<string, unknown>> = [];
      for (const size of [100, 500, 1000, 5000]) {
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
        const termTokensByDocument = ids.map((_, index) => {
          const terms = ['sprint151needle'];
          if (index % 2 === 0) terms.push('mediumneedle');
          if (index % 100 === 0) terms.push('rareneedle');
          return terms;
        });
        await prisma.corpusDocument.createMany({
          data: ids.map((id, index) => ({
            id,
            title: `Synthetic private benchmark ${size} document ${index + 1}`,
            documentType: 'PRIVATE_BENCHMARK',
            jurisdiction: 'CIVIL',
            visibility: 'RESTRICTED',
            documentScope: 'PRIVATE_WORKSPACE' as const,
            status: 'INDEXED',
            searchText: `${termTokensByDocument[index].join(' ')} phrase target synthetic private document ${index + 1}`,
          })),
        });
        await prisma.workspaceDocument.createMany({
          data: ids.map((documentId) => ({
            workspaceId: workspace.id,
            documentId,
            uploadedById: adminA.id,
          })),
        });
        const tokenRows = ids.flatMap((id, index) =>
          [...termTokensByDocument[index], 'phrase', 'target'].map(
            (token) => Prisma.sql`(${id}, ${token})`,
          ),
        );
        await prisma.$executeRaw(
          Prisma.sql`INSERT INTO "CorpusSearchToken" ("documentId", "token") VALUES ${Prisma.join(tokenRows)}`,
        );
        await prisma.$executeRawUnsafe('ANALYZE "CorpusDocument"');
        await prisma.$executeRawUnsafe('ANALYZE "WorkspaceDocument"');

        const measure = async (
          query: string,
          expectedTotal: number,
          series: number,
          phrase = false,
        ) => {
          const samples: Array<{
            totalMs: number;
            adapterMs: number;
            countMs: number;
            pageSqlMs: number;
          }> = [];
          const runs: Array<Record<string, unknown>> = [];
          let reportedTotal = 0;
          let reportedTotalExact = false;
          for (let seriesIndex = 0; seriesIndex < series; seriesIndex += 1) {
            for (let index = 0; index < 11; index += 1) {
              const startedAt = performance.now();
              const result = await service.searchWorkspace(
                workspace.id,
                adminA,
                phrase ? `"${query} phrase target"` : query,
              );
              const totalMs = performance.now() - startedAt;
              const profile = source.getLastSearchProfile();
              const adapterMs = profile?.stageTimings?.totalAdapterMs;
              const countMs = profile?.countMs ?? 0;
              const sample = {
                series: seriesIndex + 1,
                sample: index,
                warmup: index === 0,
                totalMs: Number(totalMs.toFixed(2)),
                adapterMs:
                  typeof adapterMs === 'number'
                    ? Number(adapterMs.toFixed(2))
                    : null,
                countMs: Number(countMs.toFixed(2)),
                pageSqlMs: Number((profile?.pageQueryMs ?? 0).toFixed(2)),
              };
              runs.push(sample);
              if (index > 0)
                samples.push({
                  totalMs,
                  adapterMs:
                    typeof adapterMs === 'number' ? adapterMs : totalMs,
                  countMs,
                  pageSqlMs: profile?.pageQueryMs ?? 0,
                });
              reportedTotal = result?.total ?? 0;
              reportedTotalExact = result?.totalExact ?? false;
              if (phrase) {
                expect(result?.total).toBeLessThanOrEqual(size);
                if (result?.totalExact) expect(result.total).toBe(size);
                expect(result?.results.length).toBeGreaterThan(0);
              } else {
                expect(result?.total).toBe(expectedTotal);
                expect(result?.totalExact).toBe(true);
                if (expectedTotal > 0)
                  expect(result?.results.length).toBeGreaterThan(0);
                else expect(result?.results).toHaveLength(0);
              }
            }
          }
          const percentile = (values: number[], p: number) =>
            [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
          const total = samples.map((sample) => sample.totalMs);
          const adapter = samples.map((sample) => sample.adapterMs);
          return {
            query,
            expectedTotal,
            series,
            runs,
            p50Ms: percentile(total, 0.5),
            p95Ms: percentile(total, 0.95),
            reportedTotal,
            totalExact: reportedTotalExact,
            adapterP50Ms: percentile(adapter, 0.5),
            adapterP95Ms: percentile(adapter, 0.95),
            countP50Ms: percentile(
              samples.map((sample) => sample.countMs),
              0.5,
            ),
            countP95Ms: percentile(
              samples.map((sample) => sample.countMs),
              0.95,
            ),
            pageSqlP50Ms: percentile(
              samples.map((sample) => sample.pageSqlMs),
              0.5,
            ),
            pageSqlP95Ms: percentile(
              samples.map((sample) => sample.pageSqlMs),
              0.95,
            ),
            maxP50Ratio: Number(
              (Math.max(...total) / percentile(total, 0.5)).toFixed(2),
            ),
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
                 WHERE document."documentScope" = 'PRIVATE_WORKSPACE'
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
                 WHERE document."documentScope" = 'PRIVATE_WORKSPACE'
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
        const series = size >= 1000 ? 3 : 1;
        console.log(`SPRINT1511_DATASET_READY=${size}`);
        const term = await measure('sprint151needle', size, series);
        const medium = await measure(
          'mediumneedle',
          Math.ceil(size / 2),
          series,
        );
        const rare = await measure('rareneedle', Math.ceil(size / 100), series);
        const zero = await measure('nonefound', 0, series);
        const phrase = null;
        const countComparison = await sqlMeasure();
        if (size === 500) {
          const base = `SELECT count(*) FROM "CorpusDocument" AS document
             WHERE document."documentScope" = 'PRIVATE_WORKSPACE'
               AND document."visibility" = ANY(ARRAY['RESTRICTED']::text[])
               AND document."status" = 'INDEXED'
               AND document."searchText" ILIKE '%sprint151needle%'`;
          const variants = [
            {
              name: 'EXISTS',
              sql: `${base} AND EXISTS (SELECT 1 FROM "WorkspaceDocument" AS workspaceDocument WHERE workspaceDocument."documentId" = document."id" AND workspaceDocument."workspaceId" = $1)`,
            },
            {
              name: 'JOIN',
              sql: `SELECT count(*) FROM "CorpusDocument" AS document JOIN "WorkspaceDocument" AS workspaceDocument ON workspaceDocument."documentId" = document."id" AND workspaceDocument."workspaceId" = $1 WHERE document."documentScope" = 'PRIVATE_WORKSPACE' AND document."visibility" = ANY(ARRAY['RESTRICTED']::text[]) AND document."status" = 'INDEXED' AND document."searchText" ILIKE '%sprint151needle%'`,
            },
            {
              name: 'IN',
              sql: `${base} AND document."id" IN (SELECT workspaceDocument."documentId" FROM "WorkspaceDocument" AS workspaceDocument WHERE workspaceDocument."workspaceId" = $1)`,
            },
            {
              name: 'AUTHORIZED_CTE',
              sql: `WITH authorized AS MATERIALIZED (SELECT "documentId" FROM "WorkspaceDocument" WHERE "workspaceId" = $1) SELECT count(*) FROM "CorpusDocument" AS document JOIN authorized ON authorized."documentId" = document."id" WHERE document."documentScope" = 'PRIVATE_WORKSPACE' AND document."visibility" = ANY(ARRAY['RESTRICTED']::text[]) AND document."status" = 'INDEXED' AND document."searchText" ILIKE '%sprint151needle%'`,
            },
          ];
          const summarizePlan = (plan: Array<Record<string, unknown>>) => {
            const nodes: Array<Record<string, unknown>> = [];
            const visit = (node: Record<string, unknown>) => {
              nodes.push(
                Object.fromEntries(
                  [
                    'Node Type',
                    'Join Type',
                    'Relation Name',
                    'Index Name',
                    'Plan Rows',
                    'Actual Rows',
                    'Actual Loops',
                    'Rows Removed by Join Filter',
                    'Rows Removed by Filter',
                    'Shared Hit Blocks',
                    'Shared Read Blocks',
                    'Temp Read Blocks',
                    'Temp Written Blocks',
                    'Actual Total Time',
                    'Index Cond',
                    'Join Filter',
                  ]
                    .filter((key) => node[key] !== undefined)
                    .map((key) => [key, node[key]]),
                ),
              );
              for (const child of (node.Plans as
                | Array<Record<string, unknown>>
                | undefined) ?? [])
                visit(child);
            };
            for (const item of plan) {
              visit(item.Plan as Record<string, unknown>);
              nodes.push({
                'Planning Time': item['Planning Time'],
                'Execution Time': item['Execution Time'],
              });
            }
            return nodes;
          };
          const capturePlans = async () => {
            const plans: Array<Record<string, unknown>> = [];
            for (const variant of variants) {
              const result = await prisma.$queryRawUnsafe<
                Array<{ 'QUERY PLAN': Array<Record<string, unknown>> }>
              >(
                `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT JSON) ${variant.sql}`,
                workspace.id,
              );
              plans.push({
                name: variant.name,
                nodes: summarizePlan(result[0]?.['QUERY PLAN'] ?? []),
              });
            }
            return plans;
          };
          const beforeAnalyze = await capturePlans();
          await prisma.$executeRawUnsafe('ANALYZE "CorpusDocument"');
          await prisma.$executeRawUnsafe('ANALYZE "WorkspaceDocument"');
          const afterAnalyze = await capturePlans();
          const shapeRow = { documents: size, beforeAnalyze, afterAnalyze };
          queryShapeRows.push(shapeRow);
          console.log(
            `SPRINT1511_ACL_QUERY_SHAPES=${JSON.stringify(shapeRow)}`,
          );
        }
        benchmarkRows.push({
          documents: size,
          term,
          medium,
          rare,
          zero,
          phrase,
          aclSqlCountComparison: countComparison,
        });
      }
      const outputRoot = path.resolve(
        process.cwd(),
        '../../_recovery-work/sprint1511',
      );
      await mkdir(outputRoot, { recursive: true });
      const largestWorkspaceId = workspaceIds[workspaceIds.length - 1];
      const largestDocumentIds = documentIds.filter((id) =>
        id.includes('_5000_'),
      );
      const benchmarkFolder = await service.createFolder(
        largestWorkspaceId,
        adminA,
        {
          name: `Synthetic half corpus ${suffix}`,
        },
      );
      await prisma.workspaceDocument.updateMany({
        where: {
          workspaceId: largestWorkspaceId,
          documentId: { in: largestDocumentIds.slice(0, 2500) },
        },
        data: { folderId: benchmarkFolder.id },
      });
      const folderAndPagination = {
        allFolders: await service.searchWorkspace(
          largestWorkspaceId,
          adminA,
          'sprint151needle',
          1,
          20,
        ),
        oneFolder: await service.searchWorkspace(
          largestWorkspaceId,
          adminA,
          'sprint151needle',
          1,
          20,
          benchmarkFolder.id,
        ),
        pages: await Promise.all(
          [1, 125, 250].map((page) =>
            service.searchWorkspace(
              largestWorkspaceId,
              adminA,
              'sprint151needle',
              page,
              20,
            ),
          ),
        ),
      };
      expect(folderAndPagination.allFolders?.total).toBe(5000);
      expect(folderAndPagination.allFolders?.totalExact).toBe(true);
      expect(folderAndPagination.oneFolder?.total).toBe(2500);
      expect(folderAndPagination.oneFolder?.totalExact).toBe(true);
      const pageIds = folderAndPagination.pages.flatMap(
        (page) => page?.results.map((row) => row.id) ?? [],
      );
      expect(
        folderAndPagination.pages.every(
          (page) => page?.total === 5000 && page.totalExact,
        ),
      ).toBe(true);
      expect(new Set(pageIds).size).toBe(pageIds.length);
      expect(
        folderAndPagination.pages.every((page) => page?.results.length === 20),
      ).toBe(true);
      const concurrencyRows: Array<Record<string, unknown>> = [];
      for (const concurrency of [1, 5, 10]) {
        const startedAt = performance.now();
        const results = await Promise.all(
          Array.from({ length: concurrency }, () =>
            service.searchWorkspace(largestWorkspaceId, adminA, 'rareneedle'),
          ),
        );
        concurrencyRows.push({
          concurrency,
          elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
          errors: results.filter(
            (result) => result?.total !== 50 || result.totalExact !== true,
          ).length,
          timeouts: 0,
          requestCount: results.length,
        });
      }
      await prisma.$executeRawUnsafe('ANALYZE "WorkspaceDocument"');
      await prisma.$executeRawUnsafe('ANALYZE "CorpusDocument"');
      const explainDirectory = path.join(outputRoot, 'explain-after');
      await mkdir(explainDirectory, { recursive: true });
      const captureExplain = async (
        name: string,
        sql: string,
        ...params: unknown[]
      ) => {
        const result = await prisma.$queryRawUnsafe<
          Array<{ 'QUERY PLAN': unknown }>
        >(
          `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT JSON) ${sql}`,
          ...params,
        );
        const plan = result[0]?.['QUERY PLAN'];
        await writeFile(
          path.join(explainDirectory, `${name}.json`),
          `${JSON.stringify(plan, null, 2)}\n`,
          'utf8',
        );
        return { name, plan };
      };
      const commonPattern = '%sprint151needle%';
      const commonWhere = `d."documentScope" = 'PRIVATE_WORKSPACE' AND d."visibility" = 'RESTRICTED' AND d."status" = 'INDEXED' AND d."searchText" ILIKE $1 AND EXISTS (SELECT 1 FROM "WorkspaceDocument" wd WHERE wd."documentId" = d."id" AND wd."workspaceId" = $2)`;
      const tokenCandidateCte = `SELECT DISTINCT token."documentId" AS "id" FROM "CorpusSearchToken" token JOIN "CorpusDocument" d ON d."id" = token."documentId" WHERE d."visibility" = ANY(ARRAY['RESTRICTED']::text[]) AND d."status" = 'INDEXED' AND d."documentScope" = 'PRIVATE_WORKSPACE' AND EXISTS (SELECT 1 FROM "WorkspaceDocument" wd WHERE wd."documentId" = d."id" AND wd."workspaceId" = $1) AND token."token" ILIKE $2 ESCAPE E'\\\\'`;
      const explainPlans: Array<Record<string, unknown>> = [
        await captureExplain(
          '5000-common-count',
          `SELECT count(*) FROM "CorpusDocument" d WHERE ${commonWhere}`,
          commonPattern,
          largestWorkspaceId,
        ),
        await captureExplain(
          '5000-common-token-candidates',
          tokenCandidateCte,
          largestWorkspaceId,
          commonPattern,
        ),
        await captureExplain(
          '5000-common-token-page',
          `WITH "corpusSearchCandidates" AS MATERIALIZED (${tokenCandidateCte}) SELECT d."id", d."decisionDate", d."updatedAt" FROM "corpusSearchCandidates" c JOIN "CorpusDocument" d ON d."id" = c."id" ORDER BY d."decisionDate" DESC NULLS LAST, d."updatedAt" DESC, d."id" LIMIT 21 OFFSET 0`,
          largestWorkspaceId,
          commonPattern,
        ),
        await captureExplain(
          '5000-common-page-first',
          `SELECT d."id", d."decisionDate", d."updatedAt" FROM "CorpusDocument" d WHERE ${commonWhere} ORDER BY d."decisionDate" DESC NULLS LAST, d."updatedAt" DESC, d."id" LIMIT 21 OFFSET 0`,
          commonPattern,
          largestWorkspaceId,
        ),
        await captureExplain(
          '5000-common-page-last',
          `SELECT d."id", d."decisionDate", d."updatedAt" FROM "CorpusDocument" d WHERE ${commonWhere} ORDER BY d."decisionDate" DESC NULLS LAST, d."updatedAt" DESC, d."id" LIMIT 21 OFFSET 4000`,
          commonPattern,
          largestWorkspaceId,
        ),
        await captureExplain(
          '5000-folder-page',
          `SELECT d."id", d."decisionDate", d."updatedAt" FROM "CorpusDocument" d WHERE ${commonWhere} AND EXISTS (SELECT 1 FROM "WorkspaceDocument" wdf WHERE wdf."documentId" = d."id" AND wdf."workspaceId" = $2 AND wdf."folderId" = $3) ORDER BY d."decisionDate" DESC NULLS LAST, d."updatedAt" DESC, d."id" LIMIT 21 OFFSET 0`,
          commonPattern,
          largestWorkspaceId,
          benchmarkFolder.id,
        ),
        await captureExplain(
          '5000-zero-count',
          `SELECT count(*) FROM "CorpusDocument" d WHERE d."documentScope" = 'PRIVATE_WORKSPACE' AND d."visibility" = 'RESTRICTED' AND d."status" = 'INDEXED' AND d."searchText" ILIKE $1 AND EXISTS (SELECT 1 FROM "WorkspaceDocument" wd WHERE wd."documentId" = d."id" AND wd."workspaceId" = $2)`,
          '%nonefound%',
          largestWorkspaceId,
        ),
      ];
      const [relationStats, runtimeSettings] = await Promise.all([
        prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT pg_stat_user_tables.relname AS relname, n_live_tup, n_mod_since_analyze,
                 last_analyze, last_autoanalyze, analyze_count, autoanalyze_count, pg_class.reloptions
            FROM pg_stat_user_tables
            JOIN pg_class ON pg_class.oid = pg_stat_user_tables.relid
           WHERE pg_stat_user_tables.relname IN ('CorpusDocument', 'WorkspaceDocument')
           ORDER BY pg_stat_user_tables.relname
        `,
        prisma.$queryRaw<
          Array<Record<string, unknown>>
        >`SELECT name, setting, unit, source FROM pg_settings WHERE name = ANY(ARRAY['jit', 'work_mem', 'plan_cache_mode', 'max_parallel_workers_per_gather', 'autovacuum']) ORDER BY name`,
      ]);
      const planVariance = {
        explainPlans,
        relationStats,
        runtimeSettings,
        note: 'Single observed plan after targeted ANALYZE; repeated EXPLAIN plan stability is not inferred from latency alone.',
      };
      await writeFile(
        path.join(outputRoot, 'plan-variance.json'),
        `${JSON.stringify(
          planVariance,
          (_key: string, value: unknown): unknown =>
            typeof value === 'bigint' ? value.toString() : value,
          2,
        )}\n`,
        'utf8',
      );
      await writeFile(
        path.join(outputRoot, 'explain-after.json'),
        `${JSON.stringify(explainPlans, null, 2)}\n`,
        'utf8',
      );
      await writeFile(
        path.join(outputRoot, 'folders-pagination.json'),
        `${JSON.stringify(
          {
            allFolders: {
              total: folderAndPagination.allFolders?.total,
              pageRows: folderAndPagination.allFolders?.results.length,
            },
            oneFolder: {
              total: folderAndPagination.oneFolder?.total,
              pageRows: folderAndPagination.oneFolder?.results.length,
            },
            pages: folderAndPagination.pages.map((result, index) => ({
              page: [1, 125, 250][index],
              total: result?.total,
              rows: result?.results.map((row) => row.id),
            })),
            uniquePageIds: new Set(pageIds).size,
            missingRows: folderAndPagination.pages.reduce(
              (sum, result) => sum + (20 - (result?.results.length ?? 0)),
              0,
            ),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      await writeFile(
        path.join(outputRoot, 'concurrency.json'),
        `${JSON.stringify(concurrencyRows, null, 2)}\n`,
        'utf8',
      );
      await writeFile(
        path.join(
          outputRoot,
          process.env.BJC_SPRINT1511_PHASE === 'after'
            ? 'term-benchmark-after.json'
            : 'term-benchmark-before.json',
        ),
        `${JSON.stringify(benchmarkRows, null, 2)}\n`,
        'utf8',
      );
      await writeFile(
        path.join(outputRoot, 'acl-count-benchmark.json'),
        `${JSON.stringify(
          benchmarkRows.map(({ documents, aclSqlCountComparison }) => ({
            documents,
            aclSqlCountComparison,
          })),
          null,
          2,
        )}\n`,
        'utf8',
      );
      await writeFile(
        path.join(outputRoot, 'query-shapes.json'),
        `${JSON.stringify(queryShapeRows, null, 2)}\n`,
        'utf8',
      );
      const indexAudit = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT tablename, indexname, indexdef
          FROM pg_indexes
         WHERE schemaname = current_schema()
           AND tablename = ANY(ARRAY['WorkspaceDocument', 'WorkspaceMembership', 'CorpusDocument', 'CorpusSearchToken']::text[])
         ORDER BY tablename, indexname
      `;
      await writeFile(
        path.join(outputRoot, 'index-audit.json'),
        `${JSON.stringify(indexAudit, null, 2)}\n`,
        'utf8',
      );
      await writeFile(
        path.join(outputRoot, 'datasets.json'),
        `${JSON.stringify(
          benchmarkRows.map(({ documents, term, medium, rare, zero }) => ({
            documents,
            distribution: {
              common:
                term && (term as { expectedTotal?: number }).expectedTotal,
              medium:
                medium && (medium as { expectedTotal?: number }).expectedTotal,
              rare: rare && (rare as { expectedTotal?: number }).expectedTotal,
              zero: zero && (zero as { expectedTotal?: number }).expectedTotal,
            },
            synthetic: true,
            pdfBlobs: 0,
          })),
          null,
          2,
        )}\n`,
        'utf8',
      );
      console.log(
        `SPRINT1511_PRIVATE_SEARCH_BENCHMARK=${JSON.stringify(benchmarkRows.map(({ documents, term, medium, rare, zero, phrase, aclSqlCountComparison }) => ({ documents, term, medium, rare, zero, phrase, aclSqlCountComparison })))}`,
      );
    },
  );
});

function makeWorkspaceOfficeZip(entries: Array<[string, string]>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const [entryName, text] of entries) {
    const name = Buffer.from(entryName, 'utf8');
    const content = Buffer.from(text, 'utf8');
    const crc = workspaceFixtureCrc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function workspaceFixtureCrc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

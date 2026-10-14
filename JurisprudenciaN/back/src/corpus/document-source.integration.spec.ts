import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { parseSearchQuery } from '../busqueda/utils/search-parser';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import { CorpusSearchSourceAdapter } from './corpus-search.adapter';
import { DocumentSourceScanner } from './document-source-scanner';
import { DocumentSourceService } from './document-source.service';
import { LocalDocumentStorageAdapter } from './document-storage.adapter';
import { WorkspaceDocumentService } from './workspace-document.service';

const enabled = process.env.SPRINT152_SOURCE_TEST === '1';
const testStorage = path.resolve(
  process.cwd(),
  '../../_dev-corpus-storage-test/sprint152-sources',
);

class LocalFixtureScanner extends DocumentSourceScanner {
  override validateNetworkPath(value: string) {
    return value;
  }
}

describe('Sprint 15.2 document sources PostgreSQL integration', () => {
  const prisma = new PrismaService();
  let search: CorpusSearchSourceAdapter;
  let workspaceDocuments: WorkspaceDocumentService;
  let sources: DocumentSourceService;
  const previousStoragePath = process.env.BJC_CORPUS_STORAGE_PATH;
  const userIds: number[] = [];
  const workspaceIds: string[] = [];
  const documentIds = new Set<string>();
  const tempRoots: string[] = [];
  const suffix =
    `${Date.now()}${Math.random().toString(16).slice(2, 6)}`.toUpperCase();
  const user = (
    id: number,
    email: string,
    role: AuthenticatedUser['rol']['nombre'],
  ): AuthenticatedUser => ({
    id,
    nombre: email,
    apellido: null,
    email,
    activo: true,
    rol: { id: 0, nombre: role, descripcion: null },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  let adminA: AuthenticatedUser;
  let adminB: AuthenticatedUser;
  let viewerA: AuthenticatedUser;
  let workspaceA: { id: string };
  let workspaceB: { id: string };

  beforeAll(async () => {
    if (!enabled) return;
    process.env.BJC_CORPUS_STORAGE_PATH = testStorage;
    await prisma.$connect();
    search = new CorpusSearchSourceAdapter();
    const access = new CorpusDocumentAccessService(prisma);
    workspaceDocuments = new WorkspaceDocumentService(
      prisma,
      {
        federatedSearch: async (
          query: string,
          _operator: 'AND',
          context: Parameters<CorpusSearchSourceAdapter['search']>[1],
        ) => search.search(parseSearchQuery(query), context),
      } as never,
      access,
      new LocalDocumentStorageAdapter(testStorage),
    );
    sources = new DocumentSourceService(
      prisma,
      workspaceDocuments,
      new LocalFixtureScanner(),
    );
    const [adminRole, readerRole] = await Promise.all([
      prisma.rol.findUniqueOrThrow({ where: { nombre: 'ADMIN' } }),
      prisma.rol.findUniqueOrThrow({ where: { nombre: 'LECTOR' } }),
    ]);
    const [a, b, viewer] = await Promise.all([
      prisma.usuario.create({
        data: {
          nombre: 'Sprint 15.2 A',
          email: `sprint152-a-${suffix}@example.invalid`,
          passwordHash: 'synthetic-only',
          rolId: adminRole.id,
        },
      }),
      prisma.usuario.create({
        data: {
          nombre: 'Sprint 15.2 B',
          email: `sprint152-b-${suffix}@example.invalid`,
          passwordHash: 'synthetic-only',
          rolId: adminRole.id,
        },
      }),
      prisma.usuario.create({
        data: {
          nombre: 'Sprint 15.2 Viewer',
          email: `sprint152-v-${suffix}@example.invalid`,
          passwordHash: 'synthetic-only',
          rolId: readerRole.id,
        },
      }),
    ]);
    userIds.push(a.id, b.id, viewer.id);
    adminA = user(a.id, a.email, 'ADMIN');
    adminB = user(b.id, b.email, 'ADMIN');
    viewerA = user(viewer.id, viewer.email, 'LECTOR');
    workspaceA = await workspaceDocuments.createWorkspace(adminA, {
      code: `S152A${suffix}`,
      name: 'Sprint 15.2 fixture A',
      type: 'JUZGADO',
    });
    workspaceB = await workspaceDocuments.createWorkspace(adminB, {
      code: `S152B${suffix}`,
      name: 'Sprint 15.2 fixture B',
      type: 'JUZGADO',
    });
    workspaceIds.push(workspaceA.id, workspaceB.id);
    await workspaceDocuments.manageMember(workspaceA.id, adminA, {
      userId: viewer.id,
      role: 'VIEWER',
    });
  });

  afterAll(async () => {
    if (!enabled) return;
    if (search) await search.close();
    if (workspaceIds.length) {
      const links = await prisma.workspaceDocument.findMany({
        where: { workspaceId: { in: workspaceIds } },
        select: { documentId: true },
      });
      for (const link of links) documentIds.add(link.documentId);
      await prisma.documentWorkspace.deleteMany({
        where: { id: { in: workspaceIds } },
      });
    }
    if (documentIds.size)
      await prisma.corpusDocument.deleteMany({
        where: { id: { in: [...documentIds] } },
      });
    if (userIds.length)
      await prisma.usuario.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    if (previousStoragePath === undefined)
      delete process.env.BJC_CORPUS_STORAGE_PATH;
    else process.env.BJC_CORPUS_STORAGE_PATH = previousStoragePath;
    const allowed = path.resolve(
      process.cwd(),
      '../../_dev-corpus-storage-test',
    );
    if (testStorage.startsWith(`${allowed}${path.sep}`))
      await rm(testStorage, { recursive: true, force: true });
    for (const root of tempRoots)
      await rm(root, { recursive: true, force: true });
  });

  (enabled ? it : it.skip)(
    'scans deltas safely, preserves private ACL, and reuses content-addressed blobs',
    async () => {
      const rootA = await mkdtemp(path.join(os.tmpdir(), 'galilei-s152-a-'));
      tempRoots.push(rootA);
      await mkdir(path.join(rootA, 'sub'));
      const fixture = await readFile(
        path.join(
          process.cwd(),
          'scripts/dev/fixtures/corpus/fallo-fixture.pdf',
        ),
      );
      const makePdf = (tag: string) =>
        Buffer.concat([fixture, Buffer.from(`\n% sprint152-${tag}\n`)]);
      await writeFile(path.join(rootA, 'A.pdf'), makePdf('a'));
      await writeFile(path.join(rootA, 'B.pdf'), makePdf('b'));
      await writeFile(path.join(rootA, 'sub', 'C.pdf'), makePdf('c'));

      const connection = await sources.testAccess(workspaceA.id, adminA, rootA);
      expect(connection).toEqual({ status: 'CONNECTED' });
      const sourceA = await sources.create(workspaceA.id, adminA, {
        name: 'Fixture Network A',
        path: rootA,
      });
      await expect(sources.list(workspaceA.id, viewerA)).rejects.toMatchObject({
        status: 404,
      });
      await expect(sources.list(workspaceB.id, adminA)).rejects.toMatchObject({
        status: 404,
      });

      const first = await runScan(
        sources,
        prisma,
        workspaceA.id,
        sourceA.id,
        adminA,
      );
      expect(first).toMatchObject({
        status: 'COMPLETED',
        scanComplete: true,
        filesSeen: 3,
        indexedCount: 3,
        newCount: 3,
        errorCount: 0,
      });
      const runEvidence: Record<string, unknown> = {
        initial: summarizeRun(first),
      };
      expect(
        await prisma.sourceFile.count({ where: { sourceId: sourceA.id } }),
      ).toBe(3);
      expect(
        await prisma.workspaceDocument.count({
          where: { workspaceId: workspaceA.id },
        }),
      ).toBe(3);
      const docsA = await prisma.sourceFile.findMany({
        where: { sourceId: sourceA.id },
        select: { documentId: true, sha256: true },
      });
      for (const doc of docsA)
        if (doc.documentId) documentIds.add(doc.documentId);
      const privateSearch = await workspaceDocuments.searchWorkspace(
        workspaceA.id,
        viewerA,
        '"JORGE PORCEL FIXTURE"',
      );
      expect(privateSearch?.results).toHaveLength(3);
      expect(
        privateSearch?.results.every(
          (result) => result.metadata.sourceName === 'Fixture Network A',
        ),
      ).toBe(true);
      const visibleSources = await workspaceDocuments.searchSources(
        workspaceA.id,
        viewerA,
      );
      expect(visibleSources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: sourceA.id,
            name: 'Fixture Network A',
            fileCount: 3,
          }),
        ]),
      );
      expect(JSON.stringify(visibleSources)).not.toContain(rootA);
      const sourceFolders = await workspaceDocuments.searchSourceFolders(
        workspaceA.id,
        sourceA.id,
        viewerA,
      );
      expect(sourceFolders.folders.map((folder) => folder.path)).toContain(
        'sub',
      );
      const sourceScoped = await workspaceDocuments.searchWorkspace(
        workspaceA.id,
        viewerA,
        '"JORGE PORCEL FIXTURE"',
        1,
        20,
        undefined,
        sourceA.id,
      );
      expect(sourceScoped?.total).toBe(3);
      const sourceNameScoped = await workspaceDocuments.searchNames(
        workspaceA.id,
        viewerA,
        'A.pdf',
        undefined,
        1,
        20,
        sourceA.id,
      );
      expect(sourceNameScoped.results.map((row) => row.filename)).toEqual([
        'A.pdf',
      ]);
      const nestedNameWithoutFolder = await workspaceDocuments.searchNames(
        workspaceA.id,
        viewerA,
        'C.pdf',
        undefined,
        1,
        20,
        sourceA.id,
      );
      expect(
        nestedNameWithoutFolder.results.map((row) => row.filename),
      ).toEqual(['C.pdf']);
      const sourceFolderNameScoped = await workspaceDocuments.searchNames(
        workspaceA.id,
        viewerA,
        'C.pdf',
        undefined,
        1,
        20,
        sourceA.id,
        'sub',
      );
      expect(sourceFolderNameScoped.results.map((row) => row.filename)).toEqual(
        ['C.pdf'],
      );
      const sourceFolderScoped = await workspaceDocuments.searchWorkspace(
        workspaceA.id,
        viewerA,
        '"JORGE PORCEL FIXTURE"',
        1,
        20,
        undefined,
        sourceA.id,
        'sub',
      );
      expect(sourceFolderScoped?.total).toBe(1);
      await expect(
        workspaceDocuments.searchWorkspace(
          workspaceB.id,
          adminB,
          '"JORGE PORCEL FIXTURE"',
          1,
          20,
          undefined,
          sourceA.id,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        workspaceDocuments.searchNames(
          workspaceB.id,
          adminB,
          'A.pdf',
          undefined,
          1,
          20,
          sourceA.id,
        ),
      ).rejects.toMatchObject({ status: 404 });
      const firstDoc = docsA.find((doc) => doc.documentId)?.documentId;
      expect(firstDoc).toBeTruthy();
      expect(
        (await workspaceDocuments.file(workspaceA.id, firstDoc!, viewerA))
          .sha256,
      ).toMatch(/^[a-f0-9]{64}$/u);

      const noChange = await runScan(
        sources,
        prisma,
        workspaceA.id,
        sourceA.id,
        adminA,
      );
      expect(noChange).toMatchObject({
        status: 'COMPLETED',
        unchangedCount: 3,
        hashCount: 0,
        newCount: 0,
        modifiedCount: 0,
      });
      runEvidence.noChange = summarizeRun(noChange);
      const aPath = path.join(rootA, 'A.pdf');
      const now = new Date(Date.now() + 4000);
      await utimes(aPath, now, now);
      const metadataOnly = await runScan(
        sources,
        prisma,
        workspaceA.id,
        sourceA.id,
        adminA,
      );
      expect(metadataOnly).toMatchObject({
        unchangedCount: 3,
        metadataOnlyCount: 1,
        hashCount: 1,
        newCount: 0,
        modifiedCount: 0,
      });
      runEvidence.metadataOnly = summarizeRun(metadataOnly);

      await writeFile(path.join(rootA, 'B.pdf'), makePdf('b-modified'));
      await writeFile(path.join(rootA, 'D.pdf'), makePdf('d'));
      await rm(path.join(rootA, 'sub', 'C.pdf'));
      const delta = await runScan(
        sources,
        prisma,
        workspaceA.id,
        sourceA.id,
        adminA,
      );
      expect(delta).toMatchObject({
        scanComplete: true,
        newCount: 1,
        modifiedCount: 1,
        missingCount: 1,
        errorCount: 0,
      });
      runEvidence.delta = summarizeRun(delta);
      const bRow = await prisma.sourceFile.findFirstOrThrow({
        where: { sourceId: sourceA.id, fileName: 'B.pdf' },
      });
      expect(bRow.sha256).toBeTruthy();
      expect(bRow.status).toBe('INDEXED');

      await rename(aPath, path.join(rootA, 'RenamedA.pdf'));
      const renamed = await runScan(
        sources,
        prisma,
        workspaceA.id,
        sourceA.id,
        adminA,
      );
      expect(renamed).toMatchObject({
        scanComplete: true,
        renamedCount: 1,
        newCount: 0,
        modifiedCount: 0,
        missingCount: 0,
      });
      runEvidence.rename = summarizeRun(renamed);
      expect(
        await prisma.sourceFile.count({ where: { sourceId: sourceA.id } }),
      ).toBe(4);

      const rootB = await mkdtemp(path.join(os.tmpdir(), 'galilei-s152-b-'));
      tempRoots.push(rootB);
      await writeFile(path.join(rootB, 'shared.pdf'), makePdf('a'));
      const sourceB = await sources.create(workspaceB.id, adminB, {
        name: 'Fixture Network B',
        path: rootB,
      });
      const runB = await runScan(
        sources,
        prisma,
        workspaceB.id,
        sourceB.id,
        adminB,
      );
      expect(runB).toMatchObject({ status: 'COMPLETED', newCount: 1 });
      runEvidence.secondWorkspaceSameSha = summarizeRun(runB);
      const docA = await prisma.sourceFile.findFirstOrThrow({
        where: { sourceId: sourceA.id, fileName: 'RenamedA.pdf' },
        select: { documentId: true },
      });
      const docB = await prisma.sourceFile.findFirstOrThrow({
        where: { sourceId: sourceB.id },
        select: { documentId: true },
      });
      documentIds.add(docA.documentId!);
      documentIds.add(docB.documentId!);
      expect(docA.documentId).not.toBe(docB.documentId);
      const [fileA, fileB] = await Promise.all([
        prisma.corpusDocumentFile.findFirstOrThrow({
          where: { documentId: docA.documentId! },
        }),
        prisma.corpusDocumentFile.findFirstOrThrow({
          where: { documentId: docB.documentId! },
        }),
      ]);
      expect(fileA.sha256).toBe(fileB.sha256);
      expect(fileA.storageKey).toBe(fileB.storageKey);
      await expect(
        sources.files(workspaceB.id, sourceB.id, adminA),
      ).rejects.toMatchObject({ status: 404 });
      const generalSearch = await search.search(
        parseSearchQuery('"JORGE PORCEL FIXTURE"'),
        {
          visibility: 'ADMIN',
          dialect: 'modern',
          publicationPolicy: 'legacy-active-only',
          page: 1,
          pageSize: 20,
        },
      );
      expect(generalSearch.results.map((row) => row.sourceId)).not.toContain(
        docA.documentId,
      );
      expect(generalSearch.results.map((row) => row.sourceId)).not.toContain(
        docB.documentId,
      );

      await rm(rootA, { recursive: true, force: true });
      const offline = await runScan(
        sources,
        prisma,
        workspaceA.id,
        sourceA.id,
        adminA,
      );
      expect(offline).toMatchObject({
        status: 'FAILED',
        scanComplete: false,
        missingCount: 0,
      });
      runEvidence.offline = summarizeRun(offline);
      expect(
        await prisma.sourceFile.count({
          where: { sourceId: sourceA.id, status: 'MISSING' },
        }),
      ).toBe(1);
      const evidenceRoot = path.resolve(
        process.cwd(),
        '..',
        '..',
        '_recovery-work',
        'sprint152',
      );
      await mkdir(evidenceRoot, { recursive: true });
      await writeFile(
        path.join(evidenceRoot, 'source-test-results.json'),
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            status: 'PASS',
            dataset:
              'temporary local filesystem fixtures; no institutional UNC share accessed',
            realUncTested: false,
            scenarios: [
              'initial scan',
              'no-change scan',
              'same-SHA metadata change',
              'new/modified/missing delta',
              'same-SHA rename',
              'offline no-missing',
              'workspace ACL',
              'private Search and Viewer',
              'cross-workspace blob reuse',
              'general Search isolation',
            ],
            runs: runEvidence,
            filesIncorrectlyMarkedMissingOffline: 0,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    },
    300000,
  );

  (enabled ? it : it.skip)(
    'indexes RTF, DOCX and ODT source files with detected MIME, Search, preview and ACL',
    async () => {
      const root = await mkdtemp(
        path.join(os.tmpdir(), 'galilei-s154a-formats-'),
      );
      tempRoots.push(root);
      const markers = {
        rtf: `sprint154artf${suffix}`,
        docx: `sprint154adocx${suffix}`,
        odt: `sprint154aodt${suffix}`,
      };
      await writeFile(
        path.join(root, 'fixture.rtf'),
        Buffer.from(
          `{\\rtf1\\ansi ${markers.rtf} responsabilidad civil}`,
          'ascii',
        ),
      );
      await writeFile(
        path.join(root, 'fixture.docx'),
        makeOfficeZip([
          [
            '[Content_Types].xml',
            '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
          ],
          [
            'word/document.xml',
            `<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>${markers.docx} responsabilidad civil</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>celda</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
          ],
          [
            'word/_rels/document.xml.rels',
            '<Relationships><Relationship Target="https://example.invalid/ignored" TargetMode="External"/></Relationships>',
          ],
        ]),
      );
      await writeFile(
        path.join(root, 'fixture.odt'),
        makeOfficeZip([
          ['mimetype', 'application/vnd.oasis.opendocument.text'],
          [
            'content.xml',
            `<office:document-content xmlns:office="urn:office" xmlns:text="urn:text"><office:body><office:text><text:p>${markers.odt} responsabilidad civil</text:p></office:text></office:body></office:document-content>`,
          ],
        ]),
      );

      const source = await sources.create(workspaceA.id, adminA, {
        name: 'Sprint 15.4A synthetic formats',
        path: root,
      });
      const run = await runScan(
        sources,
        prisma,
        workspaceA.id,
        source.id,
        adminA,
      );
      expect(run).toMatchObject({
        status: 'COMPLETED',
        scanComplete: true,
        filesSeen: 3,
        newCount: 3,
        errorCount: 0,
      });
      const rows = await prisma.sourceFile.findMany({
        where: { sourceId: source.id },
        include: { document: { include: { files: true } } },
      });
      const formatByExtension = new Map([
        ['.rtf', { mime: 'application/rtf', marker: markers.rtf, type: 'RTF' }],
        [
          '.docx',
          {
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            marker: markers.docx,
            type: 'DOCX',
          },
        ],
        [
          '.odt',
          {
            mime: 'application/vnd.oasis.opendocument.text',
            marker: markers.odt,
            type: 'ODT',
          },
        ],
      ]);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        if (row.documentId) documentIds.add(row.documentId);
        const expected = formatByExtension.get(path.extname(row.fileName));
        expect(expected).toBeDefined();
        expect(row.status).toBe('INDEXED');
        expect(row.document?.files[0]?.mimeType).toBe(expected?.mime);
        const result = await workspaceDocuments.searchWorkspace(
          workspaceA.id,
          viewerA,
          expected!.marker,
          1,
          20,
          undefined,
          source.id,
          undefined,
          { type: expected!.type },
        );
        expect(result?.results.map((item) => item.sourceId)).toEqual([
          row.documentId,
        ]);
        const matches = await workspaceDocuments.matches(
          workspaceA.id,
          row.documentId!,
          viewerA,
          expected!.marker,
        );
        expect(matches.matches.length).toBeGreaterThan(0);
        const original = await workspaceDocuments.file(
          workspaceA.id,
          row.documentId!,
          viewerA,
        );
        expect(original.mimeType).toBe(expected?.mime);
        expect(original.content.byteLength).toBeGreaterThan(0);
        await expect(
          workspaceDocuments.file(workspaceB.id, row.documentId!, adminB),
        ).rejects.toMatchObject({ status: 404 });
      }

      const noChange = await runScan(
        sources,
        prisma,
        workspaceA.id,
        source.id,
        adminA,
      );
      expect(noChange).toMatchObject({
        status: 'COMPLETED',
        filesSeen: 3,
        unchangedCount: 3,
        hashCount: 0,
        newCount: 0,
        modifiedCount: 0,
        errorCount: 0,
      });
    },
    300000,
  );
});

function summarizeRun(run: Awaited<ReturnType<typeof runScan>>) {
  return {
    status: run.status,
    scanComplete: run.scanComplete,
    filesSeen: run.filesSeen,
    indexedCount: run.indexedCount,
    newCount: run.newCount,
    modifiedCount: run.modifiedCount,
    unchangedCount: run.unchangedCount,
    metadataOnlyCount: run.metadataOnlyCount,
    renamedCount: run.renamedCount,
    missingCount: run.missingCount,
    unsupportedCount: run.unsupportedCount,
    errorCount: run.errorCount,
    hashCount: run.hashCount,
    hashMs: run.hashMs,
    enumerationMs: run.enumerationMs,
    metadataComparisonMs: run.metadataComparisonMs,
    processingMs: run.processingMs,
    totalDurationMs: run.totalDurationMs,
  };
}

async function runScan(
  service: DocumentSourceService,
  prisma: PrismaService,
  workspaceId: string,
  sourceId: string,
  user: AuthenticatedUser,
) {
  const queued = await service.scan(workspaceId, sourceId, user);
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const run = await prisma.sourceScanRun.findUniqueOrThrow({
      where: { id: queued.id },
    });
    if (!['QUEUED', 'RUNNING'].includes(run.status)) return run;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error('SOURCE_SCAN_TEST_TIMEOUT');
}

function makeOfficeZip(entries: Array<[string, string]>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const [entryName, text] of entries) {
    const name = Buffer.from(entryName, 'utf8');
    const content = Buffer.from(text, 'utf8');
    const crc = officeFixtureCrc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
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

function officeFixtureCrc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { parseSearchQuery } from '../busqueda/utils/search-parser';
import { CorpusIngestionService } from './corpus-ingestion.service';
import { ManualFixtureSourceAdapter } from './document-source.adapter';
import { LocalDocumentStorageAdapter } from './document-storage.adapter';
import {
  BasicDocumentTextExtractor,
  type DocumentTextExtractor,
  type ExtractionResult,
} from './document-text-extractor';
import { CorpusSearchSourceAdapter } from './corpus-search.adapter';

const enabled = process.env.CORPUS_POSTGRES_TEST === '1';
const fixtureRoot = path.resolve(process.cwd(), 'scripts/dev/fixtures/corpus');
const publicContext = {
  visibility: 'PUBLIC' as const,
  dialect: 'modern' as const,
  publicationPolicy: 'published-active-only' as const,
  page: 1,
  pageSize: 20,
};

describe('BJC M6 corpus PostgreSQL end-to-end', () => {
  const prisma = new PrismaService();
  const storage = new LocalDocumentStorageAdapter(
    path.resolve(process.cwd(), '../_dev-corpus-storage-test'),
  );
  let pipeline: CorpusIngestionService;
  let search: CorpusSearchSourceAdapter;
  let sourceCode: string;
  let sourceId: string;

  beforeAll(async () => {
    if (!enabled) return;
    await prisma.$connect();
    search = new CorpusSearchSourceAdapter();
    pipeline = new CorpusIngestionService(
      prisma,
      storage,
      new BasicDocumentTextExtractor(),
    );
  });

  beforeEach(async () => {
    if (!enabled) return;
    sourceCode = `M6_FIXTURE_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;
    const source = await prisma.corpusSourceSystem.create({
      data: {
        code: sourceCode,
        name: 'Synthetic M6 fixture',
        sourceType: 'FIXTURE',
      },
    });
    sourceId = source.id;
  });

  afterEach(async () => {
    if (!enabled || !sourceId) return;
    const rows = await prisma.corpusIngestionRecord.findMany({
      where: { sourceSystemId: sourceId },
      select: { documentId: true },
    });
    await prisma.corpusIngestionRecord.deleteMany({
      where: { sourceSystemId: sourceId },
    });
    await prisma.corpusDocument.deleteMany({
      where: { id: { in: [...new Set(rows.map((row) => row.documentId))] } },
    });
    await prisma.corpusSourceSystem.deleteMany({ where: { id: sourceId } });
  });

  afterAll(async () => {
    if (!enabled) return;
    await search.close();
    await prisma.$disconnect();
  });

  (enabled ? it : it.skip)(
    'ingests, extracts by page, indexes, returns provenance, and is idempotent',
    async () => {
      const content = await readFile(
        path.join(fixtureRoot, 'fallo-fixture.pdf'),
      );
      const item = {
        filename: 'fallo-fixture.pdf',
        externalId: 'fixture-unique-1',
        content,
        mimeType: 'application/pdf',
        title: 'Fallo ficticio',
        visibility: 'PUBLIC' as const,
      };
      const first = await pipeline.ingestSource(
        new ManualFixtureSourceAdapter([item]),
        {
          sourceCode,
          sourceName: 'Synthetic M6 fixture',
          sourceType: 'FIXTURE',
        },
      );
      const second = await pipeline.ingestSource(
        new ManualFixtureSourceAdapter([item]),
        {
          sourceCode,
          sourceName: 'Synthetic M6 fixture',
          sourceType: 'FIXTURE',
        },
      );
      expect(first[0].status).toBe('INDEXED');
      expect(second[0].reused).toBe(true);
      expect(second[0].documentId).toBe(first[0].documentId);
      expect(
        await prisma.corpusDocument.count({
          where: { id: first[0].documentId },
        }),
      ).toBe(1);
      expect(
        await prisma.corpusIngestionRecord.count({
          where: { sourceSystemId: sourceId },
        }),
      ).toBe(1);
      expect(
        await prisma.corpusDocumentFile.count({
          where: { documentId: first[0].documentId },
        }),
      ).toBe(1);
      await prisma.corpusDocumentLink.createMany({
        data: [
          {
            documentId: first[0].documentId,
            targetDomain: 'JURISPRUDENCIA',
            targetType: 'SELECTION',
            targetId: 'fixture-selection-1',
            relationship: 'SELECTED_FROM',
          },
          {
            documentId: first[0].documentId,
            targetDomain: 'DIGESTO',
            targetType: 'COLLECTION',
            targetId: 'fixture-collection-1',
            relationship: 'MEMBER_OF',
          },
        ],
      });
      expect(
        await prisma.corpusDocumentLink.count({
          where: { documentId: first[0].documentId },
        }),
      ).toBe(2);
      const pages = await prisma.corpusDocumentPage.findMany({
        where: { extraction: { documentId: first[0].documentId } },
        orderBy: { pageNumber: 'asc' },
      });
      expect(pages.length).toBe(2);
      expect(pages[1].text).toContain('JORGE PORCEL FIXTURE');

      const parsed = parseSearchQuery('"JORGE PORCEL FIXTURE"');
      const result = await search.search(parsed, publicContext);
      expect(result.total).toBe(1);
      expect(result.results[0].sourceId).toBe(first[0].documentId);
      expect(result.results[0].snippet).toContain('JORGE PORCEL FIXTURE');
      expect(result.results[0].metadata.sourceCode).toBe(sourceCode);
      expect(result.results[0].metadata.checksum).toBe(first[0].checksum);
      expect(result.results[0].metadata.fileId).toBe(first[0].fileId);
      expect(result.results[0].metadata.pageNumber).toBe(2);
      expect(result.results[0].document?.href).toBe(
        `/api/public/corpus/documents/${first[0].documentId}/file`,
      );
    },
  );

  (enabled ? it : it.skip)(
    'distinguishes identical bytes from same-name changed files and blocks restricted records before count',
    async () => {
      const identical = await readFile(
        path.join(fixtureRoot, 'fallo-fixture.pdf'),
      );
      const a = await pipeline.ingestOne(
        {
          filename: 'copia-a.pdf',
          externalId: 'copy-a',
          content: identical,
          mimeType: 'application/pdf',
          title: 'Copia A',
          visibility: 'PUBLIC',
        },
        { sourceCode, sourceName: 'Synthetic M6 fixture' },
      );
      const b = await pipeline.ingestOne(
        {
          filename: 'copia-b.pdf',
          externalId: 'copy-b',
          content: identical,
          mimeType: 'application/pdf',
          title: 'Copia B',
          visibility: 'PUBLIC',
        },
        { sourceCode, sourceName: 'Synthetic M6 fixture' },
      );
      expect(a.checksum).toBe(b.checksum);
      expect(a.documentId).not.toBe(b.documentId);
      expect(
        (
          await prisma.corpusDocumentFile.findUnique({
            where: {
              id: (
                await prisma.corpusIngestionRecord.findUniqueOrThrow({
                  where: { id: a.ingestionId },
                })
              ).fileId!,
            },
          })
        )?.storageKey,
      ).toBe(
        (
          await prisma.corpusDocumentFile.findUnique({
            where: {
              id: (
                await prisma.corpusIngestionRecord.findUniqueOrThrow({
                  where: { id: b.ingestionId },
                })
              ).fileId!,
            },
          })
        )?.storageKey,
      );

      const sameNameA = await readFile(
        path.join(fixtureRoot, 'version-a/mismo-nombre.pdf'),
      );
      const sameNameB = await readFile(
        path.join(fixtureRoot, 'version-b/mismo-nombre.pdf'),
      );
      const changedA = await pipeline.ingestOne(
        {
          filename: 'mismo-nombre.pdf',
          externalId: 'changed-a',
          content: sameNameA,
          mimeType: 'application/pdf',
          title: 'Version A',
        },
        { sourceCode, sourceName: 'Synthetic M6 fixture' },
      );
      const changedB = await pipeline.ingestOne(
        {
          filename: 'mismo-nombre.pdf',
          externalId: 'changed-b',
          content: sameNameB,
          mimeType: 'application/pdf',
          title: 'Version B',
        },
        { sourceCode, sourceName: 'Synthetic M6 fixture' },
      );
      expect(changedA.checksum).not.toBe(changedB.checksum);

      const restricted = await pipeline.ingestOne(
        {
          filename: 'restricted.pdf',
          externalId: 'restricted',
          content: identical,
          mimeType: 'application/pdf',
          title: 'Restricted JORGE PORCEL FIXTURE',
          visibility: 'RESTRICTED',
        },
        { sourceCode, sourceName: 'Synthetic M6 fixture' },
      );
      const result = await search.search(
        parseSearchQuery('"JORGE PORCEL FIXTURE"'),
        publicContext,
      );
      expect(
        result.results.some((row) => row.sourceId === restricted.documentId),
      ).toBe(false);
      expect(result.total).toBe(2);
    },
  );

  (enabled ? it : it.skip)(
    'marks image-only PDF OCR_REQUIRED and allows failed extraction retry without deleting document',
    async () => {
      const blank = await readFile(path.join(fixtureRoot, 'pagina-vacia.pdf'));
      const scanned = await pipeline.ingestOne(
        {
          filename: 'pagina-vacia.pdf',
          externalId: 'blank',
          content: blank,
          mimeType: 'application/pdf',
        },
        { sourceCode, sourceName: 'Synthetic M6 fixture' },
      );
      expect(scanned.status).toBe('OCR_REQUIRED');
      const plainText = await readFile(
        path.join(fixtureRoot, 'nota-fixture.txt'),
      );
      const textFile = await pipeline.ingestOne(
        {
          filename: 'nota-fixture.txt',
          externalId: 'plain-text',
          content: plainText,
          mimeType: 'text/plain',
        },
        { sourceCode, sourceName: 'Synthetic M6 fixture' },
      );
      expect(textFile.status).toBe('INDEXED');

      class ToggleExtractor implements DocumentTextExtractor {
        fail = true;
        async extract(
          filename: string,
          mimeType: string,
          content: Buffer,
        ): Promise<ExtractionResult> {
          if (this.fail)
            throw new Error('synthetic transient extractor failure');
          return new BasicDocumentTextExtractor().extract(
            filename,
            mimeType,
            content,
          );
        }
      }
      const toggle = new ToggleExtractor();
      const retryPipeline = new CorpusIngestionService(prisma, storage, toggle);
      await expect(
        retryPipeline.ingestOne(
          {
            filename: 'retry.txt',
            externalId: 'retry',
            content: Buffer.from('retry success JORGE PORCEL FIXTURE'),
            mimeType: 'text/plain',
          },
          { sourceCode, sourceName: 'Synthetic M6 fixture' },
        ),
      ).rejects.toThrow('synthetic transient');
      const failed = await prisma.corpusIngestionRecord.findFirstOrThrow({
        where: { sourceSystemId: sourceId, externalId: 'retry' },
      });
      expect(failed.status).toBe('FAILED');
      expect(failed.errorStage).toBe('EXTRACT');
      toggle.fail = false;
      const retried = await retryPipeline.retryExtraction(failed.documentId);
      expect(retried.status).toBe('TEXT_EXTRACTED');
      expect(
        (
          await prisma.corpusDocument.findUniqueOrThrow({
            where: { id: failed.documentId },
          })
        ).status,
      ).toBe('INDEXED');
    },
  );
});

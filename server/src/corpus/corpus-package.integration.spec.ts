import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseSearchQuery } from '../busqueda/utils/search-parser';
import { FederatedSearchService } from '../busqueda/federated-search.service';
import { PostgresJurisprudenciaSearchAdapter } from '../busqueda/adapters/postgres-jurisprudencia-search.adapter';
import { CorpusSearchSourceAdapter } from './corpus-search.adapter';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import {
  DocumentIngestionPackageValidator,
  sha256,
  stableJson,
} from './document-ingestion-package';
import type { ImportReceipt } from '../../scripts/dev/corpus-package';
import { importPackage } from '../../scripts/dev/corpus-package';
import { PrismaService } from '../prisma/prisma.service';

const enabled = process.env.CORPUS_PACKAGE_POSTGRES_TEST === '1';
const fixtureRoot = path.resolve(process.cwd(), 'scripts/dev/fixtures/corpus');
const context = {
  visibility: 'PUBLIC' as const,
  dialect: 'modern' as const,
  publicationPolicy: 'published-active-only' as const,
  page: 1,
  pageSize: 20,
};

type FixtureManifest = Record<string, unknown> & {
  documents: Array<Record<string, unknown>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFixtureManifest(contents: string): FixtureManifest {
  const parsed: unknown = JSON.parse(contents);
  if (!isRecord(parsed) || !Array.isArray(parsed.documents)) {
    throw new Error('CORPUS_TEST_MANIFEST_INVALID');
  }
  const documents: unknown[] = parsed.documents;
  const records = documents.filter(isRecord);
  if (records.length !== documents.length) {
    throw new Error('CORPUS_TEST_MANIFEST_DOCUMENT_INVALID');
  }
  return { ...parsed, documents: records };
}

describe('BJC institutional ingestion package PostgreSQL end-to-end', () => {
  const prisma = new PrismaService();
  const validator = new DocumentIngestionPackageValidator();
  const sourceCode = `BJC_PACKAGE_TEST_${randomUUID().replace(/-/gu, '').slice(0, 16).toUpperCase()}`;
  const packageRoot = path.join(os.tmpdir(), `bjc-package-${randomUUID()}`);
  const receiptRoot = path.join(os.tmpdir(), `bjc-receipts-${randomUUID()}`);
  const storageRoot = path.join(os.tmpdir(), `bjc-storage-${randomUUID()}`);
  const priorStorage = process.env.BJC_CORPUS_STORAGE_PATH;
  let corpusSearch: CorpusSearchSourceAdapter;
  let jurisprudenciaSearch: PostgresJurisprudenciaSearchAdapter;
  let federation: FederatedSearchService;
  let access: CorpusDocumentAccessService;

  beforeAll(async () => {
    if (!enabled) return;
    process.env.BJC_CORPUS_STORAGE_PATH = storageRoot;
    await prisma.$connect();
    await mkdir(path.join(packageRoot, 'files'), { recursive: true });
    const duplicatePdf = Buffer.concat([
      await readFile(path.join(fixtureRoot, 'fallo-fixture.pdf')),
      Buffer.from(`\n% QA-PACKAGE-${sourceCode}\n`),
    ]);
    await writeFile(path.join(packageRoot, 'files', 'fallo.pdf'), duplicatePdf);
    await writeFile(path.join(packageRoot, 'files', 'copia.pdf'), duplicatePdf);
    await copyFile(
      path.join(fixtureRoot, 'pagina-vacia.pdf'),
      path.join(packageRoot, 'files', 'scan.pdf'),
    );
    await writeFile(
      path.join(packageRoot, 'files', 'nota.txt'),
      'BJC PACKAGE UNIQUE PHRASE 753987.\nEste contenido sintético conserva ñ y acentos.',
    );
    const manifest = {
      schemaVersion: '1.0',
      packageId: `BJC-PACKAGE-${randomUUID()}`,
      source: {
        code: sourceCode,
        name: 'Fixture institucional sintético',
        type: 'FIXTURE',
      },
      generatedAt: '2026-10-07T12:00:00.000Z',
      documents: [
        {
          path: 'fallo.pdf',
          externalId: 'external-fallo-1',
          mimeType: 'application/pdf',
          title: 'Fallo fixture',
          caseNumber: 'CIV 753987/2026',
          visibility: 'PUBLIC',
        },
        {
          path: 'copia.pdf',
          externalId: 'external-fallo-2',
          mimeType: 'application/pdf',
          title: 'Copia oficial fixture',
          visibility: 'PUBLIC',
        },
        {
          path: 'scan.pdf',
          externalId: 'external-scan',
          mimeType: 'application/pdf',
          title: 'PDF sin texto fixture',
          visibility: 'RESTRICTED',
        },
        {
          path: 'nota.txt',
          mimeType: 'text/plain',
          title: 'Nota institucional sin ID',
          visibility: 'PUBLIC',
        },
      ],
    };
    await writeFile(
      path.join(packageRoot, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    corpusSearch = new CorpusSearchSourceAdapter();
    jurisprudenciaSearch = new PostgresJurisprudenciaSearchAdapter();
    federation = new FederatedSearchService(
      jurisprudenciaSearch,
      corpusSearch,
      5000,
    );
    access = new CorpusDocumentAccessService(prisma);
  });

  afterAll(async () => {
    if (!enabled) return;
    const source = await prisma.corpusSourceSystem.findUnique({
      where: { code: sourceCode },
      select: { id: true },
    });
    if (source) {
      const ingestions = await prisma.corpusIngestionRecord.findMany({
        where: { sourceSystemId: source.id },
        select: { documentId: true },
      });
      await prisma.corpusIngestionRecord.deleteMany({
        where: { sourceSystemId: source.id },
      });
      await prisma.corpusDocument.deleteMany({
        where: {
          id: { in: [...new Set(ingestions.map((item) => item.documentId))] },
        },
      });
      await prisma.corpusSourceSystem.delete({ where: { id: source.id } });
    }
    await federation.onModuleDestroy();
    await prisma.$disconnect();
    await Promise.all(
      [packageRoot, receiptRoot, storageRoot].map((item) =>
        rm(item, { recursive: true, force: true }),
      ),
    );
    if (priorStorage === undefined) delete process.env.BJC_CORPUS_STORAGE_PATH;
    else process.env.BJC_CORPUS_STORAGE_PATH = priorStorage;
  });

  (enabled ? it : it.skip)(
    'validates, dry-runs, imports, searches, serves metadata/files, and reimports idempotently',
    async () => {
      const prepared = await validator.prepare(packageRoot);
      expect(prepared.issues).toEqual([]);
      expect(prepared.documents).toHaveLength(4);

      const result = await importPackage(prepared, {
        command: 'import',
        receiptDir: receiptRoot,
      });
      expect(result.receipt.status).toBe('SUCCESS');
      expect(result.receipt.imported).toBe(3);
      expect(result.receipt.skipped).toBe(1);
      expect(verifyReceipt(result.receipt)).toBe(true);

      const repeated = await importPackage(prepared, {
        command: 'import',
        receiptDir: receiptRoot,
      });
      expect(repeated.receipt.status).toBe('ALREADY_IMPORTED');
      expect(repeated.receipt.imported).toBe(0);
      expect(repeated.receipt.skipped).toBe(4);

      const records = await prisma.corpusIngestionRecord.findMany({
        where: { sourceSystem: { code: sourceCode } },
        include: {
          document: {
            include: {
              files: true,
              latestExtraction: { include: { pages: true } },
            },
          },
        },
      });
      expect(records).toHaveLength(4);
      expect(
        records.find((record) => record.externalId === 'external-fallo-1')
          ?.documentId,
      ).toBe(
        records.find((record) => record.externalId === 'external-fallo-2')
          ?.documentId,
      );
      expect(new Set(records.map((record) => record.documentId)).size).toBe(3);
      expect(
        new Set(
          records.flatMap((record) =>
            record.document.files.map((file) => file.storageKey),
          ),
        ).size,
      ).toBe(3);
      expect(records.some((record) => record.status === 'OCR_REQUIRED')).toBe(
        true,
      );
      expect(
        records.find((record) => record.externalId === 'external-fallo-1')
          ?.document.latestExtraction?.pages.length,
      ).toBeGreaterThan(0);

      const searched = await federation.search(
        parseSearchQuery('"BJC PACKAGE UNIQUE PHRASE 753987"'),
        context,
      );
      expect(searched.sources.every((source) => source.ok)).toBe(true);
      expect(
        searched.results.some(
          (item) =>
            item.sourceSystem === 'CORPUS' &&
            item.sourceId ===
              records.find(
                (row) =>
                  row.externalId ===
                  'package:' + prepared.packageId + ':nota.txt',
              )?.documentId,
        ),
      ).toBe(true);

      const publicPdf = records.find(
        (record) => record.externalId === 'external-fallo-1',
      )!;
      const file = await access.file(publicPdf.documentId, 'PUBLIC');
      expect(sha256(file.content)).toBe(publicPdf.checksum);
      const metadata = await access.metadata(publicPdf.documentId, 'PUBLIC', 1);
      expect(metadata.source?.code).toBe(sourceCode);
      expect(metadata.file?.sha256).toBe(publicPdf.checksum);
      expect(
        (metadata.selectedPage as { pageNumber: number } | undefined)
          ?.pageNumber,
      ).toBe(1);

      const restricted = records.find(
        (record) => record.externalId === 'external-scan',
      )!;
      await expect(
        access.metadata(restricted.documentId, 'PUBLIC'),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        access.file(restricted.documentId, 'INTERNAL'),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await access.metadata(restricted.documentId, 'ADMIN')).visibility,
      ).toBe('RESTRICTED');
    },
  );

  (enabled ? it : it.skip)(
    'records a changed file version without overwriting the original',
    async () => {
      const firstManifest = parseFixtureManifest(
        await readFile(path.join(packageRoot, 'manifest.json'), 'utf8'),
      );
      const secondRoot = path.join(packageRoot, 'version-two');
      await mkdir(path.join(secondRoot, 'files'), { recursive: true });
      await copyFile(
        path.join(fixtureRoot, 'version-a', 'mismo-nombre.pdf'),
        path.join(secondRoot, 'files', 'same.pdf'),
      );
      const base = firstManifest.documents[0];
      const firstPackageId = `BJC-VERSION-${randomUUID()}`;
      await writeFile(
        path.join(secondRoot, 'manifest.json'),
        JSON.stringify({
          ...firstManifest,
          packageId: firstPackageId,
          documents: [
            {
              ...base,
              path: 'same.pdf',
              filename: 'same.pdf',
              externalId: 'versioned-external-id',
              title: 'Versioned document',
            },
          ],
        }),
      );
      const first = await importPackage(await validator.prepare(secondRoot), {
        command: 'import',
        receiptDir: receiptRoot,
      });
      await copyFile(
        path.join(fixtureRoot, 'version-b', 'mismo-nombre.pdf'),
        path.join(secondRoot, 'files', 'same.pdf'),
      );
      const secondManifest = parseFixtureManifest(
        await readFile(path.join(secondRoot, 'manifest.json'), 'utf8'),
      );
      await writeFile(
        path.join(secondRoot, 'manifest.json'),
        JSON.stringify({
          ...secondManifest,
          packageId: `BJC-VERSION-${randomUUID()}`,
        }),
      );
      const second = await importPackage(await validator.prepare(secondRoot), {
        command: 'import',
        receiptDir: receiptRoot,
      });
      expect(first.receipt.entries[0].documentId).toBe(
        second.receipt.entries[0].documentId,
      );
      expect(first.receipt.entries[0].sha256).not.toBe(
        second.receipt.entries[0].sha256,
      );
      const versions = await prisma.corpusDocumentFile.findMany({
        where: { documentId: first.receipt.entries[0].documentId },
        orderBy: { version: 'asc' },
      });
      expect(versions.map((item) => item.version)).toEqual([1, 2]);
      await prisma.corpusIngestionRecord.deleteMany({
        where: {
          sourceSystem: { code: sourceCode },
          documentId: first.receipt.entries[0].documentId,
        },
      });
      await prisma.corpusDocument.delete({
        where: { id: first.receipt.entries[0].documentId },
      });
      await rm(secondRoot, { recursive: true, force: true });
    },
  );
});

function verifyReceipt(receipt: ImportReceipt) {
  const copy = { ...receipt };
  delete copy.receiptSha256;
  return sha256(stableJson(copy)) === receipt.receiptSha256;
}

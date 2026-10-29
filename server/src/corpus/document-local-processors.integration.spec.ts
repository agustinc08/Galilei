import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFParse } from 'pdf-parse';
import {
  LibreOfficeLegacyDocExtractor,
  LocalPdfOcrProcessor,
  resolveLocalProcessorConfig,
} from './document-local-processors';
import {
  BasicDocumentTextExtractor,
  InvalidPdfError,
} from './document-text-extractor';

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);
const tempDir = path.join(os.tmpdir(), `galilei-sprint154a1-${process.pid}`);
const baseConfig = resolveLocalProcessorConfig();
const processor = new LocalPdfOcrProcessor({
  ...baseConfig,
  enabled: true,
  languages: ['spa'],
  dpi: 250,
  tempDir,
});
const runIfAvailable = processor.capabilities.ocrAvailable ? it : it.skip;
const runIfOfficeAvailable = processor.capabilities.docAvailable ? it : it.skip;
const previousTempSetting = process.env.OCR_TEMP_DIR;

function sha256(content: Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

async function expectTempClean() {
  await expect(readdir(tempDir)).resolves.toEqual([]);
}

describe('local PDF OCR integration', () => {
  beforeAll(async () => {
    process.env.OCR_TEMP_DIR = tempDir;
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
    if (previousTempSetting === undefined) delete process.env.OCR_TEMP_DIR;
    else process.env.OCR_TEMP_DIR = previousTempSetting;
  });

  it('extracts native text and marks image-only pages for OCR', async () => {
    const content = await readFile(
      path.join(fixtureDir, 'sprint154a1-hybrid.pdf'),
    );
    const extraction = await new BasicDocumentTextExtractor().extract(
      'hybrid.pdf',
      'application/pdf',
      content,
    );
    expect(extraction.status).toBe('OCR_REQUIRED');
    expect(extraction.ocrRequiredPages).toEqual([2, 4]);
    expect(extraction.pages[0].text).toBe('NATIVE PAGE ONE TEXT SOURCE');
    expect(extraction.pages[2].text).toBe('NATIVE PAGE THREE TEXT SOURCE');
    const parser = new PDFParse({ data: content });
    try {
      const result = await parser.getText();
      expect(result.pages.map((page) => page.text.trim())).toEqual([
        'NATIVE PAGE ONE TEXT SOURCE',
        '',
        'NATIVE PAGE THREE TEXT SOURCE',
        '',
      ]);
    } finally {
      await parser.destroy();
    }
  });

  it('returns a controlled invalid-PDF error without changing the original bytes', async () => {
    const corrupt = Buffer.from('%PDF-not-a-complete-pdf');
    const originalSha = sha256(corrupt);
    await expect(
      new BasicDocumentTextExtractor().extract(
        'corrupt.pdf',
        'application/pdf',
        corrupt,
      ),
    ).rejects.toBeInstanceOf(InvalidPdfError);
    expect(sha256(corrupt)).toBe(originalSha);
    await expectTempClean();
  });

  runIfAvailable(
    'recognizes Spanish from an image-only PDF using argument-based processing',
    async () => {
      const content = await readFile(
        path.join(fixtureDir, 'sprint154a1-image-only.pdf'),
      );
      const result = await processor.processPdf(content, sha256(content), [1]);
      const normalized = result.pages[0].text
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase();

      expect(result.pages[0].pageNumber).toBe(1);
      expect(normalized).toContain('12345/2026');
      expect(normalized).toContain('responsabilidad civil');
      expect(normalized).toContain('dano moral');
      expect(normalized).toContain('nino');
      expect(normalized).toContain('cordoba');
      expect(normalized).toContain('ocrtesttokenxyz');
      expect(result.provenance).toMatchObject({
        languages: ['spa'],
        dpi: 250,
        pageNumbers: [1],
      });
      await expectTempClean();
    },
  );

  runIfAvailable(
    'OCRs only scanned pages in a four-page hybrid PDF and cleans failures/timeouts',
    async () => {
      const hybrid = await readFile(
        path.join(fixtureDir, 'sprint154a1-hybrid.pdf'),
      );
      const result = await processor.processPdf(hybrid, sha256(hybrid), [2, 4]);
      expect(result.pages.map((page) => page.pageNumber)).toEqual([2, 4]);
      expect(result.pages[0].text.normalize('NFC').toLowerCase()).toContain(
        'daño moral',
      );
      expect(result.pages[1].text.toLowerCase()).toContain('9876');
      await expectTempClean();

      const blank = await readFile(
        path.join(fixtureDir, 'sprint154a1-blank.pdf'),
      );
      await expect(
        processor.processPdf(blank, sha256(blank), [1]),
      ).rejects.toMatchObject({ code: 'OCR_LOW_QUALITY' });
      await expectTempClean();

      await expect(
        processor.processPdf(hybrid, sha256(hybrid), [2], { timeoutMs: 1 }),
      ).rejects.toMatchObject({ code: 'OCR_TIMEOUT' });
      await expectTempClean();
    },
    120_000,
  );

  runIfOfficeAvailable(
    'extracts a real legacy DOC locally and cleans its isolated profile',
    async () => {
      const content = await readFile(
        path.join(fixtureDir, 'sprint154a1-golden.doc'),
      );
      const extraction = await new BasicDocumentTextExtractor().extract(
        'a & whoami.doc',
        'application/msword',
        content,
      );
      const text = extraction.text.normalize('NFC').toLowerCase();

      expect(extraction.formatDetected).toBe('DOC');
      expect(text).toContain('12345/2026');
      expect(text).toContain('daño moral');
      expect(text).toContain('córdoba');
      expect(text).toContain('cámara nacional');
      expect(text).toContain('celda juridica');
      expect(text).toContain('registro 2026');
      expect(extraction.provenance).toMatchObject({
        outputFormat: 'TXT',
        macroSecurity: 'HIGH',
        remoteLinkUpdates: 'DISABLED',
        profile: 'ISOLATED_TEMPORARY',
      });
      expect(extraction.provenance?.fileSha256).toBe(sha256(content));
      await expectTempClean();
    },
    120_000,
  );

  runIfOfficeAvailable(
    'rejects synthetic DOC macro and embedded-object markers before conversion',
    async () => {
      const golden = await readFile(
        path.join(fixtureDir, 'sprint154a1-golden.doc'),
      );
      const extractor = new BasicDocumentTextExtractor();
      const macro = Buffer.concat([golden, Buffer.from('VBAProject', 'ascii')]);
      const embedded = Buffer.concat([
        golden,
        Buffer.from('Ole10Native', 'ascii'),
      ]);
      await expect(
        extractor.extract('active.doc', 'application/msword', macro),
      ).rejects.toMatchObject({
        code: 'DOC_ACTIVE_OR_EMBEDDED_CONTENT_UNSUPPORTED',
      });
      await expect(
        extractor.extract('embedded.doc', 'application/msword', embedded),
      ).rejects.toMatchObject({
        code: 'DOC_ACTIVE_OR_EMBEDDED_CONTENT_UNSUPPORTED',
      });
      await expectTempClean();
    },
    120_000,
  );

  runIfOfficeAvailable(
    'classifies a DOC timeout and removes its temporary profile',
    async () => {
      const content = await readFile(
        path.join(fixtureDir, 'sprint154a1-golden.doc'),
      );
      await expect(
        new LibreOfficeLegacyDocExtractor().extract(content, 1),
      ).rejects.toMatchObject({ code: 'DOC_TIMEOUT' });
      await expectTempClean();
    },
    120_000,
  );
});

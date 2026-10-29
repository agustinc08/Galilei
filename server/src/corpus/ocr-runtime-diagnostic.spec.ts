import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PrismaService } from '../prisma/prisma.service';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import type { OcrRunResult, RuntimeConfig } from './document-local-processors';
import { LocalPdfOcrProcessor } from './document-local-processors';
import { OcrHumanReviewService } from './ocr-human-review.service';

function singlePageTextPdf(text: string) {
  const escaped = text
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, 'latin1'));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}

function makeProcessor(pageCount = 1) {
  const config: RuntimeConfig = {
    enginePath: 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
    rendererPath: 'C:\\Program Files\\Poppler\\pdftoppm.exe',
    tessdataDir: 'C:\\Program Files\\Tesseract-OCR\\tessdata',
    officePath: null,
    languages: ['spa'],
    dpi: 250,
    timeoutMs: 90_000,
    minFreeDiskBytes: 32 * 1024 * 1024,
    maxPages: 2_000,
    tempDir: 'C:\\Temp\\galilei-ocr-test',
    enabled: true,
  };
  const inspectPdfPageCount = jest.fn().mockResolvedValue(pageCount);
  const processPdf = jest
    .fn<
      Promise<OcrRunResult>,
      [
        Buffer,
        string,
        number[],
        { dpi?: number; timeoutMs?: number; languages?: string[] },
      ]
    >()
    .mockResolvedValue({
      pages: [
        {
          pageNumber: 1,
          text: 'Prueba técnica. Ñandú, acción, corazón.',
          confidence: 91,
          fingerprint: 'run',
        },
      ],
      provenance: { languages: ['spa'] },
    });
  const processor = {
    config,
    capabilities: {
      enginePath: config.enginePath,
      engineVersion: 'tesseract 5.5.3',
      languages: ['eng', 'osd', 'spa'],
      rendererPath: config.rendererPath,
      rendererVersion: 'pdftoppm version 24.02.0',
      officePath: null,
      ocrAvailable: true,
      docAvailable: false,
      ocrEnabled: true,
    },
    inspectPdfPageCount,
    processPdf,
  };
  return {
    processor: processor as unknown as LocalPdfOcrProcessor,
    inspectPdfPageCount,
    processPdf,
  };
}

function serviceFor(processor: LocalPdfOcrProcessor) {
  return new OcrHumanReviewService(
    {} as PrismaService,
    processor,
    {} as CorpusDocumentAccessService,
  );
}

describe('OCR runtime diagnostics', () => {
  it('reports process-local paths and language capability without exposing the full PATH', () => {
    const { processor } = makeProcessor();
    const service = serviceFor(processor);
    const diagnostics = service.runtimeDiagnostics();

    expect(diagnostics.process).toMatchObject({
      pid: process.pid,
      nodeVersion: process.version,
      executable: process.execPath,
      workingDirectory: process.cwd(),
    });
    expect(diagnostics.ocr).toMatchObject({
      available: true,
      spanishAvailable: true,
      installedLanguages: ['eng', 'osd', 'spa'],
    });
    expect(JSON.stringify(diagnostics)).not.toContain(
      process.env.PATH ?? 'PATH_UNSET',
    );
  });

  it('skips OCR when native text is present and preserves the uploaded bytes', async () => {
    const { processor, processPdf } = makeProcessor();
    const content = singlePageTextPdf(
      'Technical runtime check with selectable native text on a single PDF page.',
    );
    const result = await serviceFor(processor).verifyRuntimePdf(content);

    expect(result).toMatchObject({
      status: 'NATIVE_TEXT_FOUND',
      ocrAttempted: false,
      originalPreserved: true,
      pageCount: 1,
    });
    expect(processPdf).not.toHaveBeenCalled();
  });

  it('calls the process-local OCR processor for an image-only PDF', async () => {
    const { processor, processPdf } = makeProcessor();
    const content = await readFile(
      resolve(process.cwd(), 'src/corpus/fixtures/sprint154a1-image-only.pdf'),
    );
    const result = await serviceFor(processor).verifyRuntimePdf(content);

    expect(result).toMatchObject({
      status: 'OCR_READY_FOR_HUMAN_REVIEW',
      ocrAttempted: true,
      originalPreserved: true,
      pageCount: 1,
    });
    expect(processPdf).toHaveBeenCalledWith(content, expect.any(String), [1], {
      languages: ['spa'],
      timeoutMs: 60_000,
    });
  });

  it('returns a controlled error for corrupt input and rejects more than three pages', async () => {
    const {
      processor: corruptProcessor,
      inspectPdfPageCount: inspectCorruptPageCount,
    } = makeProcessor();
    const corrupt = Buffer.from('not a PDF');
    const corruptResult =
      await serviceFor(corruptProcessor).verifyRuntimePdf(corrupt);
    expect(corruptResult).toMatchObject({
      status: 'CONTROLLED_ERROR',
      errorCode: 'FILE_INVALID',
      originalPreserved: true,
    });
    expect(inspectCorruptPageCount).not.toHaveBeenCalled();

    const { processor: largePageCountProcessor, processPdf: processLargePdf } =
      makeProcessor(4);
    const pageLimitResult = await serviceFor(
      largePageCountProcessor,
    ).verifyRuntimePdf(
      singlePageTextPdf(
        'This valid one-page body is ignored by the mocked physical page count.',
      ),
    );
    expect(pageLimitResult).toMatchObject({
      status: 'CONTROLLED_ERROR',
      errorCode: 'PAGE_LIMIT',
      originalPreserved: true,
      pageCount: 4,
    });
    expect(processLargePdf).not.toHaveBeenCalled();
  });
});

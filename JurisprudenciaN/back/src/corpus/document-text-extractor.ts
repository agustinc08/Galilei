import { PDFParse } from 'pdf-parse';

export type ExtractedPage = { pageNumber: number; text: string };
export type ExtractionResult = {
  extractor: string;
  extractorVersion: string;
  status: 'TEXT_EXTRACTED' | 'OCR_REQUIRED';
  text: string;
  pages: ExtractedPage[];
};

export class InvalidPdfError extends Error {
  constructor(message = 'PDF inválido o ilegible.') {
    super(message);
    this.name = 'InvalidPdfError';
  }
}

export interface DocumentTextExtractor {
  extract(
    filename: string,
    mimeType: string,
    content: Buffer,
  ): Promise<ExtractionResult>;
}

export class BasicDocumentTextExtractor implements DocumentTextExtractor {
  async extract(
    filename: string,
    mimeType: string,
    content: Buffer,
  ): Promise<ExtractionResult> {
    const isPdf =
      mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      if (
        mimeType !== 'text/plain' &&
        !filename.toLowerCase().endsWith('.txt')
      ) {
        throw new Error(`Formato no soportado: ${mimeType}`);
      }
      const text = content
        .toString('utf8')
        .replace(/^\uFEFF/u, '')
        .trim();
      return {
        extractor: 'plain-text',
        extractorVersion: '1',
        status: text ? 'TEXT_EXTRACTED' : 'OCR_REQUIRED',
        text,
        pages: text ? [{ pageNumber: 1, text }] : [],
      };
    }

    if (content.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new InvalidPdfError('El archivo no contiene una firma PDF válida.');
    }
    const parser = new PDFParse({ data: content });
    try {
      const result = await parser.getText();
      const pages = result.pages.map((page, index) => ({
        pageNumber: index + 1,
        text: page.text.trim(),
      }));
      const text = pages
        .map((page) => page.text)
        .filter(Boolean)
        .join('\n\n')
        .trim();
      return {
        extractor: 'pdf-parse',
        extractorVersion: '2.4.5',
        status: text ? 'TEXT_EXTRACTED' : 'OCR_REQUIRED',
        text,
        pages,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        /invalid pdf|invalid xref|xref table|pdf structure|unexpected eof/iu.test(
          message,
        )
      ) {
        throw new InvalidPdfError(message);
      }
      throw error;
    } finally {
      await parser.destroy();
    }
  }
}

import { PDFParse } from 'pdf-parse';
import {
  DocumentFormatDetector,
  type DetectedDocumentFormat,
  type DocumentDetectionMethod,
  type DocumentFormat,
} from './document-format-detector';
import {
  DocumentExtractionError,
  InvalidPdfError,
  UnsupportedDocumentError,
} from './document-extraction-errors';
import {
  extractOfficeXml,
  extractRtf,
  MAX_EXTRACTED_TEXT_CHARS,
} from './document-office-extractors';
import {
  LibreOfficeLegacyDocExtractor,
  LocalDocumentProcessingError,
} from './document-local-processors';

export {
  DocumentExtractionError,
  EncryptedDocumentError,
  InvalidPdfError,
  UnsupportedDocumentError,
} from './document-extraction-errors';
export {
  DocumentFormatDetector,
  type DetectedDocumentFormat,
  type DocumentDetectionMethod,
  type DocumentFormat,
} from './document-format-detector';

export type ExtractedPage = {
  pageNumber: number;
  text: string;
};

export type ExtractionStatus =
  | 'TEXT_EXTRACTED'
  | 'EXTRACTED_TRUNCATED'
  | 'OCR_REQUIRED';

export type ExtractionResult = {
  extractor: string;
  extractorVersion: string;
  status: ExtractionStatus;
  text: string;
  pages: ExtractedPage[];
  formatDetected: DocumentFormat;
  mimeDetected: string;
  extensionOriginal: string;
  detectionMethod: DocumentDetectionMethod;
  warnings: string[];
  ocrRequiredPages: number[];
  provenance?: Record<string, unknown>;
};

export function extractionProvenance(extraction: ExtractionResult) {
  return {
    formatDetected: extraction.formatDetected,
    mimeDetected: extraction.mimeDetected,
    extensionOriginal: extraction.extensionOriginal,
    detectionMethod: extraction.detectionMethod,
    extractor: extraction.extractor,
    extractorVersion: extraction.extractorVersion,
    extractionStatus: extraction.status,
    warnings: extraction.warnings,
    ocrRequiredPages: extraction.ocrRequiredPages,
    ...(extraction.provenance ? { localProcessor: extraction.provenance } : {}),
  };
}

export interface DocumentTextExtractor {
  extract(
    filename: string,
    mimeType: string,
    content: Buffer,
  ): Promise<ExtractionResult>;
}

const PDF_EXTRACTOR_VERSION = 'pdf-parse@2.4.5';
const TEXT_EXTRACTOR_VERSION = '1';
const MIN_NATIVE_PAGE_CHARACTERS = 25;

export class BasicDocumentTextExtractor implements DocumentTextExtractor {
  constructor(
    private readonly detector = new DocumentFormatDetector(),
    private readonly legacyDocExtractor = new LibreOfficeLegacyDocExtractor(),
  ) {}

  async extract(
    filename: string,
    _submittedMimeType: string,
    content: Buffer,
  ): Promise<ExtractionResult> {
    const detected = this.detector.detect(filename, content);
    if (detected.format === 'PDF') return this.extractPdf(content, detected);
    if (detected.format === 'TXT') {
      return this.resultFromText(
        detected,
        'plain-text',
        TEXT_EXTRACTOR_VERSION,
        detected.decodedText ?? '',
      );
    }
    if (detected.format === 'RTF') {
      const extracted = extractRtf(content);
      return this.resultFromText(
        detected,
        'rtf-text',
        TEXT_EXTRACTOR_VERSION,
        extracted.text,
        extracted.truncated,
      );
    }
    if (detected.format === 'DOCX' || detected.format === 'ODT') {
      if (!detected.archive) {
        throw new UnsupportedDocumentError('INVALID_OFFICE_DOCUMENT');
      }
      const extracted = extractOfficeXml(detected.format, detected.archive);
      return this.resultFromText(
        detected,
        detected.format === 'DOCX' ? 'docx-xml' : 'odt-xml',
        TEXT_EXTRACTOR_VERSION,
        extracted.text,
        extracted.truncated,
      );
    }
    if (detected.format === 'DOC') {
      try {
        const extracted = await this.legacyDocExtractor.extract(content);
        const extractorVersion = extracted.provenance.extractorVersion;
        return this.resultFromText(
          detected,
          'libreoffice-headless',
          typeof extractorVersion === 'string'
            ? extractorVersion
            : 'runtime-detected',
          extracted.text,
          extracted.truncated,
          extracted.provenance,
        );
      } catch (error) {
        if (error instanceof LocalDocumentProcessingError) {
          throw new UnsupportedDocumentError(error.code, error.code);
        }
        throw error;
      }
    }
    throw new UnsupportedDocumentError(
      'LEGACY_DOC_UNSUPPORTED',
      'Legacy DOC extraction is unavailable because no safe local parser is installed.',
    );
  }

  private async extractPdf(
    content: Buffer,
    detected: DetectedDocumentFormat,
  ): Promise<ExtractionResult> {
    if (content.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new InvalidPdfError(
        'The file does not contain a valid PDF signature.',
      );
    }
    let parser: PDFParse | undefined;
    try {
      parser = new PDFParse({ data: content });
      const result = await parser.getText();
      const pages = result.pages.map((page, index) => ({
        pageNumber: index + 1,
        text: page.text.replaceAll('\u0000', '').trim(),
      }));
      const text = limitText(
        pages
          .map((page) => page.text)
          .filter(Boolean)
          .join('\n\n')
          .trim(),
      );
      const ocrRequiredPages = pages
        .filter((page) => page.text.length < MIN_NATIVE_PAGE_CHARACTERS)
        .map((page) => page.pageNumber);
      const warnings = [
        ...(text.truncated ? ['EXTRACTED_TRUNCATED'] : []),
        ...(ocrRequiredPages.length
          ? [`OCR_REQUIRED_PAGES:${ocrRequiredPages.join(',')}`]
          : []),
      ];
      return {
        extractor: 'pdf-parse',
        extractorVersion: PDF_EXTRACTOR_VERSION,
        status: ocrRequiredPages.length
          ? 'OCR_REQUIRED'
          : text.truncated
            ? 'EXTRACTED_TRUNCATED'
            : text.text
              ? 'TEXT_EXTRACTED'
              : 'OCR_REQUIRED',
        text: text.text,
        pages: limitPages(pages),
        formatDetected: detected.format,
        mimeDetected: detected.mimeType,
        extensionOriginal: detected.extensionOriginal,
        detectionMethod: detected.detectionMethod,
        warnings,
        ocrRequiredPages,
      };
    } catch (error) {
      if (error instanceof DocumentExtractionError) throw error;
      throw new InvalidPdfError();
    } finally {
      if (parser) await parser.destroy();
    }
  }

  private resultFromText(
    detected: DetectedDocumentFormat,
    extractor: string,
    extractorVersion: string,
    rawText: string,
    wasTruncated = false,
    provenance?: Record<string, unknown>,
  ): ExtractionResult {
    const limited = limitText(rawText);
    const text = normalizeText(limited.text);
    if (!text) throw new UnsupportedDocumentError('EMPTY_EXTRACTED_TEXT');
    const truncated = wasTruncated || limited.truncated;
    return {
      extractor,
      extractorVersion,
      status: truncated ? 'EXTRACTED_TRUNCATED' : 'TEXT_EXTRACTED',
      text,
      pages: [{ pageNumber: 1, text }],
      formatDetected: detected.format,
      mimeDetected: detected.mimeType,
      extensionOriginal: detected.extensionOriginal,
      detectionMethod: detected.detectionMethod,
      warnings: truncated ? ['EXTRACTED_TRUNCATED'] : [],
      ocrRequiredPages: [],
      ...(provenance ? { provenance } : {}),
    };
  }
}

function limitText(value: string) {
  return value.length <= MAX_EXTRACTED_TEXT_CHARS
    ? { text: value, truncated: false }
    : {
        text: value.slice(0, MAX_EXTRACTED_TEXT_CHARS),
        truncated: true,
      };
}

function limitPages(pages: ExtractedPage[]) {
  let remaining = MAX_EXTRACTED_TEXT_CHARS;
  const result: ExtractedPage[] = [];
  for (const page of pages) {
    if (remaining <= 0) break;
    const text = page.text.slice(0, remaining);
    result.push({ pageNumber: page.pageNumber, text });
    remaining -= text.length;
  }
  return result;
}

function normalizeText(value: string) {
  return value
    .replaceAll('\u0000', '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

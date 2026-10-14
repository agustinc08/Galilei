import path from 'node:path';
import {
  EncryptedDocumentError,
  UnsupportedDocumentError,
} from './document-extraction-errors';
import { readSafeZipArchive, type SafeZipArchive } from './safe-zip';

export type DocumentFormat = 'PDF' | 'TXT' | 'RTF' | 'DOC' | 'DOCX' | 'ODT';
export type DocumentDetectionMethod =
  | 'PDF_SIGNATURE'
  | 'OLE_SIGNATURE'
  | 'RTF_SIGNATURE'
  | 'ZIP_PACKAGE_SIGNATURE'
  | 'TXT_EXTENSION_AND_ENCODING';

export type DetectedDocumentFormat = {
  format: DocumentFormat;
  mimeType: string;
  extensionOriginal: string;
  detectionMethod: DocumentDetectionMethod;
  archive?: SafeZipArchive;
  decodedText?: string;
};

export const DOCUMENT_FORMAT_MIME_TYPES: Record<DocumentFormat, string> = {
  PDF: 'application/pdf',
  TXT: 'text/plain',
  RTF: 'application/rtf',
  DOC: 'application/msword',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ODT: 'application/vnd.oasis.opendocument.text',
};

const OLE_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const MACRO_EXTENSIONS = new Set([
  '.docm',
  '.dotm',
  '.xlsm',
  '.xltm',
  '.pptm',
  '.ppsm',
  '.potm',
]);

export class DocumentFormatDetector {
  detect(filename: string, content: Buffer): DetectedDocumentFormat {
    const extensionOriginal = path.extname(filename).toLowerCase();
    if (!content.length) {
      throw new UnsupportedDocumentError(
        'EMPTY_DOCUMENT',
        'Document is empty.',
      );
    }
    if (MACRO_EXTENSIONS.has(extensionOriginal)) {
      throw new UnsupportedDocumentError(
        'MACRO_DOCUMENT',
        'Macro-enabled Office files are not supported.',
      );
    }
    if (content.subarray(0, 5).toString('ascii') === '%PDF-') {
      return this.result('PDF', extensionOriginal, 'PDF_SIGNATURE');
    }
    if (content.subarray(0, OLE_SIGNATURE.length).equals(OLE_SIGNATURE)) {
      if (extensionOriginal === '.docx' || extensionOriginal === '.odt') {
        throw new EncryptedDocumentError();
      }
      if (extensionOriginal === '.doc') {
        return this.result('DOC', extensionOriginal, 'OLE_SIGNATURE');
      }
      throw new UnsupportedDocumentError('OLE_CONTAINER_UNSUPPORTED');
    }
    if (looksLikeRtf(content)) {
      return this.result('RTF', extensionOriginal, 'RTF_SIGNATURE');
    }
    if (isZip(content)) {
      const archive = readSafeZipArchive(content);
      const lowerNames = new Set(
        archive.names.map((name) => name.toLocaleLowerCase('en-US')),
      );
      if (
        lowerNames.has('word/vbaproject.bin') ||
        archive.names.some((name) => /(^|\/)(basic|scripts)\//iu.test(name))
      ) {
        throw new UnsupportedDocumentError(
          'MACRO_DOCUMENT',
          'Macro-enabled Office files are not supported.',
        );
      }
      if (
        lowerNames.has('[content_types].xml') &&
        lowerNames.has('word/document.xml')
      ) {
        const contentTypes = archive.entries.get('[Content_Types].xml');
        const typesText = contentTypes ? decodeXmlBytes(contentTypes) : '';
        if (!isDocxContentTypes(typesText)) {
          throw new UnsupportedDocumentError('INVALID_DOCX_PACKAGE');
        }
        return {
          ...this.result('DOCX', extensionOriginal, 'ZIP_PACKAGE_SIGNATURE'),
          archive,
        };
      }
      if (lowerNames.has('mimetype') && lowerNames.has('content.xml')) {
        const mime = archive.entries.get('mimetype')?.toString('ascii').trim();
        if (mime !== DOCUMENT_FORMAT_MIME_TYPES.ODT) {
          throw new UnsupportedDocumentError('INVALID_ODT_PACKAGE');
        }
        return {
          ...this.result('ODT', extensionOriginal, 'ZIP_PACKAGE_SIGNATURE'),
          archive,
        };
      }
      throw new UnsupportedDocumentError('UNSUPPORTED_ARCHIVE');
    }
    if (extensionOriginal === '.txt') {
      const decodedText = decodeTextBuffer(content);
      if (!isReasonableText(decodedText)) {
        throw new UnsupportedDocumentError(
          'UNSUPPORTED_ENCODING',
          'Text encoding is unsupported.',
        );
      }
      return {
        ...this.result('TXT', extensionOriginal, 'TXT_EXTENSION_AND_ENCODING'),
        decodedText,
      };
    }
    if (extensionOriginal === '.doc') {
      throw new UnsupportedDocumentError('INVALID_DOC_SIGNATURE');
    }
    if (extensionOriginal === '.pdf') {
      throw new UnsupportedDocumentError('INVALID_PDF_SIGNATURE');
    }
    if (extensionOriginal === '.docx') {
      throw new UnsupportedDocumentError('INVALID_DOCX_PACKAGE');
    }
    if (extensionOriginal === '.odt') {
      throw new UnsupportedDocumentError('INVALID_ODT_PACKAGE');
    }
    if (extensionOriginal === '.rtf') {
      throw new UnsupportedDocumentError('INVALID_RTF_SIGNATURE');
    }
    throw new UnsupportedDocumentError();
  }

  private result(
    format: DocumentFormat,
    extensionOriginal: string,
    detectionMethod: DocumentDetectionMethod,
  ): DetectedDocumentFormat {
    return {
      format,
      mimeType: DOCUMENT_FORMAT_MIME_TYPES[format],
      extensionOriginal,
      detectionMethod,
    };
  }
}

function isZip(content: Buffer) {
  return (
    content.length >= 4 &&
    content[0] === 0x50 &&
    content[1] === 0x4b &&
    content[2] === 0x03 &&
    content[3] === 0x04
  );
}

function looksLikeRtf(content: Buffer) {
  const prefix = content
    .subarray(0, Math.min(content.length, 64))
    .toString('latin1');
  return /^\uFEFF?\s*\{\\rtf[1-9]/u.test(prefix);
}

function decodeXmlBytes(content: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new UnsupportedDocumentError('INVALID_DOCX_PACKAGE');
  }
}

function isDocxContentTypes(value: string) {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(value)) return false;
  const xml = value.replace(/<!--[\s\S]*?-->/gu, '');
  if (!/<(?:[A-Za-z_][\w.-]*:)?Types\b/u.test(xml)) return false;
  const override = /<(?:[A-Za-z_][\w.-]*:)?Override\b[^>]*>/gu;
  for (const match of xml.matchAll(override)) {
    const tag = match[0];
    const partName = /\bPartName\s*=\s*(["'])\/word\/document\.xml\1/iu.test(
      tag,
    );
    const contentType =
      /\bContentType\s*=\s*(["'])application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml\1/iu.test(
        tag,
      );
    if (partName && contentType) return true;
  }
  return false;
}

function decodeTextBuffer(content: Buffer) {
  try {
    if (content.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        content.subarray(3),
      );
    }
    if (content.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) {
      return new TextDecoder('utf-16le', { fatal: true }).decode(
        content.subarray(2),
      );
    }
    if (content.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
      return new TextDecoder('utf-16be', { fatal: true }).decode(
        content.subarray(2),
      );
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new UnsupportedDocumentError(
      'UNSUPPORTED_ENCODING',
      'Text encoding is unsupported.',
    );
  }
}

function isReasonableText(text: string) {
  if (!text.trim() || text.includes('\0')) return false;
  let visible = 0;
  let total = 0;
  for (const character of text) {
    total += 1;
    if (/[\p{L}\p{N}\p{P}\p{Z}\t\r\n\f]/u.test(character)) visible += 1;
  }
  return total > 0 && visible / total >= 0.98;
}

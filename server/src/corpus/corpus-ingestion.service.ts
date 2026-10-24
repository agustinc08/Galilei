import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import type {
  DiscoveredDocument,
  DocumentSourceAdapter,
} from './document-source.adapter';
import {
  LocalDocumentStorageAdapter,
  type DocumentStorageAdapter,
} from './document-storage.adapter';
import {
  BasicDocumentTextExtractor,
  extractionProvenance,
  InvalidPdfError,
  type DocumentTextExtractor,
  type ExtractionResult,
} from './document-text-extractor';
import { normalizeSearchText } from '../busqueda/utils/search-normalizer';

export type IngestOptions = {
  sourceCode: string;
  sourceName: string;
  sourceType?: string;
};
export type IngestionOutcome = {
  ingestionId: string;
  documentId: string;
  fileId?: string;
  extractionId?: string;
  checksum: string;
  reused: boolean;
  status: string;
};

export class CorpusIngestionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: DocumentStorageAdapter = new LocalDocumentStorageAdapter(),
    private readonly extractor: DocumentTextExtractor = new BasicDocumentTextExtractor(),
  ) {}

  async ingestSource(source: DocumentSourceAdapter, options: IngestOptions) {
    const discovered = await source.discover();
    const results: IngestionOutcome[] = [];
    for (const item of discovered)
      results.push(await this.ingestOne(item, options));
    return results;
  }

  async ingestOne(item: DiscoveredDocument, options: IngestOptions) {
    const checksum = createHash('sha256').update(item.content).digest('hex');
    const sourceSystem = await this.prisma.corpusSourceSystem.upsert({
      where: { code: options.sourceCode },
      create: {
        code: options.sourceCode,
        name: options.sourceName,
        sourceType: options.sourceType ?? 'MANUAL',
      },
      update: {
        name: options.sourceName,
        sourceType: options.sourceType ?? 'MANUAL',
      },
    });
    const eventIdentity = item.externalId || item.sourcePath || item.filename;
    const idempotencyKey = createHash('sha256')
      .update(`${sourceSystem.id}\0${eventIdentity}\0${checksum}`)
      .digest('hex');
    const prior = await this.prisma.corpusIngestionRecord.findUnique({
      where: { idempotencyKey },
      include: { document: true },
    });
    if (prior)
      return {
        ingestionId: prior.id,
        documentId: prior.documentId,
        checksum,
        reused: true,
        status: prior.status,
      };

    const stored = await this.storage.put(item.filename, item.content);
    let documentId: string | undefined;
    if (item.externalId) {
      const priorVersion = await this.prisma.corpusIngestionRecord.findFirst({
        where: { sourceSystemId: sourceSystem.id, externalId: item.externalId },
        orderBy: { ingestedAt: 'desc' },
        select: { documentId: true },
      });
      documentId = priorVersion?.documentId;
    }

    const document = documentId
      ? await this.prisma.corpusDocument.update({
          where: { id: documentId },
          data: {
            title: item.title?.trim() || pathTitle(item.filename),
            subtitle: item.sourceReference,
            documentType: item.documentType ?? undefined,
            jurisdiction: item.jurisdiction ?? undefined,
            court: item.court ?? undefined,
            chamber: item.chamber ?? undefined,
            instance: item.instance ?? undefined,
            caseNumber: item.caseNumber ?? undefined,
            decisionDate: item.decisionDate ?? undefined,
            status: 'STORED',
            metadata: (item.metadata ?? undefined) as
              Prisma.InputJsonValue | undefined,
            metadataOriginal: (item.metadataOriginal ?? undefined) as
              Prisma.InputJsonValue | undefined,
            visibility: item.visibility ?? 'INTERNAL',
          },
        })
      : await this.prisma.corpusDocument.create({
          data: {
            title: item.title?.trim() || pathTitle(item.filename),
            subtitle: item.sourceReference,
            documentType: item.documentType ?? undefined,
            jurisdiction: item.jurisdiction ?? undefined,
            court: item.court ?? undefined,
            chamber: item.chamber ?? undefined,
            instance: item.instance ?? undefined,
            caseNumber: item.caseNumber ?? undefined,
            decisionDate: item.decisionDate ?? undefined,
            status: 'STORED',
            metadata: (item.metadata ?? undefined) as
              Prisma.InputJsonValue | undefined,
            metadataOriginal: (item.metadataOriginal ?? undefined) as
              Prisma.InputJsonValue | undefined,
            visibility: item.visibility ?? 'INTERNAL',
          },
        });

    const file = await this.prisma.corpusDocumentFile.upsert({
      where: {
        documentId_sha256: { documentId: document.id, sha256: checksum },
      },
      create: {
        documentId: document.id,
        storageKey: stored.storageKey,
        originalFilename: item.filename,
        mimeType: item.mimeType ?? mimeFor(item.filename),
        sizeBytes: BigInt(stored.sizeBytes),
        sha256: checksum,
        version: await this.nextVersion(document.id),
      },
      update: {
        storageKey: stored.storageKey,
        originalFilename: item.filename,
      },
    });

    const ingestion = await this.prisma.corpusIngestionRecord.create({
      data: {
        sourceSystemId: sourceSystem.id,
        documentId: document.id,
        fileId: file.id,
        externalId: item.externalId,
        externalUrl: item.externalUrl,
        sourceReference: item.sourceReference,
        obtainedAt: item.obtainedAt,
        checksum,
        idempotencyKey,
        originalFilename: item.filename,
        sourcePath: item.sourcePath,
        metadataOriginal: (item.metadataOriginal ?? undefined) as
          Prisma.InputJsonValue | undefined,
        status: 'STORED',
      },
    });

    const extractionStartedAt = Date.now();
    try {
      const extractedRaw = await this.extractor.extract(
        item.filename,
        file.mimeType,
        item.content,
      );
      const extracted = sanitizeExtraction(extractedRaw);
      const extractionDurationMs = Date.now() - extractionStartedAt;
      const extraction = await this.prisma.corpusExtraction.create({
        data: {
          documentId: document.id,
          fileId: file.id,
          extractor: extracted.extractor,
          extractorVersion: extracted.extractorVersion,
          status: extracted.status,
          text: extracted.text,
          ...(extracted.provenance
            ? { provenance: extracted.provenance as Prisma.InputJsonValue }
            : {}),
          pages: {
            create: extracted.pages.map((page) => ({
              pageNumber: page.pageNumber,
              text: page.text,
              textKind: 'NATIVE',
              processingStatus:
                extracted.formatDetected === 'PDF' &&
                extracted.ocrRequiredPages.includes(page.pageNumber)
                  ? 'OCR_REQUIRED'
                  : 'TEXT_NATIVE',
            })),
          },
        },
      });
      const metadata = item.metadata ?? {};
      const searchText = normalizeSearchText(
        [
          document.title,
          document.subtitle,
          document.court,
          document.chamber,
          document.caseNumber,
          document.docket,
          JSON.stringify(metadata),
          extracted.text,
        ]
          .filter(Boolean)
          .join(' '),
      );
      await this.prisma.$transaction([
        this.prisma.corpusDocument.update({
          where: { id: document.id },
          data: {
            status:
              extracted.status === 'OCR_REQUIRED' ? 'OCR_REQUIRED' : 'INDEXED',
            searchText,
            latestExtractionId: extraction.id,
          },
        }),
        this.prisma.corpusDocumentFile.update({
          where: { id: file.id },
          data: {
            pageCount: extracted.pages.length || null,
            mimeType: extracted.mimeDetected,
          },
        }),
        this.prisma.corpusIngestionRecord.update({
          where: { id: ingestion.id },
          data: {
            status:
              extracted.status === 'OCR_REQUIRED' ? 'OCR_REQUIRED' : 'INDEXED',
            metadataOriginal: withExtractionProvenance(
              item.metadataOriginal,
              extracted,
            ),
          },
        }),
      ]);
      return {
        ingestionId: ingestion.id,
        documentId: document.id,
        fileId: file.id,
        extractionId: extraction.id,
        checksum,
        reused: false,
        status:
          extracted.status === 'OCR_REQUIRED' ? 'OCR_REQUIRED' : 'INDEXED',
        pageCount: extracted.pages.length,
        characterCount: extracted.text.length,
        extractionDurationMs,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Error de extracción desconocido';
      const invalidPdf = error instanceof InvalidPdfError;
      await this.prisma.$transaction([
        this.prisma.corpusDocument.update({
          where: { id: document.id },
          data: { status: invalidPdf ? 'INVALID_PDF' : 'EXTRACTION_FAILED' },
        }),
        this.prisma.corpusIngestionRecord.update({
          where: { id: ingestion.id },
          data: {
            status: invalidPdf ? 'INVALID_PDF' : 'FAILED',
            errorStage: 'EXTRACT',
            errorMessage: message,
            errorAt: new Date(),
            retryable: !invalidPdf,
          },
        }),
        this.prisma.corpusExtraction.create({
          data: {
            documentId: document.id,
            fileId: file.id,
            extractor: 'unknown',
            extractorVersion: 'unknown',
            status: invalidPdf ? 'INVALID_PDF' : 'EXTRACTION_FAILED',
            error: message,
            errorStage: 'EXTRACT',
            errorAt: new Date(),
            retryable: !invalidPdf,
          },
        }),
      ]);
      if (invalidPdf) {
        return {
          ingestionId: ingestion.id,
          documentId: document.id,
          fileId: file.id,
          checksum,
          reused: false,
          status: 'INVALID_PDF',
          extractionDurationMs: Date.now() - extractionStartedAt,
        };
      }
      throw error;
    }
  }

  async linkExisting(
    item: DiscoveredDocument,
    options: IngestOptions,
  ): Promise<IngestionOutcome> {
    const checksum = createHash('sha256').update(item.content).digest('hex');
    const sourceSystem = await this.prisma.corpusSourceSystem.upsert({
      where: { code: options.sourceCode },
      create: {
        code: options.sourceCode,
        name: options.sourceName,
        sourceType: options.sourceType ?? 'MANUAL',
      },
      update: {
        name: options.sourceName,
        sourceType: options.sourceType ?? 'MANUAL',
      },
    });
    const eventIdentity = item.externalId || item.sourcePath || item.filename;
    const idempotencyKey = createHash('sha256')
      .update(`${sourceSystem.id}\0${eventIdentity}\0${checksum}`)
      .digest('hex');
    const prior = await this.prisma.corpusIngestionRecord.findUnique({
      where: { idempotencyKey },
      select: { id: true, documentId: true, status: true, fileId: true },
    });
    if (prior)
      return {
        ingestionId: prior.id,
        documentId: prior.documentId,
        fileId: prior.fileId ?? undefined,
        checksum,
        reused: true,
        status: prior.status,
      };

    const matchingFiles = await this.prisma.corpusDocumentFile.findMany({
      where: { sha256: checksum },
      include: { document: true },
      orderBy: { createdAt: 'asc' },
    });
    const matchingDocuments = new Set(
      matchingFiles.map((file) => file.documentId),
    );
    if (!matchingFiles.length)
      throw new Error('No existe un archivo Corpus con el SHA indicado.');
    if (matchingDocuments.size !== 1)
      throw new Error(
        'CORPUS_HASH_AMBIGUOUS: el SHA pertenece a varios documentos Corpus.',
      );
    const matchingFile = matchingFiles[0];
    const ingestion = await this.prisma.corpusIngestionRecord.create({
      data: {
        sourceSystemId: sourceSystem.id,
        documentId: matchingFile.documentId,
        fileId: matchingFile.id,
        externalId: item.externalId,
        externalUrl: item.externalUrl,
        sourceReference: item.sourceReference,
        obtainedAt: item.obtainedAt,
        checksum,
        idempotencyKey,
        originalFilename: item.filename,
        sourcePath: item.sourcePath,
        metadataOriginal: item.metadataOriginal as
          Prisma.InputJsonValue | undefined,
        status: matchingFile.document.status,
      },
    });
    return {
      ingestionId: ingestion.id,
      documentId: matchingFile.documentId,
      fileId: matchingFile.id,
      checksum,
      reused: true,
      status: matchingFile.document.status,
    };
  }

  async retryExtraction(documentId: string) {
    const document = await this.prisma.corpusDocument.findUnique({
      where: { id: documentId },
      include: { files: { orderBy: { version: 'desc' }, take: 1 } },
    });
    const file = document?.files[0];
    if (!document || !file)
      throw new Error('Documento o archivo no encontrado para reintento.');
    const content = await this.storage.get(file.storageKey);
    const extractionStartedAt = Date.now();
    const extractedRaw = await this.extractor.extract(
      file.originalFilename,
      file.mimeType,
      content,
    );
    const extracted = sanitizeExtraction(extractedRaw);
    const priorIngestions = await this.prisma.corpusIngestionRecord.findMany({
      where: { documentId },
      select: { id: true, metadataOriginal: true },
    });
    const extraction = await this.prisma.corpusExtraction.create({
      data: {
        documentId,
        fileId: file.id,
        extractor: extracted.extractor,
        extractorVersion: extracted.extractorVersion,
        status: extracted.status,
        text: extracted.text,
        ...(extracted.provenance
          ? { provenance: extracted.provenance as Prisma.InputJsonValue }
          : {}),
        pages: {
          create: extracted.pages.map((page) => ({
            pageNumber: page.pageNumber,
            text: page.text,
            textKind: 'NATIVE',
            processingStatus:
              extracted.formatDetected === 'PDF' &&
              extracted.ocrRequiredPages.includes(page.pageNumber)
                ? 'OCR_REQUIRED'
                : 'TEXT_NATIVE',
          })),
        },
      },
    });
    await this.prisma.$transaction([
      this.prisma.corpusDocument.update({
        where: { id: documentId },
        data: {
          status:
            extracted.status === 'OCR_REQUIRED' ? 'OCR_REQUIRED' : 'INDEXED',
          searchText: normalizeSearchText(
            [
              document.title,
              document.subtitle,
              document.court,
              document.chamber,
              document.caseNumber,
              document.docket,
              JSON.stringify(document.metadata ?? {}),
              extracted.text,
            ]
              .filter(Boolean)
              .join(' '),
          ),
          latestExtractionId: extraction.id,
        },
      }),
      ...priorIngestions.map((ingestion) =>
        this.prisma.corpusIngestionRecord.update({
          where: { id: ingestion.id },
          data: {
            status:
              extracted.status === 'OCR_REQUIRED' ? 'OCR_REQUIRED' : 'INDEXED',
            errorStage: null,
            errorMessage: null,
            errorAt: null,
            retryable: false,
            metadataOriginal: withExtractionProvenance(
              ingestion.metadataOriginal,
              extracted,
            ),
          },
        }),
      ),
    ]);
    return {
      extractionId: extraction.id,
      documentId,
      status: extracted.status,
      extractionDurationMs: Date.now() - extractionStartedAt,
    };
  }

  private async nextVersion(documentId: string) {
    const latest = await this.prisma.corpusDocumentFile.findFirst({
      where: { documentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (latest?.version ?? 0) + 1;
  }
}

function pathTitle(filename: string) {
  return filename.replace(/\.[^.]+$/u, '');
}
function mimeFor(filename: string) {
  return filename.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : 'text/plain';
}

function withExtractionProvenance(
  original: unknown,
  extracted: ExtractionResult,
) {
  const base =
    typeof original === 'object' &&
    original !== null &&
    !Array.isArray(original)
      ? (original as Prisma.InputJsonObject)
      : original === undefined || original === null
        ? {}
        : { sourceMetadata: original as Prisma.InputJsonValue };
  return {
    ...base,
    extractionProvenance: extractionProvenance(extracted),
  } as Prisma.InputJsonObject;
}

export function sanitizeExtraction<
  T extends { text: string; pages: Array<{ text: string }> },
>(extracted: T): T {
  return {
    ...extracted,
    text: extracted.text.replaceAll('\u0000', ''),
    pages: extracted.pages.map((page) => ({
      ...page,
      text: page.text.replaceAll('\u0000', ''),
    })),
  };
}

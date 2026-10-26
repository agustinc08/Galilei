import { resolve as resolvePath } from 'node:path';
import type { ArchivoPdf } from '../generated/prisma/client';
import { LocalDocumentStorageAdapter } from '../corpus/document-storage.adapter';
import { obtenerPdfsReales } from '../archivos/pdf-real.util';
import type { PrismaService } from '../prisma/prisma.service';

export type SentencePdfReference = Pick<ArchivoPdf, 'id' | 'rutaArchivo'>;

/**
 * Returns page text only when the latest general Corpus extraction is backed
 * by the exact physical PDF used by the sentence viewer. Ambiguous or stale
 * sources fail closed.
 */
export async function findLinkedCorpusTextSource(
  prisma: PrismaService,
  sentenceId: number,
  sentencePdfs: SentencePdfReference[],
) {
  const primaryPdf = obtenerPdfsReales(sentencePdfs)[0];
  if (!primaryPdf?.rutaArchivo) return null;

  const storage = new LocalDocumentStorageAdapter();
  const viewerPath = resolvePath(primaryPdf.rutaArchivo);
  const links = await prisma.corpusDocumentLink.findMany({
    where: {
      targetDomain: 'JURISPRUDENCIA',
      targetType: 'SENTENCIA',
      targetId: String(sentenceId),
      relationship: 'ASSOCIATED_WITH',
    },
    select: {
      document: {
        select: {
          documentScope: true,
          latestExtraction: {
            select: {
              id: true,
              status: true,
              extractor: true,
              extractorVersion: true,
              extractedAt: true,
              file: {
                select: { sha256: true, storageKey: true, pageCount: true },
              },
              pages: {
                orderBy: { pageNumber: 'asc' },
                select: {
                  pageNumber: true,
                  text: true,
                  textKind: true,
                  processingStatus: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const sources = links.flatMap(({ document }) => {
    const extraction = document.latestExtraction;
    if (
      document.documentScope !== 'GENERAL' ||
      !extraction ||
      resolvePath(storage.root, extraction.file.storageKey) !== viewerPath
    ) {
      return [];
    }
    return [extraction];
  });
  const uniqueSources = [
    ...new Map(sources.map((source) => [source.file.sha256, source])).values(),
  ];
  return uniqueSources.length === 1 ? uniqueSources[0] : null;
}

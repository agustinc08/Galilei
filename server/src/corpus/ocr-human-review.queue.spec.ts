import type { CorpusDocumentAccessService } from './corpus-document-access.service';
import type { LocalPdfOcrProcessor } from './document-local-processors';
import type { PrismaService } from '../prisma/prisma.service';
import { OcrHumanReviewService } from './ocr-human-review.service';

describe('OcrHumanReviewService queue OCR summary', () => {
  it('exposes run state and page counts without returning recognized text', async () => {
    const document = {
      id: 'ocr-queue-document',
      title: 'Documento de prueba',
      court: null,
      chamber: null,
      caseNumber: null,
      decisionDate: null,
      updatedAt: new Date('2026-10-29T12:00:00.000Z'),
      files: [
        {
          id: 'ocr-queue-file',
          originalFilename: 'documento.pdf',
          pageCount: 7,
          sha256: 'a'.repeat(64),
        },
      ],
      latestExtraction: null,
      ocrReviews: [
        {
          id: 'ocr-queue-review',
          status: 'IN_REVIEW',
          assignedToId: 12,
          version: 2,
          activeApprovalId: null,
          activeRun: {
            status: 'COMPLETE',
            pageCount: 7,
            pages: Array.from({ length: 7 }, () => ({
              status: 'NEEDS_REVIEW',
            })),
          },
        },
      ],
    };
    const corpusDocument = {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([document]),
    };
    const prisma = { corpusDocument } as unknown as PrismaService;
    const service = new OcrHumanReviewService(
      prisma,
      {} as LocalPdfOcrProcessor,
      {} as CorpusDocumentAccessService,
    );

    const queue = await service.queue('all', 1, 25, 9);
    const [item] = queue.results;

    expect(item).toMatchObject({
      status: 'IN_REVIEW',
      hasApprovedVersion: false,
      approvedPages: 0,
      ocrRun: {
        status: 'COMPLETE',
        generatedPageCount: 7,
        pageCount: 7,
      },
    });
    expect(JSON.stringify(item)).not.toContain('ocrText');
    expect(JSON.stringify(item)).not.toContain('NEEDS_REVIEW');
  });
});

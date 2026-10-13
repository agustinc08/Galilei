import { BadRequestException } from '@nestjs/common';
import { CorpusCurationService } from './corpus-curation.service';

describe('CorpusCurationService', () => {
  it('rejects unknown association decisions before touching the database', async () => {
    const prisma = {} as never;
    const service = new CorpusCurationService(prisma);
    await expect(service.reviewAssociation('association-1', 'PENDING' as never, 1, false)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('limits classification batch decisions to twenty rows', async () => {
    const prisma = {} as never;
    const service = new CorpusCurationService(prisma);
    await expect(service.batchClassifications(Array.from({ length: 21 }, (_, index) => `classification-${index}`), 'APPROVED', 1, false)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires an approved link to an existing sentence before selection', async () => {
    const prisma = {
      corpusDocument: { findFirst: jest.fn().mockResolvedValue({ id: 'doc-1', editorialStatus: 'REVIEW_PENDING', metadata: null }) },
      corpusDocumentLink: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new CorpusCurationService(prisma as never);
    await expect(service.setJurisprudence('doc-1', 'SELECTED', 'CASO_NOVEDOSO', undefined, 1, false)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.corpusDocumentLink.findFirst).toHaveBeenCalledTimes(1);
  });
});

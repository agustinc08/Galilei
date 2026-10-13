import { CorpusDocumentAccessService, safeContentDisposition, singleByteRange } from './corpus-document-access.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('Corpus document access helpers', () => {
  it('parses full, explicit, and suffix ranges and rejects multiple or invalid ranges', () => {
    expect(singleByteRange(undefined, 10)).toEqual({ status: 200, start: 0, end: 9 });
    expect(singleByteRange('bytes=2-5', 10)).toEqual({ status: 206, start: 2, end: 5 });
    expect(singleByteRange('bytes=-3', 10)).toEqual({ status: 206, start: 7, end: 9 });
    expect(singleByteRange('bytes=4-', 10)).toEqual({ status: 206, start: 4, end: 9 });
    expect(singleByteRange('bytes=0-1,4-5', 10).status).toBe(416);
    expect(singleByteRange('bytes=10-11', 10).status).toBe(416);
  });

  it('sanitizes inline and attachment filenames against header injection', () => {
    expect(safeContentDisposition('../../sentencia\r\nX-Evil: yes.pdf', true)).toBe("inline; filename=\"sentenciaX-Evil_ yes.pdf\"; filename*=UTF-8''sentenciaX-Evil_%20yes.pdf");
    expect(safeContentDisposition('archivo.pdf', false).startsWith('attachment;')).toBe(true);
  });

  it('filters documents by visibility before returning metadata', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = { corpusDocument: { findFirst } } as unknown as PrismaService;
    const service = new CorpusDocumentAccessService(prisma);
    await expect(service.metadata('secret-id', 'PUBLIC')).rejects.toMatchObject({ status: 404 });
    expect(findFirst.mock.calls[0][0].where.visibility).toEqual({ in: ['PUBLIC'] });
    await expect(service.metadata('internal-id', 'INTERNAL')).rejects.toMatchObject({ status: 404 });
    expect(findFirst.mock.calls[1][0].where.visibility).toEqual({ in: ['PUBLIC', 'INTERNAL'] });
    await expect(service.metadata('restricted-id', 'ADMIN')).rejects.toMatchObject({ status: 404 });
    expect(findFirst.mock.calls[2][0].where.visibility).toEqual({ in: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] });
  });
});

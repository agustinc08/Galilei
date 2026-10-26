import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { ResearchRelationshipsService } from './research-relationships.service';

function serviceWith(overrides: Record<string, unknown> = {}) {
  const prisma = {
    sentencia: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    sentenciaRelationshipCandidate: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    ...overrides,
  };
  return {
    service: new ResearchRelationshipsService(
      prisma as unknown as PrismaService,
    ),
    prisma,
  };
}

describe('ResearchRelationshipsService', () => {
  it('extracts idempotent review candidates from explicit references, without auto-verifying them', async () => {
    const { service, prisma } = serviceWith();
    prisma.sentencia.findUnique.mockResolvedValue({
      id: 1,
      expediente: 'CIV 1234/2020',
      numeroSentencia: '88/2022',
      referenciasJurisprudenciales: [
        {
          referencia:
            'Expte. CIV 1234/2020; Expte. 987/2021; Sentencia 88/2022',
          textoOriginal: null,
          falloRelacionadoId: null,
        },
      ],
      citasFallo: [],
    });
    prisma.sentencia.findMany.mockResolvedValue([{ id: 2 }]);
    prisma.sentenciaRelationshipCandidate.createMany.mockResolvedValue({
      count: 1,
    });
    prisma.sentenciaRelationshipCandidate.findMany.mockResolvedValue([
      { id: 4, status: 'DETECTED_CANDIDATE' },
    ]);

    const result = await service.extractForSentence(1);

    expect(result.data.created).toBe(1);
    expect(
      prisma.sentenciaRelationshipCandidate.createMany,
    ).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sourceSentenceId: 1,
          targetSentenceId: 2,
          normalizedIdentifier: '987/2021',
          status: 'DETECTED_CANDIDATE',
          confidence: null,
          page: null,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('requires a published target before a candidate can be verified', async () => {
    const { service, prisma } = serviceWith();
    prisma.sentenciaRelationshipCandidate.findFirst.mockResolvedValue({
      id: 4,
      sourceSentenceId: 1,
      targetSentenceId: null,
    });

    await expect(
      service.reviewCandidate(4, 7, { status: 'VERIFIED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      prisma.sentenciaRelationshipCandidate.updateMany,
    ).not.toHaveBeenCalled();

    prisma.sentencia.findFirst.mockResolvedValue(null);
    await expect(
      service.reviewCandidate(4, 7, {
        status: 'VERIFIED',
        targetSentenceId: 2,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.sentencia.findFirst).toHaveBeenCalledWith({
      where: { id: 2, publicado: true, activo: true },
      select: { id: true },
    });
  });

  it('requires both ends of a public relationship to be published and active', async () => {
    const { service, prisma } = serviceWith();
    prisma.sentencia.findFirst.mockResolvedValue({ id: 10 });
    prisma.sentenciaRelationshipCandidate.findMany.mockResolvedValue([]);

    await service.findPublicVerifiedRelationships('public-slug');

    const call = prisma.sentenciaRelationshipCandidate.findMany.mock
      .calls[0] as unknown as [{ where: Record<string, unknown> }];
    expect(call[0].where).toMatchObject({
      status: 'VERIFIED',
      sourceSentence: { is: { publicado: true, activo: true } },
      targetSentence: { is: { publicado: true, activo: true } },
    });
  });
});

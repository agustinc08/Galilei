import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { ResearchCollectionsService } from './research-collections.service';

describe('ResearchCollectionsService', () => {
  const makeService = (overrides: Record<string, unknown> = {}) => {
    const prisma = {
      researchCollection: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      researchCollectionItem: {
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
      sentencia: { findFirst: jest.fn() },
      ...overrides,
    };
    return {
      service: new ResearchCollectionsService(
        prisma as unknown as PrismaService,
      ),
      prisma,
    };
  };

  it('searches private notes or public judgment metadata while excluding unpublished judgments', async () => {
    const { service, prisma } = makeService();
    prisma.researchCollection.findFirst.mockResolvedValue({
      id: 10,
      nombre: 'RC',
    });
    prisma.researchCollectionItem.count.mockResolvedValue(1);
    prisma.researchCollectionItem.findMany.mockResolvedValue([]);

    await service.findOne(7, 10, { q: 'considerando', page: 1, pageSize: 25 });

    type CapturedWhere = {
      collectionId: number;
      sentencia: { is: { publicado: boolean; activo: boolean } };
      OR: Array<{
        nota?: { contains: string; mode: string };
        sentencia?: {
          is: { publicado: boolean; activo: boolean; OR: unknown[] };
        };
      }>;
    };
    const call = prisma.researchCollectionItem.findMany.mock
      .calls[0] as unknown as [{ where: CapturedWhere }];
    const where = call[0].where;
    expect(where.collectionId).toBe(10);
    expect(where.sentencia.is).toEqual({ publicado: true, activo: true });
    expect(where.OR[0]).toEqual({
      nota: { contains: 'considerando', mode: 'insensitive' },
    });
    expect(where.OR[1]?.sentencia?.is).toMatchObject({
      publicado: true,
      activo: true,
    });
    expect(where.OR[1]?.sentencia?.is.OR.length).toBeGreaterThan(0);
  });

  it('does not reveal another owner collection', async () => {
    const { service, prisma } = makeService();
    prisma.researchCollection.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne(8, 10, { page: 1, pageSize: 25 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.researchCollectionItem.findMany).not.toHaveBeenCalled();
  });

  it('rejects unpublished or missing judgments before adding a reference', async () => {
    const { service, prisma } = makeService();
    prisma.researchCollection.findFirst.mockResolvedValue({ id: 10 });
    prisma.sentencia.findFirst.mockResolvedValue(null);

    await expect(service.addJudgment(7, 10, 25)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.sentencia.findFirst).toHaveBeenCalledWith({
      where: { id: 25, publicado: true, activo: true },
      select: { id: true },
    });
    expect(prisma.researchCollectionItem.create).not.toHaveBeenCalled();
  });

  it('normalizes collection names and maps duplicate names to a conflict', async () => {
    const { service, prisma } = makeService();
    prisma.researchCollection.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.create(7, { nombre: '  Daño   Moral ' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.researchCollection.create).toHaveBeenCalledWith({
      data: {
        usuarioId: 7,
        nombre: '  Daño   Moral ',
        nombreNormalizado: 'daño moral',
      },
    });
  });

  it('makes a duplicate collection item idempotent after a concurrent insert', async () => {
    const { service, prisma } = makeService();
    prisma.researchCollection.findFirst.mockResolvedValue({ id: 10 });
    prisma.sentencia.findFirst.mockResolvedValue({ id: 25 });
    prisma.researchCollectionItem.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    prisma.researchCollectionItem.findUnique.mockResolvedValue({
      id: 99,
      collectionId: 10,
      sentenciaId: 25,
    });

    const result = await service.addJudgment(7, 10, 25);

    expect(result).toMatchObject({ added: false, data: { id: 99 } });
    expect(prisma.researchCollectionItem.findUnique).toHaveBeenCalledWith({
      where: {
        collectionId_sentenciaId: { collectionId: 10, sentenciaId: 25 },
      },
    });
  });

  it('scopes note updates to the collection owner and stores an empty note as null', async () => {
    const { service, prisma } = makeService();
    prisma.researchCollectionItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.researchCollectionItem.findFirst.mockResolvedValue({
      id: 99,
      nota: null,
    });

    await service.updateNote(7, 10, 99, { nota: '   ' });

    expect(prisma.researchCollectionItem.updateMany).toHaveBeenCalledWith({
      where: { id: 99, collectionId: 10, collection: { is: { usuarioId: 7 } } },
      data: { nota: null },
    });
  });
});

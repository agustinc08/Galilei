import { NotFoundException } from '@nestjs/common';
import type { CatalogosService } from '../catalogos/catalogos.service';
import type { EventosConsultaService } from '../estadisticas/eventos-consulta.service';
import type { LogsService } from '../logs/logs.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SentenciasService } from './sentencias.service';

function createService() {
  const prisma = {
    sentencia: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
  return {
    prisma,
    service: new SentenciasService(
      prisma as unknown as PrismaService,
      {} as CatalogosService,
      { trackSafe: jest.fn() } as unknown as EventosConsultaService,
      {} as LogsService,
    ),
  };
}

describe('public same-expediente decisions', () => {
  it('requires a public active source and returns stable exact docket matches', async () => {
    const { service, prisma } = createService();
    prisma.sentencia.findFirst.mockResolvedValue({
      id: 1,
      expediente: 'CIV 123 / 2020',
    });
    prisma.sentencia.count.mockResolvedValue(1);
    prisma.sentencia.findMany.mockResolvedValue([
      {
        id: 2,
        slugPublico: 'same-docket',
        expediente: 'CIV 123-2020',
        caratula: 'Mismo expediente',
        numeroSentencia: '2/2026',
        sala: 'A',
        fecha: new Date('2026-05-01T00:00:00.000Z'),
        tipoFallo: 'Sentencia',
      },
    ]);

    const result = await service.findPublicSameExpediente('source', 10);

    expect(result).toMatchObject({ total: 1, limit: 10, hasMore: false });
    expect(result.data).toHaveLength(1);
    expect(prisma.sentencia.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          publicado: true,
          activo: true,
          OR: [{ slugPublico: 'source' }],
        }) as unknown,
      }),
    );
    expect(prisma.sentencia.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: 1 },
          publicado: true,
          activo: true,
          expediente: expect.objectContaining({
            mode: 'insensitive',
          }) as unknown,
        }) as unknown,
        take: 11,
      }),
    );
  });

  it('does not infer a relation for missing expediente or a private source', async () => {
    const { service, prisma } = createService();
    prisma.sentencia.findFirst.mockResolvedValueOnce({
      id: 1,
      expediente: null,
    });
    await expect(
      service.findPublicSameExpediente('source'),
    ).resolves.toMatchObject({
      data: [],
      total: 0,
      hasMore: false,
    });
    expect(prisma.sentencia.count).not.toHaveBeenCalled();

    prisma.sentencia.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.findPublicSameExpediente('private'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('caps the requested limit at twenty', async () => {
    const { service, prisma } = createService();
    prisma.sentencia.findFirst.mockResolvedValue({
      id: 1,
      expediente: '123/2020',
    });
    prisma.sentencia.count.mockResolvedValue(30);
    prisma.sentencia.findMany.mockResolvedValue([]);
    await service.findPublicSameExpediente('source', 1000);
    expect(prisma.sentencia.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 21 }),
    );
  });
});

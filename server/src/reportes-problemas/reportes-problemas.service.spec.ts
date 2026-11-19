import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { ReportesProblemasService } from './reportes-problemas.service';

describe('ReportesProblemasService', () => {
  const makeService = () => {
    const prisma = {
      reporteProblema: {
        count: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const tx = {
      ...prisma,
      accionLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    prisma.$transaction.mockImplementation(
      async (
        callback: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => callback(tx as unknown as Prisma.TransactionClient),
    );
    return {
      service: new ReportesProblemasService(prisma as unknown as PrismaService),
      prisma,
      tx,
    };
  };

  const createDto = {
    tipo: 'ERROR' as const,
    descripcion: 'La pantalla no carga después de confirmar la búsqueda.',
    ruta: '/busqueda',
    accion: 'Abrir los resultados',
    errorId: 'E-123',
  };

  it('stores only user-supplied report details and derives safe context', async () => {
    const { service, prisma, tx } = makeService();
    prisma.reporteProblema.count.mockResolvedValue(0);
    prisma.reporteProblema.create.mockResolvedValue({
      id: 12,
      tipo: 'ERROR',
      ruta: '/busqueda',
      modulo: 'Jurisprudencia',
      estado: 'NUEVO',
      prioridad: 'P3',
      createdAt: new Date('2026-11-19T12:00:00Z'),
    });

    const result = await service.create(7, createDto);

    expect(result.data.id).toBe(12);
    expect(prisma.reporteProblema.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          usuarioId: 7,
          tipo: 'ERROR',
          ruta: '/busqueda',
          modulo: 'Jurisprudencia',
          errorId: 'E-123',
        }) as unknown,
      }),
    );
    const createCall = prisma.reporteProblema.create.mock
      .calls[0] as unknown as [{ data: Record<string, unknown> }];
    const stored = createCall[0].data;
    expect(stored).not.toHaveProperty('token');
    expect(stored).not.toHaveProperty('screenshot');
    expect(stored.version).toEqual(expect.any(String));
    expect(tx.accionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          usuarioId: 7,
          entidad: 'ReporteProblema',
          accion: 'REPORT_CREATE',
        }) as unknown,
      }),
    );
  });

  it('rate-limits repeat submissions from the same user', async () => {
    const { service, prisma } = makeService();
    prisma.reporteProblema.count.mockResolvedValue(5);

    await expect(service.create(7, createDto)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    } satisfies Partial<HttpException>);
    expect(prisma.reporteProblema.create).not.toHaveBeenCalled();
  });

  it('paginates and filters administrative reports', async () => {
    const { service, prisma } = makeService();
    prisma.reporteProblema.count.mockResolvedValue(25);
    prisma.reporteProblema.findMany.mockResolvedValue([]);

    const result = await service.findAll({
      estado: 'NUEVO',
      prioridad: 'P1',
      page: 2,
      pageSize: 10,
    });

    expect(result.meta).toEqual({
      total: 25,
      page: 2,
      pageSize: 10,
      pageCount: 3,
    });
    expect(prisma.reporteProblema.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { estado: 'NUEVO', prioridad: 'P1' },
        skip: 10,
        take: 10,
      }),
    );
  });

  it('rejects invalid duplicate links and links only to an earlier original', async () => {
    const { service, prisma } = makeService();
    prisma.reporteProblema.findUnique
      .mockResolvedValueOnce({
        id: 15,
        estado: 'NUEVO',
        prioridad: 'P3',
        duplicadoDeId: null,
      })
      .mockResolvedValueOnce({
        id: 15,
        estado: 'NUEVO',
        prioridad: 'P3',
        duplicadoDeId: null,
      })
      .mockResolvedValueOnce({ id: 14, duplicadoDeId: null });
    prisma.reporteProblema.update.mockResolvedValue({
      id: 15,
      duplicadoDeId: 14,
    });

    await expect(
      service.update(15, 9, { duplicadoDeId: 15 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.reporteProblema.update).not.toHaveBeenCalled();

    await service.update(15, 9, { duplicadoDeId: 14 });
    expect(prisma.reporteProblema.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 15 },
        data: { duplicadoDeId: 14 },
      }),
    );
  });
});

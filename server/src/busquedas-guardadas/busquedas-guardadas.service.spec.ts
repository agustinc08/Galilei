import type { PrismaService } from '../prisma/prisma.service';
import type { BusquedaService } from '../busqueda/busqueda.service';
import { NotFoundException } from '@nestjs/common';
import { BusquedasGuardadasService } from './busquedas-guardadas.service';

describe('BusquedasGuardadasService novelties', () => {
  const makeService = () => {
    const prisma = {
      busquedaGuardada: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      sentencia: { findMany: jest.fn() },
    };
    const busquedaService = { federatedSearch: jest.fn() };
    return {
      service: new BusquedasGuardadasService(
        prisma as unknown as PrismaService,
        busquedaService as unknown as BusquedaService,
      ),
      prisma,
      busquedaService,
    };
  };

  it('sets a first-use baseline instead of reporting the historical corpus', async () => {
    const { service, prisma, busquedaService } = makeService();
    prisma.busquedaGuardada.findFirst.mockResolvedValue({
      id: 4,
      usuarioId: 7,
      queryJson: {
        kind: 'consulta-publica',
        version: 1,
        state: { q: 'civil' },
      },
      lastViewedAt: null,
      lastEvaluatedAt: null,
      lastNewCount: 0,
    });
    prisma.busquedaGuardada.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.findNovelties(7, 4, { page: 1, pageSize: 25 });

    expect(result.data).toEqual([]);
    expect(result.meta).toMatchObject({ total: 0, baselineEstablished: true });
    expect(prisma.busquedaGuardada.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 4, usuarioId: 7, lastViewedAt: null },
        data: expect.objectContaining({ lastNewCount: 0 }) as unknown,
      }),
    );
    expect(busquedaService.federatedSearch).not.toHaveBeenCalled();
  });

  it('reuses COPERNIC search with publication-time candidate ids and saved filters', async () => {
    const { service, prisma, busquedaService } = makeService();
    const lastViewedAt = new Date('2026-01-01T00:00:00.000Z');
    const savedSearch = {
      id: 4,
      usuarioId: 7,
      queryJson: {
        kind: 'consulta-publica',
        version: 1,
        state: {
          q: '"responsabilidad civil"',
          fraseExacta: 'responsabilidad civil',
          sala: 'A',
          salas: ['H', 'Sala H'],
          buscarEn: 'todo',
          sortBy: 'relevancia',
        },
      },
      lastViewedAt,
      lastEvaluatedAt: lastViewedAt,
      lastNewCount: 0,
    };
    prisma.busquedaGuardada.findFirst.mockResolvedValue(savedSearch);
    prisma.sentencia.findMany
      .mockResolvedValueOnce([{ id: 23 }, { id: 29 }])
      .mockResolvedValueOnce([
        {
          id: 23,
          slugPublico: 'sentencia-23',
          caratula: 'Responsabilidad civil',
          numeroSentencia: '23/2026',
          sala: 'A',
          fecha: new Date('2019-04-03T00:00:00.000Z'),
          expediente: '108/2019',
          tipoFallo: 'Sentencia',
        },
      ]);
    prisma.busquedaGuardada.updateMany.mockResolvedValue({ count: 1 });
    busquedaService.federatedSearch.mockResolvedValue({
      total: 1,
      totalExact: true,
      hasMore: false,
      results: [
        {
          sourceId: 'SENTENCIA:23',
          metadata: { sentenciaId: 23 },
        },
      ],
    });

    const result = await service.findNovelties(7, 4, { page: 1, pageSize: 25 });

    expect(result.data).toMatchObject([
      {
        id: 23,
        expediente: '108/2019',
        fecha: new Date('2019-04-03T00:00:00.000Z'),
      },
    ]);
    expect(result.meta).toMatchObject({ total: 1, baselineEstablished: false });
    expect(prisma.sentencia.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          publicado: true,
          activo: true,
          publishedAt: {
            gt: lastViewedAt,
            lte: expect.any(Date) as unknown,
          },
        },
        select: { id: true },
      }),
    );
    expect(busquedaService.federatedSearch).toHaveBeenCalledWith(
      '"responsabilidad civil"',
      'AND',
      expect.objectContaining({
        visibility: 'PUBLIC',
        publicationPolicy: 'published-active-only',
        sourceSystems: ['JURISPRUDENCIA'],
        documentKinds: ['SENTENCIA'],
        filters: expect.objectContaining({
          exactPhrase: 'responsabilidad civil',
          sala: 'A',
          salas: ['H', 'Sala H'],
          sentenceIds: [23, 29],
        }) as unknown,
      }),
    );
    expect(prisma.busquedaGuardada.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastNewCount: 1 }) as unknown,
      }),
    );
  });

  it('returns the exact multiple-result Search count with only the requested page', async () => {
    const { service, prisma, busquedaService } = makeService();
    const lastViewedAt = new Date('2026-01-01T00:00:00.000Z');
    prisma.busquedaGuardada.findFirst.mockResolvedValue({
      id: 4,
      usuarioId: 7,
      queryJson: {
        kind: 'consulta-publica',
        version: 1,
        state: { q: 'civil' },
      },
      lastViewedAt,
      lastEvaluatedAt: lastViewedAt,
      lastNewCount: 0,
    });
    prisma.sentencia.findMany
      .mockResolvedValueOnce([{ id: 23 }, { id: 29 }])
      .mockResolvedValueOnce([
        {
          id: 23,
          slugPublico: 'sentencia-23',
          caratula: 'Fallo 23',
          numeroSentencia: '23/2026',
          sala: 'A',
          fecha: new Date('2019-04-03T00:00:00.000Z'),
          expediente: '23/2019',
          tipoFallo: 'Sentencia',
        },
      ]);
    prisma.busquedaGuardada.updateMany.mockResolvedValue({ count: 1 });
    busquedaService.federatedSearch.mockResolvedValue({
      total: 2,
      totalExact: true,
      hasMore: true,
      results: [{ sourceId: 'SENTENCIA:23', metadata: { sentenciaId: 23 } }],
    });

    const result = await service.findNovelties(7, 4, { page: 1, pageSize: 1 });

    expect(result.meta).toMatchObject({ total: 2, hasMore: true, pageSize: 1 });
    expect(result.data).toHaveLength(1);
    expect(busquedaService.federatedSearch).toHaveBeenCalledWith(
      'civil',
      'AND',
      expect.objectContaining({
        page: 1,
        pageSize: 1,
        filters: expect.objectContaining({ sentenceIds: [23, 29] }) as unknown,
      }),
    );
  });

  it('does not reveal a saved search owned by another user', async () => {
    const { service, prisma } = makeService();
    prisma.busquedaGuardada.findFirst.mockResolvedValue(null);

    await expect(
      service.findNovelties(8, 4, { page: 1, pageSize: 25 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.sentencia.findMany).not.toHaveBeenCalled();
  });

  it('does not advance last viewed after a failed Search request', async () => {
    const { service, prisma, busquedaService } = makeService();
    prisma.busquedaGuardada.findFirst.mockResolvedValue({
      id: 4,
      usuarioId: 7,
      queryJson: {
        kind: 'consulta-publica',
        version: 1,
        state: { q: 'civil' },
      },
      lastViewedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastEvaluatedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastNewCount: 1,
    });
    prisma.sentencia.findMany.mockResolvedValue([{ id: 23 }]);
    busquedaService.federatedSearch.mockRejectedValue(
      new Error('search offline'),
    );

    await expect(
      service.findNovelties(7, 4, { page: 1, pageSize: 25 }),
    ).rejects.toThrow();
    expect(prisma.busquedaGuardada.updateMany).not.toHaveBeenCalled();
  });

  it('only advances the viewed watermark through a successfully evaluated snapshot', async () => {
    const { service, prisma } = makeService();
    const lastViewedAt = new Date('2026-01-01T00:00:00.000Z');
    const lastEvaluatedAt = new Date('2026-02-01T00:00:00.000Z');
    prisma.busquedaGuardada.findFirst.mockResolvedValue({
      id: 4,
      usuarioId: 7,
      queryJson: { q: 'civil' },
      lastViewedAt,
      lastEvaluatedAt,
      lastNewCount: 2,
    });
    prisma.busquedaGuardada.updateMany.mockResolvedValue({ count: 1 });

    await service.markNoveltiesViewed(7, 4, {
      viewedThrough: lastEvaluatedAt.toISOString(),
    });

    expect(prisma.busquedaGuardada.updateMany).toHaveBeenCalledWith({
      where: { id: 4, usuarioId: 7, lastViewedAt, lastEvaluatedAt },
      data: {
        lastViewedAt: lastEvaluatedAt,
        lastEvaluatedAt,
        lastNewCount: 0,
      },
    });
  });

  it('rejects a viewed watermark beyond the last successful evaluation', async () => {
    const { service, prisma } = makeService();
    const lastViewedAt = new Date('2026-01-01T00:00:00.000Z');
    prisma.busquedaGuardada.findFirst.mockResolvedValue({
      id: 4,
      usuarioId: 7,
      queryJson: { q: 'civil' },
      lastViewedAt,
      lastEvaluatedAt: new Date('2026-02-01T00:00:00.000Z'),
      lastNewCount: 2,
    });

    await expect(
      service.markNoveltiesViewed(7, 4, {
        viewedThrough: '2026-02-02T00:00:00.000Z',
      }),
    ).rejects.toThrow('El corte de novedades ya no es válido.');
    expect(prisma.busquedaGuardada.updateMany).not.toHaveBeenCalled();
  });

  it('creates new saved searches with a baseline immediately', async () => {
    const { service, prisma } = makeService();
    await service.create(7, { nombre: 'Civil', queryJson: { q: 'civil' } });

    const call = prisma.busquedaGuardada.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(call[0].data.lastViewedAt).toBeInstanceOf(Date);
    expect(call[0].data.lastNewCount).toBe(0);
  });
});

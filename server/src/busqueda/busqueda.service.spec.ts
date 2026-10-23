import { BusquedaService } from './busqueda.service';

describe('BusquedaService search query workload', () => {
  const makeService = () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 5 }]),
      sentencia: {
        count: jest.fn().mockResolvedValue(12),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const eventos = { trackSafe: jest.fn() };
    const rag = { buscarFallosSimilares: jest.fn().mockResolvedValue([]) };
    const institutos = { expandTerms: jest.fn().mockResolvedValue([]) };
    return {
      service: new BusquedaService(prisma as never, eventos as never, rag as never, institutos as never),
      prisma,
    };
  };

  it('does not run the unused exact count for a text search', async () => {
    const { service, prisma } = makeService();
    const result = await service.avanzada({ q: 'responsabilidad', page: 1, pageSize: 10 } as never);

    expect(prisma.sentencia.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.sentencia.findMany.mock.calls[0][0].where.AND[1].id.in).toEqual([5]);
    const candidateQuery = prisma.$queryRaw.mock.calls[0][0] as { sql?: string; text?: string };
    expect(`${candidateQuery.sql ?? ''}${candidateQuery.text ?? ''}`).toContain('t."textoBusquedaNormalizado" LIKE');
    expect(`${candidateQuery.sql ?? ''}${candidateQuery.text ?? ''}`).not.toContain('regexp_replace(translate(lower(coalesce(t."textoBusquedaNormalizado"');
    expect(prisma.sentencia.count).not.toHaveBeenCalled();
    expect(result.meta.total).toBe(0);
  });

  it('retains exact count for a non-text search', async () => {
    const { service, prisma } = makeService();
    const result = await service.avanzada({ page: 1, pageSize: 10 } as never);

    expect(prisma.sentencia.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.sentencia.count).toHaveBeenCalledTimes(1);
    expect(result.meta.total).toBe(12);
  });
});

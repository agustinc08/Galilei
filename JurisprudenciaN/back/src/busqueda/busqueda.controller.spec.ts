import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { BusquedaController } from './busqueda.controller';
import { BusquedaService } from './busqueda.service';
import { BusquedaAvanzadaQueryDto } from './dto/busqueda-avanzada-query.dto';

describe('BusquedaController Search V2 hot path', () => {
  it.each([
    { digestoCollectionId: 'collection-1' },
    { digestoTopicId: 'topic-1' },
    { digestoTagId: 'tag-1' },
  ])('skips the hidden legacy search for Corpus-only filters', async (filter) => {
    const service = {
      avanzada: jest.fn(),
      trackAdvancedV2: jest.fn(),
      federatedSearch: jest.fn().mockResolvedValue({ page: 2, pageSize: 10, total: 4, totalExact: true, hasMore: false, results: [] }),
    } as unknown as BusquedaService;
    const controller = new BusquedaController(service);
    const query = { q: 'responsabilidad', page: 2, pageSize: 10, ...filter } as BusquedaAvanzadaQueryDto;
    const user = { id: 7, rol: { nombre: 'LECTOR' } } as AuthenticatedUser;

    const response = await controller.avanzada(query, user) as { data: unknown[]; meta: Record<string, unknown> };

    expect(service.avanzada).not.toHaveBeenCalled();
    expect(response.data).toEqual([]);
    expect(response.meta).toMatchObject({ total: 4, page: 2, pageSize: 10, pageCount: 1 });
    expect(service.federatedSearch).toHaveBeenCalledWith('responsabilidad', undefined, expect.objectContaining({
      sourceSystems: ['CORPUS'],
      page: 2,
      pageSize: 10,
    }));
  });

  it('serves a supported ordinary search from V2 without invoking the legacy executor', async () => {
    const service = {
      avanzada: jest.fn(),
      trackAdvancedV2: jest.fn(),
      federatedSearch: jest.fn().mockResolvedValue({
        page: 1, pageSize: 10, total: 1, totalExact: true, hasMore: false, partial: false,
        sources: [{ source: 'JURISPRUDENCIA', ok: true, total: 1, latencyMs: 20 }],
        results: [{
          id: 'JURISPRUDENCIA:SUMARIO:90', sourceSystem: 'JURISPRUDENCIA', sourceType: 'SUMARIO', sourceId: '90',
          title: 'Responsabilidad civil', subtitle: 'Sumario 90', date: '2020-01-02T00:00:00.000Z', snippet: 'Daño resarcible.',
          matchedFields: ['tema'], score: 120, metadata: { sentenciaId: 45, caratula: 'Pérez c/ Gómez' },
          visibility: 'INTERNAL', document: null,
        }],
      }),
    } as unknown as BusquedaService;
    const controller = new BusquedaController(service);
    const query = { q: 'responsabilidad', page: 1, pageSize: 10 } as BusquedaAvanzadaQueryDto;
    const user = { id: 7, rol: { nombre: 'LECTOR' } } as AuthenticatedUser;

    const response = await controller.avanzada(query, user) as { data: Array<{ sentencia: Record<string, unknown>; resumenBreve: string | null }>; federated?: { partial?: boolean } };

    expect(service.avanzada).not.toHaveBeenCalled();
    expect(service.trackAdvancedV2).toHaveBeenCalledWith(query, user.id, 1);
    expect(response.data).toHaveLength(1);
    expect(response.data[0].sentencia).toMatchObject({ id: 45, caratula: 'Pérez c/ Gómez' });
    expect(response.data[0].resumenBreve).toBe('Daño resarcible.');
    expect(response.federated?.partial).toBe(false);
    expect(service.federatedSearch).toHaveBeenCalledWith('responsabilidad', undefined, expect.objectContaining({
      publicationPolicy: 'legacy-active-only',
      page: 1,
      pageSize: 10,
    }));
  });

  it('keeps unsupported advanced filters on the compatibility path', async () => {
    const service = {
      avanzada: jest.fn().mockResolvedValue({ data: [], meta: { total: 0, page: 1, pageSize: 10, pageCount: 0 } }),
      federatedSearch: jest.fn().mockResolvedValue({ page: 1, pageSize: 10, total: 0, results: [] }),
    } as unknown as BusquedaService;
    const controller = new BusquedaController(service);
    const query = { q: 'responsabilidad', actor: 'Pérez', page: 1, pageSize: 10 } as BusquedaAvanzadaQueryDto;
    const user = { id: 7, rol: { nombre: 'LECTOR' } } as AuthenticatedUser;

    await controller.avanzada(query, user);

    expect(service.avanzada).toHaveBeenCalledWith(query, user.id);
  });
});

import { ServiceUnavailableException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import {
  BusquedaController,
  PublicBusquedaController,
} from './busqueda.controller';
import { BusquedaService } from './busqueda.service';
import { BusquedaAvanzadaQueryDto } from './dto/busqueda-avanzada-query.dto';
import type { SearchContext } from './adapters/search-source.adapter';

function federatedPage() {
  return {
    page: 1,
    pageSize: 10,
    total: 1,
    totalExact: true,
    hasMore: false,
    partial: false,
    sources: [{ source: 'JURISPRUDENCIA', ok: true, total: 1, latencyMs: 2 }],
    results: [
      {
        id: 'JURISPRUDENCIA:SENTENCIA:8142',
        sourceSystem: 'JURISPRUDENCIA',
        sourceType: 'SENTENCIA',
        sourceId: '8142',
        title: 'A. G. c/ B. P.',
        subtitle: 'A-123',
        date: '2024-02-03T00:00:00.000Z',
        snippet: 'Daños resarcibles.',
        matchedFields: ['tema'],
        score: 120,
        metadata: {
          sentenciaId: 8142,
          caratula: 'A. G. c/ B. P.',
          publicado: true,
          activo: true,
          cantidadSumarios: 1,
        },
        visibility: 'PUBLIC',
        document: null,
      },
    ],
  };
}

function mockBusquedaService(
  search = jest.fn().mockResolvedValue(federatedPage()),
) {
  const mock = {
    avanzada: jest.fn(),
    exportar: jest.fn(),
    simple: jest.fn(),
    publica: jest.fn(),
    trackAdvancedV2: jest.fn(),
    trackCitationV2: jest.fn(),
    buscarPorCita: jest.fn(),
    federatedSearch: search,
  };
  return mock as unknown as BusquedaService & typeof mock;
}

const user = { id: 7, rol: { nombre: 'LECTOR' } } as AuthenticatedUser;

describe('Search HTTP controllers in OpenSearch product mode', () => {
  it('serves advanced jurisprudence from OpenSearch without calling legacy Search', async () => {
    const service = mockBusquedaService();
    const controller = new BusquedaController(service);
    const query = {
      q: 'responsabilidad',
      page: 1,
      pageSize: 10,
    } as BusquedaAvanzadaQueryDto;

    const response = await controller.avanzada(query, user);

    expect(service.avanzada.mock.calls).toHaveLength(0);
    expect(service.federatedSearch.mock.calls[0]).toEqual([
      'responsabilidad',
      undefined,
      expect.objectContaining({
        sourceSystems: ['JURISPRUDENCIA'],
        documentKinds: ['SENTENCIA'],
      }),
    ]);
    expect(response.data).toHaveLength(1);
    expect(response.data[0].sentencia.id).toBe(8142);
  });

  it('uses only Corpus for Digesto collection searches', async () => {
    const service = mockBusquedaService();
    const controller = new BusquedaController(service);

    const response = await controller.avanzada(
      {
        q: 'responsabilidad',
        digestoCollectionId: 'collection-1',
      },
      user,
    );

    expect(service.avanzada.mock.calls).toHaveLength(0);
    expect(service.federatedSearch.mock.calls[0]).toEqual([
      'responsabilidad',
      undefined,
      expect.objectContaining({ sourceSystems: ['CORPUS'] }),
    ]);
    expect(response.data).toEqual([]);
    expect(response.federated.results).toHaveLength(1);
  });

  it('forwards supported advanced filters and requested ordering to OpenSearch', async () => {
    const contexts: SearchContext[] = [];
    const search = jest.fn(
      (
        _query: string | undefined,
        _operator: 'AND' | 'OR' | undefined,
        context: SearchContext,
      ) => {
        contexts.push(context);
        return Promise.resolve(federatedPage());
      },
    );
    const service = mockBusquedaService(search);
    const controller = new BusquedaController(service);
    const query = {
      q: 'civil',
      fraseExacta: 'falta de servicio',
      excluir: ['penal', 'tributario'],
      numeroSentencia: 'A-123',
      numeroSumario: 'S-456',
      expediente: '123/22',
      caratula: 'Daños',
      actor: 'García',
      demandado: 'Provincia',
      objeto: 'responsabilidad',
      magistrados: 'Pérez',
      sala: 'II',
      tipoFallo: 'Interlocutoria',
      tribunalOrigen: 'Cámara',
      tema: 'daños',
      fechaDesde: new Date('2020-01-01T00:00:00.000Z'),
      fechaHasta: new Date('2022-12-31T00:00:00.000Z'),
      anio: 2022,
      publicado: true,
      activo: true,
      sortBy: 'numeroSentencia',
      sortOrder: 'asc',
    } as BusquedaAvanzadaQueryDto;

    await controller.avanzada(query, user);

    expect(contexts[0]).toMatchObject({
      filters: {
        exactPhrase: 'falta de servicio',
        excludeTerms: ['penal', 'tributario'],
        numeroSentencia: 'A-123',
        numeroSumario: 'S-456',
        expediente: '123/22',
        caratula: 'Daños',
        actor: 'García',
        demandado: 'Provincia',
        objeto: 'responsabilidad',
        magistrados: 'Pérez',
        sala: 'II',
        tipoFallo: 'Interlocutoria',
        tribunalOrigen: 'Cámara',
        tema: 'daños',
        fechaDesde: '2020-01-01',
        fechaHastaExclusive: '2023-01-01',
        anio: 2022,
        publicado: true,
        activo: true,
      },
      sort: { field: 'numeroSentencia', order: 'asc' },
    });
  });

  it('serves simple search from OpenSearch without calling legacy Search', async () => {
    const service = mockBusquedaService();
    const controller = new BusquedaController(service);

    await controller.simple('responsabilidad', user);

    expect(service.simple.mock.calls).toHaveLength(0);
    expect(service.federatedSearch.mock.calls[0]).toEqual([
      'responsabilidad',
      undefined,
      expect.objectContaining({
        sourceSystems: ['JURISPRUDENCIA'],
        documentKinds: ['SENTENCIA'],
      }),
    ]);
  });

  it('exports every result page from OpenSearch without calling legacy Search', async () => {
    const base = federatedPage().results[0];
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      ...base,
      id: `JURISPRUDENCIA:SENTENCIA:${index + 1}`,
      sourceId: String(index + 1),
      metadata: { ...base.metadata, sentenciaId: index + 1 },
    }));
    const lastPage = [
      {
        ...base,
        id: 'JURISPRUDENCIA:SENTENCIA:501',
        sourceId: '501',
        metadata: { ...base.metadata, sentenciaId: 501 },
      },
    ];
    const search = jest.fn(
      (
        _query: string | undefined,
        _operator: 'AND' | 'OR' | undefined,
        context: SearchContext,
      ) =>
        Promise.resolve({
          ...federatedPage(),
          page: context.page ?? 1,
          pageSize: context.pageSize ?? 500,
          total: 501,
          hasMore: context.page === 1,
          results: context.page === 1 ? firstPage : lastPage,
        }),
    );
    const service = mockBusquedaService(search);
    const controller = new BusquedaController(service);
    const response = { setHeader: jest.fn() } as never;

    const exported = await controller.exportar(
      { q: 'responsabilidad', formato: 'json' },
      { ...user, rol: { nombre: 'ADMIN' } } as AuthenticatedUser,
      response,
    );
    if (typeof exported === 'string')
      throw new Error('JSON export unexpectedly returned text');

    expect(service.exportar.mock.calls).toHaveLength(0);
    expect(service.federatedSearch).toHaveBeenCalledWith(
      'responsabilidad',
      undefined,
      expect.objectContaining({
        visibility: 'ADMIN',
        sourceSystems: ['JURISPRUDENCIA'],
        documentKinds: ['SENTENCIA'],
        page: 1,
        pageSize: 500,
      }),
    );
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls.map((call) => call[2].page)).toEqual([1, 2]);
    expect(exported.data).toHaveLength(501);
    expect(exported.meta.total).toBe(501);
  });

  it.each(['csv', 'txt'] as const)(
    'keeps the %s export format on the OpenSearch route',
    async (formato) => {
      const service = mockBusquedaService();
      const controller = new BusquedaController(service);
      const setHeader = jest.fn();
      const response = { setHeader } as never;

      const exported = await controller.exportar(
        { q: 'civil', formato },
        { ...user, rol: { nombre: 'ADMIN' } } as AuthenticatedUser,
        response,
      );

      expect(typeof exported).toBe('string');
      expect(exported).toContain('A. G. c/ B. P.');
      expect(setHeader).toHaveBeenCalledWith(
        'Content-Type',
        formato === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'text/plain; charset=utf-8',
      );
    },
  );

  it('serves citation search from OpenSearch and records its telemetry', async () => {
    const service = mockBusquedaService();
    const controller = new BusquedaController(service);

    const response = await controller.cita('A-123', user);

    expect(service.buscarPorCita.mock.calls).toHaveLength(0);
    expect(service.federatedSearch).toHaveBeenCalledWith(
      'A-123',
      undefined,
      expect.objectContaining({
        visibility: 'INTERNAL',
        sourceSystems: ['JURISPRUDENCIA'],
        documentKinds: ['SENTENCIA'],
      }),
    );
    expect(service.trackCitationV2).toHaveBeenCalledWith('A-123', 7, 1);
    expect(response.data[0].sentencia.id).toBe(8142);
  });

  it('serves public search from OpenSearch without calling legacy Search', async () => {
    const service = mockBusquedaService();
    const controller = new PublicBusquedaController(service);

    await controller.publica({
      q: 'responsabilidad',
    });

    expect(service.publica.mock.calls).toHaveLength(0);
    expect(service.federatedSearch.mock.calls[0]).toEqual([
      'responsabilidad',
      undefined,
      expect.objectContaining({
        visibility: 'PUBLIC',
        publicationPolicy: 'published-active-only',
        sourceSystems: ['JURISPRUDENCIA'],
        documentKinds: ['SENTENCIA'],
      }),
    ]);
  });

  it.each(['advanced', 'export', 'citation', 'simple', 'public'] as const)(
    'fails closed on OpenSearch outage with zero legacy calls for %s',
    async (route) => {
      const unavailable = jest
        .fn()
        .mockRejectedValue(new ServiceUnavailableException());
      const service = mockBusquedaService(unavailable);
      const controller = new BusquedaController(service);

      if (route === 'advanced')
        await expect(
          controller.avanzada({ q: 'civil' }, user),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
      else if (route === 'export')
        await expect(
          controller.exportar({ q: 'civil', formato: 'json' }, user, {
            setHeader: jest.fn(),
          } as never),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
      else if (route === 'citation')
        await expect(controller.cita('civil', user)).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
      else if (route === 'simple')
        await expect(controller.simple('civil', user)).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
      else
        await expect(
          new PublicBusquedaController(service).publica({
            q: 'civil',
          }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(service.avanzada.mock.calls).toHaveLength(0);
      expect(service.simple.mock.calls).toHaveLength(0);
      expect(service.publica.mock.calls).toHaveLength(0);
    },
  );
});

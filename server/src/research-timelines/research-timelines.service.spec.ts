import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ResearchTimelinesService } from './research-timelines.service';

describe('ResearchTimelinesService', () => {
  const prisma = {
    sentencia: { findMany: jest.fn() },
    sentenciaRelationshipCandidate: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    researchTimeline: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    researchTimelineItem: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const logs = { registrarAccion: jest.fn() };
  const service = new ResearchTimelinesService(prisma as never, logs as never);

  beforeEach(() => jest.clearAllMocks());

  function judgment(
    id: number,
    slugPublico: string,
    fecha: Date | null,
    expediente: string | null,
  ) {
    return {
      id,
      slugPublico,
      caratula: `Caso ${slugPublico}`,
      numeroSentencia: `${id}/2020`,
      tipoFallo: 'Sentencia',
      sala: 'H',
      fecha,
      expediente,
      anonimizado: false,
      actor: 'Parte A',
      demandado: 'Parte B',
      actorPublico: null,
      demandadoPublico: null,
      archivosPdf: [{ id: id + 500 }],
      sumarios: [{ id: id + 100 }],
    };
  }

  it('rejects input outside the unique 2–50 public slug contract before querying', async () => {
    await expect(service.resolvePublic(['one'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.resolvePublic(
        Array.from({ length: 51 }, (_, index) => `slug-${index}`),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.resolvePublic(['same', 'same']),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.resolvePublic(['bad slug', 'other']),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.sentencia.findMany).not.toHaveBeenCalled();
  });

  it('orders by decision date and separates undated judgments without inferring chronology', async () => {
    prisma.sentencia.findMany.mockResolvedValue([
      judgment(3, 'new-case', new Date('2021-02-03T00:00:00Z'), null),
      judgment(2, 'old-case', new Date('2019-08-02T00:00:00Z'), null),
      judgment(1, 'undated-case', null, null),
    ]);
    prisma.sentenciaRelationshipCandidate.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.sentenciaRelationshipCandidate.findMany.mockResolvedValue([]);

    const result = await service.resolvePublic([
      'undated-case',
      'new-case',
      'old-case',
    ]);

    expect(result.data.judgments.map((item) => item.slug)).toEqual([
      'old-case',
      'new-case',
      'undated-case',
    ]);
    expect(result.data.judgments.at(-1)).toMatchObject({
      dateStatus: 'UNAVAILABLE',
      year: null,
    });
    expect(result.data.judgments[0].year).toBe(2019);
  });

  it('uses exact expediente normalization and emits only directed verified citation edges', async () => {
    prisma.sentencia.findMany.mockResolvedValue([
      judgment(
        1,
        'same-2020-a',
        new Date('2020-01-02T00:00:00Z'),
        'CIV 77/2020',
      ),
      judgment(
        2,
        'same-2020-b',
        new Date('2020-02-02T00:00:00Z'),
        'CIV 77 - 2020',
      ),
      judgment(
        3,
        'same-number-other-year',
        new Date('2021-02-02T00:00:00Z'),
        'CIV 77/2021',
      ),
    ]);
    prisma.sentenciaRelationshipCandidate.groupBy
      .mockResolvedValueOnce([{ sourceSentenceId: 1, _count: { _all: 2 } }])
      .mockResolvedValueOnce([{ targetSentenceId: 2, _count: { _all: 1 } }]);
    prisma.sentenciaRelationshipCandidate.findMany.mockResolvedValue([
      {
        sourceSentenceId: 1,
        targetSentenceId: 2,
        rawCitation: 'CNCiv., Sala H',
        page: 5,
      },
    ]);

    const result = await service.resolvePublic([
      'same-2020-a',
      'same-2020-b',
      'same-number-other-year',
    ]);

    expect(result.data.sameExpedienteGroups).toEqual([
      {
        type: 'SAME_EXPEDIENTE',
        expediente: 'CIV 77/2020',
        slugs: ['same-2020-a', 'same-2020-b'],
      },
    ]);
    expect(result.data.verifiedCitationEdges).toEqual([
      {
        type: 'VERIFIED_CITATION',
        sourceSlug: 'same-2020-a',
        targetSlug: 'same-2020-b',
        evidence: 'CNCiv., Sala H',
        page: 5,
      },
    ]);
    const citationCalls = prisma.sentenciaRelationshipCandidate.findMany.mock
      .calls as unknown as unknown[][];
    const citationQuery = citationCalls[0]?.[0] as {
      where: { status: string; relationshipType: string };
      take: number;
    };
    expect(citationQuery.where).toMatchObject({
      status: 'VERIFIED',
      relationshipType: 'CITES',
    });
    expect(citationQuery.take).toBe(2500);
    expect(result.data.judgments[0]).not.toHaveProperty('id');
  });

  it('omits unpublished and inaccessible requests without returning their metadata', async () => {
    prisma.sentencia.findMany.mockResolvedValue([
      judgment(1, 'public-one', new Date('2020-01-02T00:00:00Z'), null),
      judgment(2, 'public-two', new Date('2021-01-02T00:00:00Z'), null),
    ]);
    prisma.sentenciaRelationshipCandidate.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.sentenciaRelationshipCandidate.findMany.mockResolvedValue([]);

    const result = await service.resolvePublic([
      'public-one',
      'restricted-name-secret',
      'public-two',
    ]);

    expect(result.data.omittedCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain('restricted-name-secret');
    expect(prisma.sentencia.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          slugPublico: {
            in: ['public-one', 'restricted-name-secret', 'public-two'],
          },
          publicado: true,
          activo: true,
        },
      }),
    );
  });

  it('returns an owner-filtered saved timeline and revalidates membership access', async () => {
    prisma.researchTimeline.findFirst.mockResolvedValue({
      id: 5,
      name: 'Investigación privada',
      description: 'Nota interna',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      _count: { items: 3 },
      items: [
        { sentencia: { slugPublico: 'public-one' } },
        { sentencia: { slugPublico: 'public-two' } },
      ],
    });

    const result = await service.findOne(12, 5);

    expect(result.data.slugs).toEqual(['public-one', 'public-two']);
    expect(result.data.omittedCount).toBe(1);
    const timelineCalls = prisma.researchTimeline.findFirst.mock
      .calls as unknown as unknown[][];
    const query = timelineCalls[0]?.[0] as {
      where: { id: number; ownerId: number };
      select: { items: { where: unknown } };
    };
    expect(query.where).toEqual({ id: 5, ownerId: 12 });
    expect(query.select.items.where).toEqual({
      sentencia: {
        is: { publicado: true, activo: true, slugPublico: { not: null } },
      },
    });
  });

  it('exports only the owner’s currently public judgments through the shared verifiable dossier format', async () => {
    const oldDate = new Date('2019-02-01T00:00:00Z');
    const newDate = new Date('2020-03-01T00:00:00Z');
    prisma.researchTimeline.findFirst.mockResolvedValue({
      id: 18,
      name: 'Evolución privada',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      _count: { items: 2 },
      items: [
        {
          sentenciaId: 22,
          sentencia: judgment(22, 'timeline-old', oldDate, 'CIV 4/2019'),
        },
        {
          sentenciaId: 11,
          sentencia: judgment(11, 'timeline-new', newDate, 'CIV 4/2020'),
        },
      ],
    });
    prisma.sentencia.findMany.mockResolvedValue([
      judgment(11, 'timeline-new', newDate, 'CIV 4/2020'),
      judgment(22, 'timeline-old', oldDate, 'CIV 4/2019'),
    ]);
    prisma.sentenciaRelationshipCandidate.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.sentenciaRelationshipCandidate.findMany.mockResolvedValue([
      {
        sourceSentenceId: 11,
        targetSentenceId: 22,
        rawCitation: 'Cita pública verificada',
        page: 7,
      },
    ]);

    const result = await service.exportBundle(8, 18);

    expect(result.filename).toMatch(/^galilei-evolucion-privada-/u);
    expect(result.manifest).toMatchObject({
      researchContext: {
        type: 'JURISPRUDENTIAL_EVOLUTION',
        name: 'Evolución privada',
        selectedJudgmentIds: [22, 11],
        chronologicalSlugs: ['timeline-old', 'timeline-new'],
        relationTypes: ['VERIFIED_CITATION'],
      },
    });
    const exportCalls = prisma.researchTimeline.findFirst.mock
      .calls as unknown as unknown[][];
    const exportQuery = exportCalls[0]?.[0] as {
      where: { id: number; ownerId: number };
      select: { items: { where: unknown } };
    };
    expect(exportQuery.where).toEqual({ id: 18, ownerId: 8 });
    expect(exportQuery.select.items.where).toEqual({
      sentencia: {
        is: { publicado: true, activo: true, slugPublico: { not: null } },
      },
    });
    expect(logs.registrarAccion).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'TIMELINE_BUNDLE_EXPORT' }),
    );
  });

  it('hides a foreign timeline export behind the same generic not-found response', async () => {
    prisma.researchTimeline.findFirst.mockResolvedValue(null);
    await expect(service.exportBundle(21, 44)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.researchTimeline.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 44, ownerId: 21 } }),
    );
    expect(prisma.sentencia.findMany).not.toHaveBeenCalled();
  });

  it('hides another owner timeline from GET, PATCH and DELETE', async () => {
    prisma.researchTimeline.findFirst.mockResolvedValue(null);

    await expect(service.findOne(21, 9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.update(21, 9, { name: 'Cambio' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(21, 9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.researchTimeline.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 9, ownerId: 21 } }),
    );
    expect(prisma.researchTimeline.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects invalid name and description and never saves inaccessible membership', async () => {
    await expect(
      service.create(3, { name: ' ', slugs: ['one', 'two'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(3, {
        name: 'Investigación',
        description: 'x'.repeat(2001),
        slugs: ['one', 'two'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.sentencia.findMany.mockResolvedValue([
      { id: 4, slugPublico: 'one' },
    ]);
    await expect(
      service.create(3, { name: 'Investigación', slugs: ['one', 'two'] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.researchTimeline.create).not.toHaveBeenCalled();
  });

  it('updates membership transactionally and does not put private description text in the audit log', async () => {
    prisma.researchTimeline.findFirst
      .mockResolvedValueOnce({ id: 5, name: 'Anterior', description: null })
      .mockResolvedValueOnce({
        id: 5,
        name: 'Nueva',
        description: '<script>texto privado</script>',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        _count: { items: 2 },
        items: [
          { sentencia: { slugPublico: 'one' } },
          { sentencia: { slugPublico: 'two' } },
        ],
      });
    prisma.sentencia.findMany.mockResolvedValue([
      { id: 1, slugPublico: 'one' },
      { id: 2, slugPublico: 'two' },
    ]);
    prisma.$transaction.mockImplementation((callback: unknown) => {
      const run = callback as (tx: never) => Promise<unknown>;
      return run({
        researchTimeline: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        researchTimelineItem: {
          deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
          createMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
      } as never);
    });

    const result = await service.update(8, 5, {
      name: 'Nueva',
      description: '<script>texto privado</script>',
      slugs: ['one', 'two'],
    });

    expect(result.data.name).toBe('Nueva');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(logs.registrarAccion).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'TIMELINE_UPDATED',
        datosDespues: { name: 'Nueva', itemCount: 2 },
      }),
    );
    expect(JSON.stringify(logs.registrarAccion.mock.calls)).not.toContain(
      'texto privado',
    );
  });
});

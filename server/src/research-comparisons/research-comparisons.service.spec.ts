import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ResearchComparisonsService } from './research-comparisons.service';

describe('ResearchComparisonsService', () => {
  const prisma = {
    sentencia: { findMany: jest.fn() },
    sentenciaRelationshipCandidate: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    researchComparison: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    researchCollectionItem: { findMany: jest.fn() },
  };
  const logs = { registrarAccion: jest.fn() };
  const service = new ResearchComparisonsService(
    prisma as never,
    logs as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('rejects comparisons outside the 2–4 unique public slug contract', async () => {
    await expect(service.resolvePublic('one')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.resolvePublic('one,one')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.resolvePublic('one,two,three,four,five'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.sentencia.findMany).not.toHaveBeenCalled();
  });

  it('uses only published active judgments, preserves requested order, and marks exact normalized expediente', async () => {
    const sentence = (id: number, slugPublico: string, expediente: string) => ({
      id,
      slugPublico,
      numeroSentencia: `S-${id}`,
      tipoFallo: 'Sentencia definitiva',
      sala: 'H',
      fecha: new Date('2020-01-02T00:00:00Z'),
      expediente,
      tribunalOrigen: null,
      caratula: `Caso ${id}`,
      actor: 'Actor',
      demandado: 'Demandado',
      anonimizado: false,
      actorPublico: null,
      demandadoPublico: null,
      objeto: null,
      magistrados: null,
      juez: null,
      resena: 'Reseña',
      resenaPublicada: true,
      resumenIa: 'Resumen separado',
      resumenPublicado: true,
      resumenFuente: 'IA',
      sumarios: [],
      archivosPdf: [{ id: 7 }],
    });
    prisma.sentencia.findMany.mockResolvedValue([
      sentence(2, 'case-two', 'EXP 123 - 2020'),
      sentence(1, 'case-one', 'EXP 123/2020'),
    ]);
    prisma.sentenciaRelationshipCandidate.groupBy
      .mockResolvedValueOnce([{ sourceSentenceId: 1, _count: { _all: 1 } }])
      .mockResolvedValueOnce([{ targetSentenceId: 2, _count: { _all: 1 } }]);
    prisma.sentenciaRelationshipCandidate.findMany.mockResolvedValue([
      {
        sourceSentenceId: 1,
        targetSentenceId: 2,
        rawCitation: 'CNCiv., Sala H',
        page: 4,
      },
    ]);

    const result = await service.resolvePublic('case-one,case-two');

    expect(prisma.sentencia.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          slugPublico: { in: ['case-one', 'case-two'] },
          publicado: true,
          activo: true,
        },
      }),
    );
    expect(result.data.judgments.map((item) => item.slug)).toEqual([
      'case-one',
      'case-two',
    ]);
    expect(result.data.judgments[0].sameExpedienteAs).toEqual(['case-two']);
    expect(result.data.judgments[0].resenaEditorial).toBe('Reseña');
    expect(result.data.judgments[0].resumenAi).toBe('Resumen separado');
    expect(result.data.verifiedCrossCitations).toEqual([
      {
        sourceSlug: 'case-one',
        targetSlug: 'case-two',
        rawCitation: 'CNCiv., Sala H',
        page: 4,
      },
    ]);
    expect(result.data.judgments[0]).not.toHaveProperty('id');
  });

  it('returns one generic not-found result when any selected judgment is unavailable', async () => {
    prisma.sentencia.findMany.mockResolvedValue([
      { id: 1, slugPublico: 'one' },
    ]);
    await expect(service.resolvePublic('one,two')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('never exposes private participant names when anonymized public names are absent', async () => {
    prisma.sentencia.findMany.mockResolvedValue([
      {
        id: 1,
        slugPublico: 'anonymous-one',
        expediente: null,
        actor: 'Nombre privado actora',
        demandado: 'Nombre privado demandado',
        anonimizado: true,
        actorPublico: null,
        demandadoPublico: null,
        sumarios: [],
        archivosPdf: [],
      },
      {
        id: 2,
        slugPublico: 'anonymous-two',
        expediente: null,
        actor: 'Otra actora privada',
        demandado: 'Otro demandado privado',
        anonimizado: true,
        actorPublico: 'Parte actora',
        demandadoPublico: 'Parte demandada',
        sumarios: [],
        archivosPdf: [],
      },
    ]);
    prisma.sentenciaRelationshipCandidate.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.sentenciaRelationshipCandidate.findMany.mockResolvedValue([]);

    const result = await service.resolvePublic('anonymous-one,anonymous-two');

    expect(result.data.judgments[0]).toMatchObject({
      actor: null,
      demandado: null,
    });
    expect(result.data.judgments[1]).toMatchObject({
      actor: 'Parte actora',
      demandado: 'Parte demandada',
    });
    expect(JSON.stringify(result)).not.toContain('Nombre privado');
    expect(JSON.stringify(result)).not.toContain('Otro demandado privado');
  });

  it('filters saved comparison lookup by owner and returns a generic denial', async () => {
    prisma.researchComparison.findFirst.mockResolvedValue(null);
    await expect(service.findOne(22, 99)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.researchComparison.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99, ownerId: 22 },
      }),
    );
  });

  it('does not create a saved comparison from private or unpublished judgments', async () => {
    prisma.sentencia.findMany.mockResolvedValue([
      { id: 1, slugPublico: 'one' },
    ]);
    await expect(
      service.create(5, { name: 'Caso', slugs: ['one', 'two'] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.researchComparison.create).not.toHaveBeenCalled();
  });
});

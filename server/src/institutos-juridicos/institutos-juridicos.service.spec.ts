import { BadRequestException } from '@nestjs/common';
import { EstadoValidacionVocabulario } from '../generated/prisma/client';
import { InstitutosJuridicosService } from './institutos-juridicos.service';

const makeAudit = () => ({
  registrarAccion: jest.fn().mockResolvedValue(undefined),
});

describe('InstitutosJuridicosService search suggestions', () => {
  const makeService = () => {
    const institutoJuridico = {
      findMany: jest.fn().mockResolvedValue([
        {
          nombre: 'QA-responsabilidad médica',
          sinonimos: [
            { termino: 'QA-daño iatrogénico' },
            { termino: 'QA-práctica médica' },
          ],
        },
        { nombre: 'QA-daño de niño', sinonimos: [] },
      ]),
    };
    return {
      service: new InstitutosJuridicosService(
        { institutoJuridico } as never,
        makeAudit() as never,
      ),
      institutoJuridico,
    };
  };

  it('returns curated approved voices and explicit related terms with Spanish normalization', async () => {
    const { service, institutoJuridico } = makeService();
    const result = await service.searchSuggestions('medica');
    expect(result).toEqual([
      { value: 'QA-responsabilidad médica', tipo: 'voz_juridica' },
      {
        value: 'QA-daño iatrogénico',
        tipo: 'termino_relacionado',
        relacion: 'QA-responsabilidad médica',
      },
      {
        value: 'QA-práctica médica',
        tipo: 'termino_relacionado',
        relacion: 'QA-responsabilidad médica',
      },
    ]);
    expect(institutoJuridico.findMany).toHaveBeenCalledWith({
      where: {
        activo: true,
        estadoValidacion: EstadoValidacionVocabulario.APROBADO,
      },
      orderBy: { nombre: 'asc' },
      select: {
        nombre: true,
        sinonimos: {
          where: {
            activo: true,
            estadoValidacion: EstadoValidacionVocabulario.APROBADO,
          },
          orderBy: { termino: 'asc' },
          select: { termino: true },
        },
      },
    });
  });

  it('matches a stored synonym but keeps ñ distinct from n', async () => {
    const { service } = makeService();
    const related = await service.searchSuggestions('iatrogenico');
    const incorrectN = await service.searchSuggestions('nino');
    const correctEnye = await service.searchSuggestions('niño');
    expect(related.map((item) => item.value)).toContain(
      'QA-responsabilidad médica',
    );
    expect(incorrectN).toEqual([]);
    expect(correctEnye.map((item) => item.value)).toContain('QA-daño de niño');
  });

  it('does not query the vocabulary for short terms and caches bounded reads', async () => {
    const { service, institutoJuridico } = makeService();
    expect(await service.searchSuggestions('ab')).toEqual([]);
    expect(institutoJuridico.findMany).not.toHaveBeenCalled();
    await service.searchSuggestions('medica');
    await service.searchSuggestions('iatrogenico');
    expect(institutoJuridico.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('InstitutosJuridicosService proposal and review workflow', () => {
  it('creates voices inactive, pending, with provenance and creator', async () => {
    const create = jest.fn().mockResolvedValue({ id: 7, activo: false });
    const audit = makeAudit();
    const service = new InstitutosJuridicosService(
      {
        institutoJuridico: {
          findFirst: jest.fn().mockResolvedValue(null),
          create,
        },
      } as never,
      audit as never,
    );
    await service.create(
      {
        nombre: 'Responsabilidad médica',
        materia: 'Daños',
        fuente: 'Corpus QA',
        identificadorFuente: 'SUMARIO:QA-1',
      },
      41,
    );
    expect(create).toHaveBeenCalledWith({
      data: {
        nombre: 'Responsabilidad médica',
        materia: 'Daños',
        fuente: 'Corpus QA',
        identificadorFuente: 'SUMARIO:QA-1',
        activo: false,
        estadoValidacion: EstadoValidacionVocabulario.PENDIENTE_REVISION,
        creadoPorId: 41,
      },
    });
    expect(audit.registrarAccion).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: 41,
        entidad: 'InstitutoJuridico',
        accion: 'LEGAL_VOCABULARY_CREATE',
      }),
    );
  });

  it('creates equivalence proposals inactive and pending even if the parent is approved', async () => {
    const create = jest.fn().mockResolvedValue({ id: 8, activo: false });
    const audit = makeAudit();
    const service = new InstitutosJuridicosService(
      {
        institutoJuridico: {
          findUnique: jest.fn().mockResolvedValue({ id: 7 }),
        },
        sinonimoJuridico: {
          findFirst: jest.fn().mockResolvedValue(null),
          create,
        },
      } as never,
      audit as never,
    );
    await service.createSinonimo(
      7,
      {
        termino: 'Daño iatrogénico',
        fuente: 'Corpus QA',
        identificadorFuente: 'SUMARIO:QA-2',
      },
      41,
    );
    expect(create).toHaveBeenCalledWith({
      data: {
        institutoId: 7,
        termino: 'Daño iatrogénico',
        fuente: 'Corpus QA',
        identificadorFuente: 'SUMARIO:QA-2',
        activo: false,
        estadoValidacion: EstadoValidacionVocabulario.PENDIENTE_REVISION,
        creadoPorId: 41,
      },
    });
  });

  it('does not approve a voice without complete provenance', async () => {
    const service = new InstitutosJuridicosService(
      {
        institutoJuridico: {
          findUnique: jest.fn().mockResolvedValue({
            id: 7,
            materia: null,
            fuente: 'Corpus QA',
            identificadorFuente: null,
          }),
        },
      } as never,
      makeAudit() as never,
    );
    await expect(
      service.reviewInstitute(7, { estado: 'APROBADO' }, 99),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approves a provenance-complete voice without activating it', async () => {
    const source = {
      id: 7,
      nombre: 'Responsabilidad médica',
      materia: 'Daños',
      fuente: 'Corpus QA',
      identificadorFuente: 'SUMARIO:QA-1',
      estadoValidacion: EstadoValidacionVocabulario.PENDIENTE_REVISION,
      activo: false,
    };
    let updatedData: Record<string, unknown> = {};
    const update = jest.fn((args: { data: Record<string, unknown> }) => {
      updatedData = args.data;
      return Promise.resolve({ ...source, ...args.data });
    });
    const findMany = jest.fn().mockResolvedValue([]);
    const audit = makeAudit();
    const service = new InstitutosJuridicosService(
      {
        institutoJuridico: {
          findUnique: jest.fn().mockResolvedValue(source),
          update,
          findMany,
        },
      } as never,
      audit as never,
    );
    await service.searchSuggestions('medica');
    await service.reviewInstitute(7, { estado: 'APROBADO' }, 99);
    await service.searchSuggestions('medica');
    expect(updatedData).toMatchObject({
      activo: false,
      estadoValidacion: EstadoValidacionVocabulario.APROBADO,
      revisadoPorId: 99,
    });
    expect(updatedData.revisadoAt).toBeInstanceOf(Date);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(audit.registrarAccion).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: 99,
        accion: 'LEGAL_VOCABULARY_REVIEW',
      }),
    );
  });

  it('activates only an approved voice and records a separate audit event', async () => {
    const source = {
      id: 7,
      nombre: 'Responsabilidad médica',
      materia: 'Daños',
      fuente: 'Corpus QA',
      identificadorFuente: 'SUMARIO:QA-1',
      estadoValidacion: EstadoValidacionVocabulario.APROBADO,
      activo: false,
    };
    const update = jest
      .fn()
      .mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...source, ...args.data }),
      );
    const audit = makeAudit();
    const service = new InstitutosJuridicosService(
      {
        institutoJuridico: {
          findUnique: jest.fn().mockResolvedValue(source),
          update,
        },
      } as never,
      audit as never,
    );

    await service.setInstituteActivation(7, { activo: true }, 99);

    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { activo: true },
    });
    expect(audit.registrarAccion).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: 99,
        accion: 'LEGAL_VOCABULARY_ACTIVATE',
      }),
    );
  });

  it('does not activate a pending voice', async () => {
    const service = new InstitutosJuridicosService(
      {
        institutoJuridico: {
          findUnique: jest.fn().mockResolvedValue({
            id: 7,
            materia: 'Daños',
            fuente: 'Corpus QA',
            identificadorFuente: 'SUMARIO:QA-1',
            estadoValidacion: EstadoValidacionVocabulario.PENDIENTE_REVISION,
            activo: false,
          }),
          update: jest.fn(),
        },
      } as never,
      makeAudit() as never,
    );

    await expect(
      service.setInstituteActivation(7, { activo: true }, 99),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approves a relation once its parent is approved, without activating either', async () => {
    const pending = {
      id: 8,
      institutoId: 7,
      estadoValidacion: EstadoValidacionVocabulario.PENDIENTE_REVISION,
      activo: false,
      fuente: 'Corpus QA',
      identificadorFuente: 'SUMARIO:QA-2',
      instituto: {
        id: 7,
        activo: false,
        estadoValidacion: EstadoValidacionVocabulario.APROBADO,
      },
    };
    let updated: Record<string, unknown> = {};
    const update = jest.fn((args: { data: Record<string, unknown> }) => {
      updated = args.data;
      return Promise.resolve({ ...pending, ...args.data });
    });
    const audit = makeAudit();
    const service = new InstitutosJuridicosService(
      {
        sinonimoJuridico: {
          findUnique: jest.fn().mockResolvedValue(pending),
          update,
        },
      } as never,
      audit as never,
    );

    await service.reviewSinonimo(8, { estado: 'APROBADO' }, 99);

    expect(updated).toMatchObject({
      estadoValidacion: EstadoValidacionVocabulario.APROBADO,
      activo: false,
      revisadoPorId: 99,
    });
    expect(audit.registrarAccion).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'LEGAL_RELATION_REVIEW' }),
    );
  });

  it('requires the approved parent to be active before activating a relation', async () => {
    const synonym = {
      id: 8,
      institutoId: 7,
      fuente: 'Corpus QA',
      identificadorFuente: 'SUMARIO:QA-2',
      estadoValidacion: EstadoValidacionVocabulario.APROBADO,
      activo: false,
      instituto: {
        id: 7,
        activo: false,
        estadoValidacion: EstadoValidacionVocabulario.APROBADO,
      },
    };
    const update = jest.fn();
    const service = new InstitutosJuridicosService(
      {
        sinonimoJuridico: {
          findUnique: jest.fn().mockResolvedValue(synonym),
          update,
        },
      } as never,
      makeAudit() as never,
    );

    await expect(
      service.setSinonimoActivation(8, { activo: true }, 99),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});

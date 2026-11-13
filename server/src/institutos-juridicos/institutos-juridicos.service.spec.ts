import { InstitutosJuridicosService } from './institutos-juridicos.service';

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
        {
          nombre: 'QA-daño de niño',
          sinonimos: [],
        },
      ]),
    };
    return {
      service: new InstitutosJuridicosService({ institutoJuridico } as never),
      institutoJuridico,
    };
  };

  it('returns curated active voices and explicit related terms with Spanish normalization', async () => {
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
      where: { activo: true },
      orderBy: { nombre: 'asc' },
      select: {
        nombre: true,
        sinonimos: {
          where: { activo: true },
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

  it('does not query the vocabulary for fewer than three characters and caches the bounded work interval', async () => {
    const { service, institutoJuridico } = makeService();

    expect(await service.searchSuggestions('ab')).toEqual([]);
    expect(institutoJuridico.findMany).not.toHaveBeenCalled();
    await service.searchSuggestions('medica');
    await service.searchSuggestions('iatrogenico');

    expect(institutoJuridico.findMany).toHaveBeenCalledTimes(1);
  });
});

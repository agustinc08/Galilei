import { formatCitation } from './citation-formatter';

describe('formatCitation', () => {
  it('formats complete metadata deterministically with Spanish names and accents', () => {
    const source = {
      actor: 'María Núñez',
      demandado: 'Peña & Asociados',
      sala: 'C',
      fecha: new Date('2024-06-03T23:00:00.000Z'),
      expediente: 'CIV 10/2024',
      numeroSentencia: '12/2024',
    };
    const expected =
      'María Núñez c/ Peña & Asociados, Sala C, 3/6/2024, Expte. CIV 10/2024, Sentencia 12/2024';
    expect(formatCitation(source).citaCopiable).toBe(expected);
    expect(formatCitation(source).citaCopiable).toBe(expected);
  });

  it('omits empty optional metadata and provides a clean fallback for missing parties', () => {
    const result = formatCitation({ actor: '  ', demandado: null, sala: '  ' });
    expect(result).toEqual({
      citaBreve: 'Sentencia sin caratula',
      citaCompleta: 'Sentencia sin caratula',
      citaCopiable: 'Sentencia sin caratula',
    });
    expect(result.citaCopiable).not.toMatch(/undefined|null,,/u);
  });

  it('uses a stored custom citation and does not truncate long values', () => {
    const longCase = `Carátula ${'Niñez y daño '.repeat(100)}`.trim();
    expect(
      formatCitation({
        actor: longCase,
        citaPersonalizada: 'Cita institucional ñ',
      }).citaCopiable,
    ).toBe('Cita institucional ñ');
    expect(formatCitation({ actor: longCase }).citaCopiable).toContain(
      longCase,
    );
  });
});

import { buildHighlight } from './search-highlights';

describe('search highlights and Spanish normalization', () => {
  it('does not highlight Pena inside Peña', () => {
    expect(buildHighlight('actor', 'Peña', ['Pena'])).toBeNull();
  });

  it('highlights vowel-accent variants while preserving source text', () => {
    expect(buildHighlight('tema', 'Responsabilidad por prescripción', ['prescripcion'])).toMatchObject({
      campo: 'tema',
      texto: expect.stringContaining('<mark>prescripción</mark>'),
    });
  });
});

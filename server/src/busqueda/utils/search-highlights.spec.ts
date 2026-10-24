import { buildHighlight } from './search-highlights';

describe('search highlights and Spanish normalization', () => {
  it('does not highlight Pena inside Peña', () => {
    expect(buildHighlight('actor', 'Peña', ['Pena'])).toBeNull();
  });

  it('highlights vowel-accent variants while preserving source text', () => {
    const highlight = buildHighlight(
      'tema',
      'Responsabilidad por prescripción',
      ['prescripcion'],
    );
    expect(highlight?.campo).toBe('tema');
    expect(highlight?.texto).toContain('<mark>prescripción</mark>');
  });
});

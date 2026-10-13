import { buildSumarioSearchData, normalizeQueryText, normalizeSearchText } from './search-normalizer';

describe('SearchNormalizer', () => {
  it('removes vowel accents but preserves enye as a distinct letter', () => {
    expect(normalizeSearchText('prescripción')).toBe(normalizeSearchText('prescripcion'));
    expect(normalizeSearchText('Peña')).toBe('peña');
    expect(normalizeSearchText('Pena')).toBe('pena');
    expect(normalizeSearchText('Peña')).not.toBe(normalizeSearchText('Pena'));
  });

  it('normalizes case and preserves short legal tokens', () => {
    expect(normalizeSearchText('DAÑO de Sala A 42')).toBe('daño de sala a 42');
  });

  it('keeps query operators and punctuation while normalizing query text', () => {
    expect(normalizeQueryText(' DAÑO + "Prescripción" ')).toBe('daño + "prescripcion"');
  });

  it('writes normalized search data using Spanish-safe normalization', () => {
    const result = buildSumarioSearchData({ numeroSumario: '1', tema: 'Pena', texto: 'Peña y prescripción' });
    expect(result.textoBusquedaNormalizado).toContain('peña');
    expect(result.textoBusquedaNormalizado).toContain('pena');
    expect(result.textoBusquedaNormalizado).toContain('prescripcion');
  });
});

import { findDocumentMatches } from './corpus-document-matches';

describe('findDocumentMatches', () => {
  it('returns page context and stable previous/next ordinals', () => {
    const result = findDocumentMatches(
      [
        { pageNumber: 2, text: 'Responsabilidad civil y daño.' },
        { pageNumber: 7, text: 'La responsabilidad civil se confirma.' },
      ],
      'responsabilidad',
    );
    expect(result.total).toBe(2);
    expect(result.matches).toEqual([
      expect.objectContaining({ page: 2, ordinal: 1, total: 2 }),
      expect.objectContaining({ page: 7, ordinal: 2, total: 2 }),
    ]);
  });

  it('uses the shared query AST for boolean matching and omits negated literals', () => {
    const result = findDocumentMatches(
      [{ pageNumber: 3, text: 'Contratos y responsabilidad civil' }],
      'contratos*responsabilidad -familia',
    );
    expect(result.total).toBe(2);
  });

  it('does not produce matches for an unsatisfied document query', () => {
    expect(
      findDocumentMatches([{ pageNumber: 1, text: 'Locaciones' }], 'contratos'),
    ).toEqual({ total: 0, truncated: false, matches: [] });
  });

  it('signals when navigation is capped for unusually frequent terms', () => {
    const result = findDocumentMatches(
      [{ pageNumber: 1, text: 'fallo '.repeat(501) }],
      'fallo',
    );
    expect(result.total).toBe(500);
    expect(result.matches).toHaveLength(500);
    expect(result.truncated).toBe(true);
  });
});

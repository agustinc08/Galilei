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
      expect.objectContaining({
        page: 2,
        ordinal: 1,
        total: 2,
        start: 0,
        end: 15,
      }),
      expect.objectContaining({
        page: 7,
        ordinal: 2,
        total: 2,
        start: 3,
        end: 18,
      }),
    ]);
    expect(result.exactTotalKnown).toBe(true);
    expect(result.matches[0].text).toBe('Responsabilidad');
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
    ).toEqual({
      total: 0,
      returned: 0,
      exactTotalKnown: true,
      truncated: false,
      matches: [],
    });
  });

  it('signals when navigation is capped for unusually frequent terms', () => {
    const result = findDocumentMatches(
      [{ pageNumber: 1, text: 'fallo '.repeat(501) }],
      'fallo',
    );
    expect(result.total).toBe(500);
    expect(result.returned).toBe(500);
    expect(result.matches).toHaveLength(500);
    expect(result.truncated).toBe(true);
    expect(result.exactTotalKnown).toBe(false);
  });

  it('returns original-text spans with vowel accent folding and keeps ñ distinct', () => {
    const result = findDocumentMatches(
      [
        {
          pageNumber: 1,
          text: 'La PRESCRIPCIÓN fue confirmada; el daño quedó probado.',
        },
      ],
      'prescripcion',
    );
    expect(result.matches[0]).toMatchObject({
      page: 1,
      start: 3,
      end: 15,
      text: 'PRESCRIPCIÓN',
      kind: 'TERM',
      offset: 3,
    });
    expect(
      findDocumentMatches([{ pageNumber: 1, text: 'Daño moral' }], 'danio')
        .matches,
    ).toHaveLength(0);
  });

  it('marks an adjacent phrase as one exact span and rejects separated or punctuated words', () => {
    const query = '"daño moral"';
    const exact = findDocumentMatches(
      [{ pageNumber: 2, text: 'Daño moral reconocido.' }],
      query,
    );
    expect(exact.matches).toEqual([
      expect.objectContaining({
        page: 2,
        start: 0,
        end: 10,
        text: 'Daño moral',
        term: 'daño moral',
        kind: 'PHRASE',
      }),
    ]);
    expect(
      findDocumentMatches(
        [{ pageNumber: 1, text: 'Daño patrimonial ... moral distinta.' }],
        query,
      ).matches,
    ).toHaveLength(0);
    expect(
      findDocumentMatches([{ pageNumber: 1, text: 'Daño, moral.' }], query)
        .matches,
    ).toHaveLength(0);
    expect(
      findDocumentMatches([{ pageNumber: 1, text: 'Daño\nmoral.' }], query)
        .matches,
    ).toEqual([
      expect.objectContaining({
        start: 0,
        end: 10,
        text: 'Daño\nmoral',
        kind: 'PHRASE',
      }),
    ]);
    expect(
      findDocumentMatches([{ pageNumber: 1, text: 'Daño   moral.' }], query)
        .matches,
    ).toEqual([
      expect.objectContaining({
        start: 0,
        end: 12,
        text: 'Daño   moral',
        kind: 'PHRASE',
      }),
    ]);
  });

  it('numbers repeated phrase occurrences across pages and reports a page-local ordinal', () => {
    const result = findDocumentMatches(
      [
        { pageNumber: 1, text: 'Daño moral y daño moral.' },
        { pageNumber: 3, text: 'Daño moral.' },
      ],
      '"daño moral"',
    );
    expect(
      result.matches.map((match) => [
        match.page,
        match.start,
        match.ordinal,
        match.pageOccurrenceOrdinal,
      ]),
    ).toEqual([
      [1, 0, 1, 1],
      [1, 13, 2, 2],
      [3, 0, 3, 1],
    ]);
  });

  it('returns only matching positive OR branches and never highlights NOT or metadata fields', () => {
    const orResult = findDocumentMatches(
      [{ pageNumber: 1, text: 'Daño moral.' }],
      '"daño moral" OR responsabilidad',
    );
    expect(orResult.matches.map((match) => match.text)).toEqual(['Daño moral']);

    const notResult = findDocumentMatches(
      [{ pageNumber: 1, text: 'Daño moral.' }],
      'daño AND NOT responsabilidad',
    );
    expect(notResult.matches.map((match) => match.text)).toEqual(['Daño']);

    const fieldResult = findDocumentMatches(
      [{ pageNumber: 1, text: 'Daño moral.' }],
      'caratula:"Daño moral"',
      500,
      { caratula: 'Daño moral reconocido' },
    );
    expect(fieldResult.matches).toEqual([]);
    expect(fieldResult.exactTotalKnown).toBe(true);
  });
});

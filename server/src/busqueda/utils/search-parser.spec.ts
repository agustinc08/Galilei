import { parseSearchQuery, SearchQueryParseError } from './search-parser';
import type { SearchNode } from './search-ast';

function simplify(node: SearchNode | null): unknown {
  if (!node) return null;
  switch (node.type) {
    case 'term':
      return {
        type: node.type,
        value: node.value,
        field: node.field,
        matchMode: node.matchMode,
      };
    case 'phrase':
      return { type: node.type, value: node.value, field: node.field };
    case 'not':
      return { type: node.type, operand: simplify(node.operand) };
    case 'and':
    case 'or':
      return { type: node.type, operands: node.operands.map(simplify) };
  }
}

describe('SearchQueryParser', () => {
  it.each([
    [
      'daño * moral',
      {
        type: 'and',
        operands: [
          { type: 'term', value: 'daño', matchMode: 'contains' },
          { type: 'term', value: 'moral', matchMode: 'contains' },
        ],
      },
    ],
    [
      'daño + moral',
      {
        type: 'or',
        operands: [
          { type: 'term', value: 'daño', matchMode: 'contains' },
          { type: 'term', value: 'moral', matchMode: 'contains' },
        ],
      },
    ],
    [
      'daño - moral',
      {
        type: 'and',
        operands: [
          { type: 'term', value: 'daño', matchMode: 'contains' },
          {
            type: 'not',
            operand: { type: 'term', value: 'moral', matchMode: 'contains' },
          },
        ],
      },
    ],
    [
      'daño -moral',
      {
        type: 'and',
        operands: [
          { type: 'term', value: 'daño', matchMode: 'contains' },
          {
            type: 'not',
            operand: { type: 'term', value: 'moral', matchMode: 'contains' },
          },
        ],
      },
    ],
    ['"daño moral"', { type: 'phrase', value: 'daño moral' }],
    ['accident%', { type: 'term', value: 'accident', matchMode: 'prefix' }],
    ['%accident', { type: 'term', value: 'accident', matchMode: 'suffix' }],
    [
      'daño + moral * accidente',
      {
        type: 'or',
        operands: [
          { type: 'term', value: 'daño', matchMode: 'contains' },
          {
            type: 'and',
            operands: [
              { type: 'term', value: 'moral', matchMode: 'contains' },
              { type: 'term', value: 'accidente', matchMode: 'contains' },
            ],
          },
        ],
      },
    ],
    [
      'daño OR (moral AND accidente)',
      {
        type: 'or',
        operands: [
          { type: 'term', value: 'daño', matchMode: 'contains' },
          {
            type: 'and',
            operands: [
              { type: 'term', value: 'moral', matchMode: 'contains' },
              { type: 'term', value: 'accidente', matchMode: 'contains' },
            ],
          },
        ],
      },
    ],
    [
      '(daño OR moral) AND accidente',
      {
        type: 'and',
        operands: [
          {
            type: 'or',
            operands: [
              { type: 'term', value: 'daño', matchMode: 'contains' },
              { type: 'term', value: 'moral', matchMode: 'contains' },
            ],
          },
          { type: 'term', value: 'accidente', matchMode: 'contains' },
        ],
      },
    ],
  ])('parses %s to the expected AST', (query, expected) => {
    expect(simplify(parseSearchQuery(query).root)).toEqual(expected);
  });

  it('uses NOT > AND > OR and implicit AND', () => {
    expect(
      simplify(parseSearchQuery('daño OR moral AND accidente').root),
    ).toEqual({
      type: 'or',
      operands: [
        { type: 'term', value: 'daño', matchMode: 'contains' },
        {
          type: 'and',
          operands: [
            { type: 'term', value: 'moral', matchMode: 'contains' },
            { type: 'term', value: 'accidente', matchMode: 'contains' },
          ],
        },
      ],
    });
    expect(simplify(parseSearchQuery('daño moral').root)).toMatchObject({
      type: 'and',
    });
    expect(simplify(parseSearchQuery('daño AND NOT moral').root)).toMatchObject(
      { type: 'and' },
    );
  });

  it('parses all supported field aliases and quoted field phrases', () => {
    const aliases = [
      'tema',
      'sala',
      'tipo',
      'tipoFallo',
      'tribunal',
      'tribunalOrigen',
      'expediente',
      'caratula',
      'carátula',
      'actor',
      'demandado',
      'objeto',
      'magistrados',
      'numeroSentencia',
      'numeroSumario',
    ];
    for (const alias of aliases) {
      const parsed = parseSearchQuery(`${alias}:valor`);
      expect(parsed.root).toMatchObject({ type: 'term' });
      expect(parsed.fieldTerms).not.toEqual({});
    }
    expect(parseSearchQuery('tema:"daños y perjuicios"').root).toMatchObject({
      type: 'phrase',
      field: 'tema',
      value: 'daños y perjuicios',
    });
    expect(() => parseSearchQuery('arbitrario:valor')).toThrow(
      'Campo de búsqueda no admitido',
    );
  });

  it('applies the existing operator selector only to implicit terms', () => {
    expect(
      simplify(parseSearchQuery('daño moral', { defaultOperator: 'OR' }).root),
    ).toMatchObject({ type: 'or' });
    expect(
      simplify(
        parseSearchQuery('daño OR moral', { defaultOperator: 'AND' }).root,
      ),
    ).toMatchObject({ type: 'or' });
    expect(
      simplify(parseSearchQuery('daño -moral', { defaultOperator: 'OR' }).root),
    ).toMatchObject({ type: 'and' });
  });

  it('retains short words and numbers instead of dropping them', () => {
    expect(parseSearchQuery('de a ley 42').terms).toEqual([
      'de',
      'a',
      'ley',
      '42',
    ]);
  });

  it('versions and retains the original and normalized query', () => {
    expect(parseSearchQuery('DAÑO + "prescripción"')).toMatchObject({
      syntaxVersion: 'bjc-v1',
      originalQuery: 'DAÑO + "prescripción"',
      normalizedQuery: 'daño + "prescripcion"',
    });
    expect(parseSearchQuery('  daño  ').originalQuery).toBe('  daño  ');
  });

  it.each([
    '* daño',
    'daño +',
    'daño AND',
    'daño OR )',
    '(daño',
    'daño)',
    '%%',
    '%',
    'acci%dent',
  ])('rejects malformed or ambiguous query %s with a useful error', (query) => {
    expect(() => parseSearchQuery(query)).toThrow(SearchQueryParseError);
  });

  it('keeps the modern parser open to more than six terms', () => {
    const query =
      'daño * moral * accidente * contrato * salud * amparo * consumo';
    expect(parseSearchQuery(query).terms).toHaveLength(7);
  });

  it('parses 50 and 100 term OR/AND queries without dropping operands', () => {
    for (const count of [50, 100]) {
      const terms = Array.from(
        { length: count },
        (_, index) => `token${index}`,
      );
      expect(parseSearchQuery(terms.join(' OR ')).terms).toHaveLength(count);
      expect(parseSearchQuery(terms.join(' * ')).terms).toHaveLength(count);
    }
  });
});

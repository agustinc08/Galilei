import type { SearchContext } from '../adapters/search-source.adapter';
import {
  compareLocaleSortHits,
  searchSort,
} from './opensearch-search-source.adapter';

const baseContext: SearchContext = {
  visibility: 'INTERNAL',
  dialect: 'modern',
  publicationPolicy: 'legacy-active-only',
};

const legacyDateEpochSort = (order: 'asc' | 'desc') => ({
  _script: {
    type: 'number',
    order,
    script: {
      lang: 'painless',
      source:
        "doc['decisionDate'].size() == 0 ? 0L : doc['decisionDate'].value.toInstant().toEpochMilli()",
    },
  },
});

describe('Jurisprudencia product sort contract', () => {
  it.each([
    [
      'relevancia',
      'asc',
      [
        { _score: { order: 'asc' } },
        legacyDateEpochSort('desc'),
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ],
    ],
    [
      'relevancia',
      'desc',
      [
        { _score: { order: 'desc' } },
        legacyDateEpochSort('desc'),
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ],
    ],
    [
      'fecha',
      'asc',
      [
        legacyDateEpochSort('asc'),
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ],
    ],
    [
      'fecha',
      'desc',
      [
        legacyDateEpochSort('desc'),
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ],
    ],
    [
      'sala',
      'asc',
      [
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ],
    ],
    [
      'sala',
      'desc',
      [
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ],
    ],
    [
      'numeroSentencia',
      'asc',
      [
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ],
    ],
    [
      'numeroSentencia',
      'desc',
      [
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ],
    ],
  ] as const)(
    '%s/%s uses deterministic engine order before any locale collation',
    (field, order, expected) => {
      expect(
        searchSort(
          { ...baseContext, sort: { field, order } },
          'JURISPRUDENCIA',
        ),
      ).toEqual(expected);
    },
  );

  it('uses the same stable tie breaks for implicit relevance order', () => {
    expect(searchSort(baseContext, 'JURISPRUDENCIA')).toEqual([
      { _score: { order: 'desc' } },
      legacyDateEpochSort('desc'),
      { logicalNumericId: { order: 'desc', missing: '_last' } },
      { id: { order: 'desc' } },
    ]);
  });

  it('uses the product localeCompare comparator and treats null as empty text', () => {
    const left = {
      _id: 'JURISPRUDENCIA:SENTENCIA:1',
      _score: 0,
      _source: { logicalNumericId: 1, sortFields: { numeroSentencia: null } },
    };
    const empty = {
      _id: 'JURISPRUDENCIA:SENTENCIA:1',
      _score: 0,
      _source: { logicalNumericId: 1, sortFields: { numeroSentencia: '' } },
    };
    expect(compareLocaleSortHits(left, empty, 'numeroSentencia', 'asc')).toBe(
      0,
    );
    expect(compareLocaleSortHits(left, empty, 'numeroSentencia', 'desc')).toBe(
      0,
    );
  });
});

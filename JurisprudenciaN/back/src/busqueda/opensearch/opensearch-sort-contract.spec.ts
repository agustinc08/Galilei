import type { SearchContext } from '../adapters/search-source.adapter';
import { searchSort } from './opensearch-search-source.adapter';
import { SEARCH_INDEX_SCHEMA_VERSION_V4 } from './opensearch-mapping';

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
        { 'sortFields.sala': { order: 'asc', missing: '_first' } },
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ],
    ],
    [
      'sala',
      'desc',
      [
        { 'sortFields.sala': { order: 'desc', missing: '_last' } },
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ],
    ],
    [
      'numeroSentencia',
      'asc',
      [
        {
          'sortFields.numeroSentencia': { order: 'asc', missing: '_first' },
        },
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ],
    ],
    [
      'numeroSentencia',
      'desc',
      [
        {
          'sortFields.numeroSentencia': { order: 'desc', missing: '_last' },
        },
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ],
    ],
  ] as const)(
    '%s/%s sorts by its mapped keyword and deterministic tie breakers',
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

  it.each([
    ['sala', 'asc', '_first'],
    ['sala', 'desc', '_last'],
    ['numeroSentencia', 'asc', '_first'],
    ['numeroSentencia', 'desc', '_last'],
  ] as const)(
    '%s/%s has explicit missing placement and stable ties',
    (field, order, missing) => {
      const expectedField =
        field === 'sala' ? 'sortFields.sala' : 'sortFields.numeroSentencia';
      expect(
        searchSort(
          { ...baseContext, sort: { field, order } },
          'JURISPRUDENCIA',
        ),
      ).toEqual([
        { [expectedField]: { order, missing } },
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { id: { order: 'desc' } },
      ]);
    },
  );

  it('does not add a script sort or alter private Corpus fields', () => {
    expect(
      searchSort(
        { ...baseContext, sort: { field: 'sala', order: 'asc' } },
        'CORPUS',
      ),
    ).toEqual([
      { chamber: { order: 'asc', missing: '_last' } },
      { _score: { order: 'desc' } },
      { decisionDate: { order: 'desc', missing: '_last' } },
      { updatedAt: { order: 'desc', missing: '_last' } },
      { id: { order: 'asc' } },
    ]);
  });

  it.each(['asc', 'desc'] as const)(
    'uses the certified v4 ICU sentence-number tuple for %s',
    (order) => {
      expect(
        searchSort(
          { ...baseContext, sort: { field: 'numeroSentencia', order } },
          'JURISPRUDENCIA',
          SEARCH_INDEX_SCHEMA_VERSION_V4,
        ),
      ).toEqual([
        {
          'sortFields.numeroSentenciaCollation': {
            order,
            missing: order === 'asc' ? '_first' : '_last',
          },
        },
        { logicalNumericId: { order: 'desc', missing: '_last' } },
        { 'id.collation': { order: 'desc' } },
      ]);
    },
  );

  it('keeps Sala on its keyword contract when searching a v4 target', () => {
    expect(
      searchSort(
        { ...baseContext, sort: { field: 'sala', order: 'asc' } },
        'JURISPRUDENCIA',
        SEARCH_INDEX_SCHEMA_VERSION_V4,
      ),
    ).toEqual([
      { 'sortFields.sala': { order: 'asc', missing: '_first' } },
      { logicalNumericId: { order: 'desc', missing: '_last' } },
      { id: { order: 'desc' } },
    ]);
  });

  it('reproduces the known raw-keyword ordering bug and selects ICU for v4', () => {
    const legacy = new Intl.Collator('es-AR', {
      usage: 'sort',
      sensitivity: 'variant',
      ignorePunctuation: false,
      numeric: false,
    });
    const values = ['ñ', 'z'];
    const keywordOrder = [...values].sort();
    const legacyOrder = [...values].sort((left, right) =>
      legacy.compare(left, right),
    );
    expect(keywordOrder).toEqual(['z', 'ñ']);
    expect(legacyOrder).toEqual(['ñ', 'z']);
    expect(keywordOrder).not.toEqual(legacyOrder);
    expect(
      searchSort(
        { ...baseContext, sort: { field: 'numeroSentencia', order: 'asc' } },
        'JURISPRUDENCIA',
        SEARCH_INDEX_SCHEMA_VERSION_V4,
      )[0],
    ).toEqual({
      'sortFields.numeroSentenciaCollation': {
        order: 'asc',
        missing: '_first',
      },
    });
  });
});

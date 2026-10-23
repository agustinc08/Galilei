import {
  assertFreshV4Topology,
  classifyOpenSearchAlias,
  classifyOpenSearchIndex,
} from './opensearch-fresh-topology';

const expectation = {
  indexPrefix: 'galilei-search',
  activeAlias: 'galilei-search-active',
};

describe('OpenSearch fresh V4 topology classification', () => {
  it('accepts an index-free cluster', () => {
    expect(() =>
      assertFreshV4Topology({ indices: [], aliases: [] }, expectation),
    ).not.toThrow();
  });

  it('accepts OpenSearch system and plugin-owned index namespaces as internal', () => {
    const indices = [
      '.opensearch-observability',
      '.plugins-ml-config',
      '.tasks',
      'top_queries-2026.10.22-59523',
    ];

    expect(
      indices.map((index) =>
        classifyOpenSearchIndex(index, expectation.indexPrefix),
      ),
    ).toEqual([
      'OPENSEARCH_INTERNAL_INDEX',
      'OPENSEARCH_INTERNAL_INDEX',
      'OPENSEARCH_INTERNAL_INDEX',
      'OPENSEARCH_INTERNAL_INDEX',
    ]);
    expect(() =>
      assertFreshV4Topology({ indices, aliases: [] }, expectation),
    ).not.toThrow();
  });

  it('accepts internal indices when no BJC alias exists', () => {
    expect(() =>
      assertFreshV4Topology(
        {
          indices: ['.opensearch-observability', '.plugins-ml-config'],
          aliases: [
            { alias: '.plugins-internal-alias', index: '.plugins-ml-config' },
          ],
        },
        expectation,
      ),
    ).not.toThrow();
  });

  it.each([
    'galilei-search-v003-20261017t232432555z-a6af18cb',
    'galilei-search-v004-20261020t094732495z-6015e394',
    'galilei-search-v999-unrecognized',
    'galilei-custom-index',
  ])('rejects existing BJC application index %s', (index) => {
    expect(classifyOpenSearchIndex(index, expectation.indexPrefix)).toBe(
      'BJC_APPLICATION_INDEX',
    );
    expect(() =>
      assertFreshV4Topology({ indices: [index], aliases: [] }, expectation),
    ).toThrow('SEARCH_FRESH_V4_UNEXPECTED_INDICES');
  });

  it('rejects the active BJC alias in EMPTY state', () => {
    expect(
      classifyOpenSearchAlias(expectation.activeAlias, expectation.activeAlias),
    ).toBe('BJC_APPLICATION_ALIAS');
    expect(() =>
      assertFreshV4Topology(
        {
          indices: ['galilei-search-v004-20261020t094732495z-6015e394'],
          aliases: [
            {
              alias: expectation.activeAlias,
              index: 'galilei-search-v004-20261020t094732495z-6015e394',
            },
          ],
        },
        expectation,
      ),
    ).toThrow('SEARCH_FRESH_V4_UNEXPECTED_INDICES');
  });

  it('rejects BJC aliases even when the physical index is absent', () => {
    expect(() =>
      assertFreshV4Topology(
        {
          indices: [],
          aliases: [{ alias: expectation.activeAlias, index: 'missing' }],
        },
        expectation,
      ),
    ).toThrow('SEARCH_FRESH_V4_UNEXPECTED_ALIAS_STATE');
  });

  it('rejects unexpected non-BJC indices and aliases fail-closed', () => {
    expect(
      classifyOpenSearchIndex('customer-data', expectation.indexPrefix),
    ).toBe('UNKNOWN_NON_BJC_INDEX');
    expect(() =>
      assertFreshV4Topology(
        { indices: ['customer-data'], aliases: [] },
        expectation,
      ),
    ).toThrow('SEARCH_FRESH_V4_UNEXPECTED_NON_BJC_INDEX');
    expect(() =>
      assertFreshV4Topology(
        {
          indices: [],
          aliases: [{ alias: 'customer-alias', index: 'customer-data' }],
        },
        expectation,
      ),
    ).toThrow('SEARCH_FRESH_V4_UNEXPECTED_NON_BJC_ALIAS');
  });

  it('requires one exact V4 index and active alias when alias activation is expected', () => {
    expect(() =>
      assertFreshV4Topology(
        {
          indices: [
            '.tasks',
            'galilei-search-v004-20261020t094732495z-6015e394',
          ],
          aliases: [
            {
              alias: expectation.activeAlias,
              index: 'galilei-search-v004-20261020t094732495z-6015e394',
            },
          ],
        },
        {
          ...expectation,
          expectedIndex: 'galilei-search-v004-20261020t094732495z-6015e394',
          expectedAliasTarget:
            'galilei-search-v004-20261020t094732495z-6015e394',
        },
      ),
    ).not.toThrow();
  });

  it('rejects ambiguous BJC index topology', () => {
    expect(() =>
      assertFreshV4Topology(
        {
          indices: [
            'galilei-search-v003-20261017t232432555z-a6af18cb',
            'galilei-search-v004-20261020t094732495z-6015e394',
          ],
          aliases: [],
        },
        {
          ...expectation,
          expectedIndex: 'galilei-search-v004-20261020t094732495z-6015e394',
        },
      ),
    ).toThrow('SEARCH_FRESH_V4_UNEXPECTED_INDICES');
  });
});

import {
  buildAtomicAliasSwapActions,
  isManagedPhysicalIndex,
  resolveManagedAliasTarget,
} from './opensearch-alias-safety';

const prefix = 'galilei-preprod-search';
const alias = 'galilei-preprod-search-active';
const current = `${prefix}-v003-20261018t123456789z-ab12cd34`;
const next = `${prefix}-v003-20261018t123456790z-cd34ef56`;

describe('OpenSearch alias namespace safety', () => {
  it('accepts a normal single managed active target', () => {
    expect(isManagedPhysicalIndex(current, prefix)).toBe(true);
    expect(resolveManagedAliasTarget([current], prefix)).toBe(current);
  });

  it('rejects a foreign-only target', () => {
    expect(() =>
      resolveManagedAliasTarget(
        ['galilei-search-v003-20261018t123456789z-ab12cd34'],
        prefix,
      ),
    ).toThrow('SEARCH_ALIAS_HAS_FOREIGN_PHYSICAL_INDEX');
  });

  it('rejects a managed candidate mixed with a foreign namespace target', () => {
    expect(() =>
      resolveManagedAliasTarget(
        [
          current,
          'galilei-production-search-v003-20261018t123456789z-ab12cd34',
        ],
        prefix,
      ),
    ).toThrow('SEARCH_ALIAS_HAS_FOREIGN_PHYSICAL_INDEX');
  });

  it('rejects multiple valid physical targets as an invalid alias state', () => {
    expect(() => resolveManagedAliasTarget([current, next], prefix)).toThrow(
      'SEARCH_ALIAS_HAS_MULTIPLE_PHYSICAL_INDEXES',
    );
  });

  it('plans an atomic remove-and-add and rejects candidates from another namespace', () => {
    expect(buildAtomicAliasSwapActions([current], next, alias, prefix)).toEqual(
      [
        { remove: { index: current, alias } },
        { add: { index: next, alias, is_write_index: true } },
      ],
    );
    expect(() =>
      buildAtomicAliasSwapActions(
        [],
        'galilei-search-v003-20261018t123456789z-ab12cd34',
        alias,
        prefix,
      ),
    ).toThrow('SEARCH_ALIAS_CANDIDATE_OUTSIDE_NAMESPACE');
  });
});

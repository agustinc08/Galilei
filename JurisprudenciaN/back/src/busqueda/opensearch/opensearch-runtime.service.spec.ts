import {
  freshV4AliasTarget,
  isSearchTargetReady,
} from './opensearch-runtime.service';

const alias = 'galilei-search-active';
const indexPrefix = 'galilei-search';
const target = 'galilei-search-v004-20261021t082000000z-1a2b3c4d';

const freshV4Config = {
  topology: 'fresh-v4' as const,
  readOnlyCandidate: false,
  trustedPhysicalWriter: false,
  alias,
  indexPrefix,
  searchTarget: alias,
};

function mapping(indexName: string, isWriteIndex = true) {
  return {
    [indexName]: {
      aliases: {
        [alias]: { is_write_index: isWriteIndex },
      },
    },
  };
}

describe('fresh-v4 application alias readiness', () => {
  it('accepts one canonical physical V4 target with writer enabled', () => {
    expect(
      freshV4AliasTarget({ body: mapping(target) }, alias, indexPrefix),
    ).toBe(target);
  });

  it('rejects aliases that point to multiple physical indices', () => {
    expect(
      freshV4AliasTarget(
        {
          ...mapping(target),
          ...mapping('galilei-search-v004-20261020t094732495z-6015e394'),
        },
        alias,
        indexPrefix,
      ),
    ).toBeNull();
  });

  it('rejects V3 and indices outside the configured prefix', () => {
    expect(
      freshV4AliasTarget(
        mapping('galilei-search-v003-20261021t082000000z-1a2b3c4d'),
        alias,
        indexPrefix,
      ),
    ).toBeNull();
    expect(
      freshV4AliasTarget(
        mapping('galilei-preprod-search-v004-20261021t082000000z-1a2b3c4d'),
        alias,
        indexPrefix,
      ),
    ).toBeNull();
  });

  it('requires the active alias to designate the V4 target as writer', () => {
    expect(
      freshV4AliasTarget(mapping(target, false), alias, indexPrefix),
    ).toBeNull();
    expect(
      freshV4AliasTarget(
        { [target]: { aliases: { [alias]: {} } } },
        alias,
        indexPrefix,
      ),
    ).toBeNull();
  });

  it('keeps read-only physical-index readiness separate from alias readiness', () => {
    expect(
      isSearchTargetReady(true, {
        ...freshV4Config,
        readOnlyCandidate: true,
        searchTarget: target,
      }),
    ).toBe(true);
    expect(
      isSearchTargetReady(false, {
        ...freshV4Config,
        readOnlyCandidate: true,
        searchTarget: target,
      }),
    ).toBe(false);
  });
});

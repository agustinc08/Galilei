import {
  advanceSearchCutoverState,
  evaluateSearchCutoverPreflight,
  type SearchCutoverPreflight,
} from './search-cutover-state';

const ready: SearchCutoverPreflight = {
  direction: 'V3_TO_V4',
  aliasTargets: ['galilei-search-v003-20261017t232432555z-a6af18cb'],
  v3: 'galilei-search-v003-20261017t232432555z-a6af18cb',
  v4: 'galilei-search-v004-20261020t094732495z-6015e394',
  databaseIdentityCertified: true,
  opensearchBuildMatches: true,
  clusterGreen: true,
  icuVersion: '2.19.6',
  expectedIcuVersion: '2.19.6',
  heapBytes: 2_147_483_648,
  expectedHeapBytes: 2_147_483_648,
  outboxPendingThroughCut: 0,
  outboxFailedThroughCut: 0,
  mutationEntryPointStopped: true,
  projectorStopped: true,
  writerTargetReady: true,
  v3Exists: true,
  v4Exists: true,
  targetParityPass: true,
};

describe('Search cutover state machine', () => {
  it('accepts only the deterministic maintenance sequence', () => {
    expect(advanceSearchCutoverState('PRECHECK', 'QUIESCED')).toBe('QUIESCED');
    expect(advanceSearchCutoverState('QUIESCED', 'H_CUT_CAPTURED')).toBe(
      'H_CUT_CAPTURED',
    );
    expect(() => advanceSearchCutoverState('PRECHECK', 'ALIAS_READY')).toThrow(
      'SEARCH_CUTOVER_STATE_TRANSITION_INVALID',
    );
  });

  it('plans a single atomic V3-to-V4 alias action only when all guards pass', () => {
    expect(evaluateSearchCutoverPreflight(ready)).toEqual({
      ready: true,
      direction: 'V3_TO_V4',
      source: ready.v3,
      target: ready.v4,
      aliasActions: [
        { remove: { index: ready.v3, alias: 'galilei-search-active' } },
        {
          add: {
            index: ready.v4,
            alias: 'galilei-search-active',
            is_write_index: true,
          },
        },
      ],
      failures: [],
      writesPerformed: 0,
    });
  });

  it('fails closed if mutation traffic, projector work, or outbox backlog remains', () => {
    const result = evaluateSearchCutoverPreflight({
      ...ready,
      mutationEntryPointStopped: false,
      projectorStopped: false,
      outboxPendingThroughCut: 1,
      outboxFailedThroughCut: 1,
    });
    expect(result.ready).toBe(false);
    expect(result.failures).toEqual([
      'OUTBOX_PENDING',
      'OUTBOX_FAILED',
      'MUTATION_ENTRY_POINT_NOT_STOPPED',
      'PROJECTOR_NOT_STOPPED',
    ]);
    expect(result.writesPerformed).toBe(0);
  });

  it('prints the exact rollback inverse while failing closed unless the live alias is on V4', () => {
    const result = evaluateSearchCutoverPreflight({
      ...ready,
      direction: 'V4_TO_V3',
      aliasTargets: [ready.v4],
    });
    expect(result.ready).toBe(true);
    expect(result.aliasActions).toEqual([
      { remove: { index: ready.v4, alias: 'galilei-search-active' } },
      {
        add: {
          index: ready.v3,
          alias: 'galilei-search-active',
          is_write_index: true,
        },
      },
    ]);

    const notYetOnV4 = evaluateSearchCutoverPreflight({
      ...ready,
      direction: 'V4_TO_V3',
    });
    expect(notYetOnV4.ready).toBe(false);
    expect(notYetOnV4.failures).toContain('ALIAS_SOURCE_MISMATCH');
    expect(notYetOnV4.aliasActions).toEqual(result.aliasActions);
  });
});

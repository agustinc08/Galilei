import { buildAtomicAliasSwapActions } from './opensearch-alias-safety';

export const SEARCH_CUTOVER_STATES = [
  'PRECHECK',
  'QUIESCED',
  'H_CUT_CAPTURED',
  'V4_CAUGHT_UP',
  'WRITER_V4_READY',
  'ALIAS_READY',
  'CUTOVER_COMPLETE',
  'RESUMED',
  'FAILED_SAFE',
] as const;

export type SearchCutoverState = (typeof SEARCH_CUTOVER_STATES)[number];
export type SearchCutoverDirection = 'V3_TO_V4' | 'V4_TO_V3';

const NEXT_STATES: Record<SearchCutoverState, readonly SearchCutoverState[]> = {
  PRECHECK: ['QUIESCED', 'FAILED_SAFE'],
  QUIESCED: ['H_CUT_CAPTURED', 'FAILED_SAFE'],
  H_CUT_CAPTURED: ['V4_CAUGHT_UP', 'FAILED_SAFE'],
  V4_CAUGHT_UP: ['WRITER_V4_READY', 'FAILED_SAFE'],
  WRITER_V4_READY: ['ALIAS_READY', 'FAILED_SAFE'],
  ALIAS_READY: ['CUTOVER_COMPLETE', 'FAILED_SAFE'],
  CUTOVER_COMPLETE: ['RESUMED', 'FAILED_SAFE'],
  RESUMED: [],
  FAILED_SAFE: [],
};

export type SearchCutoverPreflight = {
  direction: SearchCutoverDirection;
  aliasTargets: string[];
  v3: string;
  v4: string;
  databaseIdentityCertified: boolean;
  opensearchBuildMatches: boolean;
  clusterGreen: boolean;
  icuVersion: string;
  expectedIcuVersion: string;
  heapBytes: number;
  expectedHeapBytes: number;
  outboxPendingThroughCut: number;
  outboxFailedThroughCut: number;
  mutationEntryPointStopped: boolean;
  projectorStopped: boolean;
  writerTargetReady: boolean;
  v3Exists: boolean;
  v4Exists: boolean;
  targetParityPass: boolean;
};

export function advanceSearchCutoverState(
  current: SearchCutoverState,
  next: SearchCutoverState,
): SearchCutoverState {
  if (!NEXT_STATES[current].includes(next)) {
    throw new Error('SEARCH_CUTOVER_STATE_TRANSITION_INVALID');
  }
  return next;
}

export function evaluateSearchCutoverPreflight(input: SearchCutoverPreflight) {
  const source = input.direction === 'V3_TO_V4' ? input.v3 : input.v4;
  const target = input.direction === 'V3_TO_V4' ? input.v4 : input.v3;
  const targetSchema = input.direction === 'V3_TO_V4' ? 4 : 3;
  const alias = 'galilei-search-active';
  const failures: string[] = [];

  if (input.aliasTargets.length !== 1 || input.aliasTargets[0] !== source) {
    failures.push('ALIAS_SOURCE_MISMATCH');
  }
  if (!input.databaseIdentityCertified) failures.push('DATABASE_IDENTITY');
  if (!input.opensearchBuildMatches) failures.push('OPENSEARCH_BUILD');
  if (!input.clusterGreen) failures.push('CLUSTER_HEALTH');
  if (input.icuVersion !== input.expectedIcuVersion)
    failures.push('ANALYSIS_ICU_VERSION');
  if (input.heapBytes !== input.expectedHeapBytes) failures.push('HEAP_SIZE');
  if (input.outboxPendingThroughCut !== 0) failures.push('OUTBOX_PENDING');
  if (input.outboxFailedThroughCut !== 0) failures.push('OUTBOX_FAILED');
  if (!input.mutationEntryPointStopped)
    failures.push('MUTATION_ENTRY_POINT_NOT_STOPPED');
  if (!input.projectorStopped) failures.push('PROJECTOR_NOT_STOPPED');
  if (!input.writerTargetReady) failures.push('WRITER_TARGET_NOT_READY');
  if (!input.v3Exists || !input.v4Exists)
    failures.push('PHYSICAL_INDEX_MISSING');
  if (!input.targetParityPass) failures.push('TARGET_PARITY');

  // Always expose the exact dry-run request derived from the declared
  // direction. Readiness still fails closed when the live alias is elsewhere.
  const aliasActions = buildAtomicAliasSwapActions(
    [source],
    target,
    alias,
    'galilei-search',
    targetSchema,
  );

  return {
    ready: failures.length === 0,
    direction: input.direction,
    source,
    target,
    aliasActions,
    failures,
    writesPerformed: 0,
  };
}

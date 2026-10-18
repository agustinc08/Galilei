export function isManagedPhysicalIndex(index: string, prefix: string) {
  if (!index.startsWith(`${prefix}-v`)) return false;
  return /^v\d{3}-\d{8}t\d{9}z-[a-f0-9]{8}$/u.test(
    index.slice(`${prefix}-`.length),
  );
}

export function isSchemaCompatiblePhysicalIndex(
  index: string,
  prefix: string,
  schemaVersion: number,
) {
  if (!isManagedPhysicalIndex(index, prefix)) return false;
  const versionStart = `${prefix}-v`.length;
  return Number(index.slice(versionStart, versionStart + 3)) === schemaVersion;
}

/** Accept exactly one explicitly selected rollback candidate in this namespace and schema. */
export function selectCompatibleRollbackTarget(
  candidates: string[],
  prefix: string,
  schemaVersion: number,
) {
  if (!candidates.length) {
    throw new Error('SEARCH_ROLLBACK_TARGET_MISSING');
  }
  if (
    candidates.some(
      (candidate) =>
        !isSchemaCompatiblePhysicalIndex(candidate, prefix, schemaVersion),
    )
  ) {
    throw new Error('SEARCH_ROLLBACK_TARGET_INCOMPATIBLE');
  }
  if (candidates.length !== 1) {
    throw new Error('SEARCH_ROLLBACK_TARGET_AMBIGUOUS');
  }
  return candidates[0];
}

export function resolveManagedAliasTarget(targets: string[], prefix: string) {
  if (targets.some((target) => !isManagedPhysicalIndex(target, prefix))) {
    throw new Error('SEARCH_ALIAS_HAS_FOREIGN_PHYSICAL_INDEX');
  }
  if (targets.length > 1) {
    throw new Error('SEARCH_ALIAS_HAS_MULTIPLE_PHYSICAL_INDEXES');
  }
  return targets[0] ?? null;
}

export function buildAtomicAliasSwapActions(
  currentTargets: string[],
  nextIndex: string,
  alias: string,
  prefix: string,
  schemaVersion: number,
) {
  if (alias !== `${prefix}-active`) {
    throw new Error('SEARCH_ALIAS_NAMESPACE_MISMATCH');
  }
  const current = resolveManagedAliasTarget(currentTargets, prefix);
  if (!isManagedPhysicalIndex(nextIndex, prefix)) {
    throw new Error('SEARCH_ALIAS_CANDIDATE_OUTSIDE_NAMESPACE');
  }
  if (!isSchemaCompatiblePhysicalIndex(nextIndex, prefix, schemaVersion)) {
    throw new Error('SEARCH_ALIAS_CANDIDATE_INCOMPATIBLE');
  }
  return [
    ...(current && current !== nextIndex
      ? [{ remove: { index: current, alias } }]
      : []),
    { add: { index: nextIndex, alias, is_write_index: true } },
  ];
}

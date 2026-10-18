export function isManagedPhysicalIndex(index: string, prefix: string) {
  if (!index.startsWith(`${prefix}-v`)) return false;
  return /^v\d{3}-\d{8}t\d{9}z-[a-f0-9]{8}$/u.test(
    index.slice(`${prefix}-`.length),
  );
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
) {
  const current = resolveManagedAliasTarget(currentTargets, prefix);
  if (!isManagedPhysicalIndex(nextIndex, prefix)) {
    throw new Error('SEARCH_ALIAS_CANDIDATE_OUTSIDE_NAMESPACE');
  }
  return [
    ...(current && current !== nextIndex
      ? [{ remove: { index: current, alias } }]
      : []),
    { add: { index: nextIndex, alias, is_write_index: true } },
  ];
}

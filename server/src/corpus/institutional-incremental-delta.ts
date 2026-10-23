export type IncrementalFileIdentity = {
  rootId: string;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  modifiedAt: string;
};

export function classifyIncrementalFile(
  previous: IncrementalFileIdentity | undefined,
  current: Omit<IncrementalFileIdentity, 'sha256'> & { sha256?: string },
) {
  if (!previous) {
    if (!current.sha256) throw new Error('HASH_REQUIRED_FOR_NEW_FILE');
    return { change: 'NEW' as const, sha256: current.sha256, hashRequired: true };
  }
  if (previous.sizeBytes === current.sizeBytes && previous.modifiedAt === current.modifiedAt) {
    return { change: 'UNCHANGED' as const, sha256: previous.sha256, hashRequired: false };
  }
  if (!current.sha256) throw new Error('HASH_REQUIRED_FOR_CHANGED_FILE');
  return {
    change: current.sha256 === previous.sha256 ? 'UNCHANGED' as const : 'MODIFIED' as const,
    sha256: current.sha256,
    hashRequired: true,
  };
}

export function findMissingIncrementalFiles(
  previous: IncrementalFileIdentity[],
  seenKeys: Set<string>,
) {
  return previous
    .filter((item) => !seenKeys.has(`${item.rootId}\0${item.relativePath.normalize('NFC')}`))
    .map((item) => ({ change: 'MISSING' as const, rootId: item.rootId, relativePath: item.relativePath, previousSha256: item.sha256 }));
}

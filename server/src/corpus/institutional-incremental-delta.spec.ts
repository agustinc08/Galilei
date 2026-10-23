import { classifyIncrementalFile, findMissingIncrementalFiles } from './institutional-incremental-delta';

describe('institutional incremental scan delta classifier', () => {
  const old = { rootId: 'fixture-root', relativePath: 'fixture/a.pdf', sizeBytes: 100, modifiedAt: '2026-10-08T10:00:00.000Z', sha256: 'old-sha' };

  it('reports NEW and hashes a new fixture file', () => {
    expect(classifyIncrementalFile(undefined, { ...old, sha256: 'new-sha' })).toMatchObject({ change: 'NEW', hashRequired: true, sha256: 'new-sha' });
  });

  it('reports UNCHANGED without rehashing when size and mtime match', () => {
    expect(classifyIncrementalFile(old, { ...old, sha256: undefined })).toMatchObject({ change: 'UNCHANGED', hashRequired: false, sha256: 'old-sha' });
  });

  it('reports MODIFIED when a controlled fixture has a new checksum', () => {
    expect(classifyIncrementalFile(old, { ...old, sizeBytes: 120, sha256: 'changed-sha' })).toMatchObject({ change: 'MODIFIED', hashRequired: true, sha256: 'changed-sha' });
  });

  it('reports an absent prior fixture as MISSING and retains its identity', () => {
    expect(findMissingIncrementalFiles([old], new Set())).toEqual([{ change: 'MISSING', rootId: 'fixture-root', relativePath: 'fixture/a.pdf', previousSha256: 'old-sha' }]);
  });
});

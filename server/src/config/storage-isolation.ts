import fs from 'node:fs';
import path from 'node:path';

export type StorageReference = { name: string; path: string };

/** Canonicalize existing storage and prevent same-root, ancestor, or descendant overlap. */
export function validateIsolatedStorage(
  storagePath: string,
  protectedRoots: StorageReference[],
) {
  const canonicalStorage = canonicalize(storagePath, true);
  assertDisjointFromProtectedRoots(canonicalStorage, protectedRoots);
  return canonicalStorage;
}

/** Validate a path reservation such as a backup directory before it is created. */
export function assertDisjointStorageReference(
  storagePath: string,
  protectedRoots: StorageReference[],
) {
  const canonicalStorage = canonicalize(storagePath, false);
  assertDisjointFromProtectedRoots(canonicalStorage, protectedRoots);
  return canonicalStorage;
}

function assertDisjointFromProtectedRoots(
  canonicalStorage: string,
  protectedRoots: StorageReference[],
) {
  for (const root of protectedRoots) {
    if (!root.path?.trim()) {
      throw new Error(`BJC_CORPUS_STORAGE_REFERENCE_REQUIRED_${root.name}`);
    }
    const canonicalProtectedRoot = canonicalize(root.path, false);
    if (pathsOverlap(canonicalStorage, canonicalProtectedRoot)) {
      throw new Error(`BJC_CORPUS_STORAGE_OVERLAP_${root.name}`);
    }
  }
}

export function canonicalizeStorageReference(value: string) {
  return canonicalize(value, false);
}

function canonicalize(value: string, requireDirectory: boolean): string {
  if (!path.isAbsolute(value))
    throw new Error('BJC_CORPUS_STORAGE_PATH_MUST_BE_ABSOLUTE');
  const absolute = path.resolve(value);
  if (requireDirectory) {
    try {
      if (!fs.statSync(absolute).isDirectory()) throw new Error();
      return fs.realpathSync.native(absolute);
    } catch {
      throw new Error('BJC_CORPUS_STORAGE_PATH_MUST_EXIST_AS_DIRECTORY');
    }
  }

  let cursor = absolute;
  const suffix: string[] = [];
  while (true) {
    try {
      const stats = fs.statSync(cursor);
      if (!stats.isDirectory())
        throw new Error('BJC_CORPUS_STORAGE_REFERENCE_NOT_DIRECTORY');
      const realParent = fs.realpathSync.native(cursor);
      return path.resolve(realParent, ...suffix.reverse());
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'BJC_CORPUS_STORAGE_REFERENCE_NOT_DIRECTORY'
      ) {
        throw error;
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw new Error('BJC_CORPUS_STORAGE_REFERENCE_CANNOT_RESOLVE');
      }
      const parent = path.dirname(cursor);
      if (parent === cursor)
        throw new Error('BJC_CORPUS_STORAGE_REFERENCE_CANNOT_RESOLVE');
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function pathsOverlap(left: string, right: string) {
  const leftPath = normalizeForComparison(left);
  const rightPath = normalizeForComparison(right);
  return (
    isSameOrWithin(leftPath, rightPath) || isSameOrWithin(rightPath, leftPath)
  );
}

function isSameOrWithin(parent: string, child: string) {
  if (parent === child) return true;
  const relative = path.relative(parent, child);
  return (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function normalizeForComparison(value: string) {
  const normalized = path.resolve(value).replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

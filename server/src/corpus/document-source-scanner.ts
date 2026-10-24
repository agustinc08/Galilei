import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, opendir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';

export type SourceFileSnapshot = {
  absolutePath: string;
  relativePath: string;
  normalizedPath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: Date;
};

export type ScanPathIssue = {
  code: 'REPARSE_POINT' | 'OUTSIDE_ROOT';
  relativePath: string;
};

@Injectable()
export class DocumentSourceScanner {
  validateNetworkPath(value: string) {
    const trimmed = value.trim();
    if (
      trimmed.length < 5 ||
      trimmed.length > 1024 ||
      /[\0\r\n]/u.test(trimmed) ||
      !/^\\\\[^\\]+\\[^\\]+(?:\\.*)?$/u.test(trimmed) ||
      /^\\\\[?.]\\/u.test(trimmed)
    ) {
      throw new Error('INVALID_NETWORK_PATH');
    }
    const parts = trimmed.replace(/^\\\\/u, '').split('\\');
    if (parts.some((part) => part === '.' || part === '..'))
      throw new Error('INVALID_NETWORK_PATH');
    return trimmed.replace(/[\\]+$/u, '');
  }

  async testAccess(root: string) {
    const safeRoot = this.validateNetworkPath(root);
    const info = await stat(safeRoot);
    if (!info.isDirectory()) return false;
    const directory = await opendir(safeRoot);
    await directory.close();
    return true;
  }

  async *enumerate(
    root: string,
    onIssue: (issue: ScanPathIssue) => void,
  ): AsyncGenerator<SourceFileSnapshot> {
    const rootPath = path.resolve(root);
    const realRoot = await realpath(rootPath);
    const rootStat = await stat(realRoot);
    if (!rootStat.isDirectory()) throw new Error('SOURCE_ROOT_NOT_DIRECTORY');
    const pending = [realRoot];
    while (pending.length) {
      const directoryPath = pending.pop()!;
      const directory = await opendir(directoryPath);
      for await (const entry of directory) {
        const absolutePath = path.join(directoryPath, entry.name);
        const relativePath = path.relative(realRoot, absolutePath);
        if (!isSafeRelativePath(relativePath)) {
          onIssue({ code: 'OUTSIDE_ROOT', relativePath: '' });
          continue;
        }
        if (entry.isSymbolicLink()) {
          onIssue({ code: 'REPARSE_POINT', relativePath });
          continue;
        }
        const entryStat = await lstat(absolutePath);
        if (entryStat.isSymbolicLink()) {
          onIssue({ code: 'REPARSE_POINT', relativePath });
          continue;
        }
        if (entryStat.isDirectory()) {
          pending.push(absolutePath);
          continue;
        }
        if (!entryStat.isFile()) continue;
        const verifiedPath = await realpath(absolutePath);
        if (!isWithinRoot(realRoot, verifiedPath)) {
          onIssue({ code: 'OUTSIDE_ROOT', relativePath });
          continue;
        }
        yield {
          absolutePath,
          relativePath,
          normalizedPath: normalizeRelativePath(relativePath),
          fileName: path.basename(relativePath),
          extension: path.extname(relativePath).toLowerCase(),
          sizeBytes: entryStat.size,
          modifiedAt: entryStat.mtime,
        };
      }
    }
  }

  async hash(snapshot: SourceFileSnapshot, root: string) {
    const rootReal = await realpath(root);
    const before = await lstat(snapshot.absolutePath);
    if (!before.isFile() || before.isSymbolicLink())
      throw new Error('SOURCE_FILE_UNSAFE');
    const realFile = await realpath(snapshot.absolutePath);
    if (!isWithinRoot(rootReal, realFile))
      throw new Error('SOURCE_FILE_OUTSIDE_ROOT');
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(snapshot.absolutePath);
      stream.on('data', (chunk: string | Buffer) => {
        hash.update(chunk);
      });
      stream.on('error', reject);
      stream.on('end', resolve);
    });
    const after = await stat(snapshot.absolutePath);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw new Error('SOURCE_FILE_CHANGED_DURING_READ');
    return hash.digest('hex');
  }
}

export function normalizeRelativePath(value: string) {
  if (!isSafeRelativePath(value)) throw new Error('INVALID_RELATIVE_PATH');
  return value
    .normalize('NFC')
    .replace(/[\\/]+/gu, '\\')
    .replace(/^\\|\\$/gu, '')
    .toLocaleLowerCase('en-US');
}

export function isSafeRelativePath(value: string) {
  if (!value || path.isAbsolute(value) || /^[A-Za-z]:/u.test(value))
    return false;
  const parts = value.split(/[\\/]/u);
  return parts.every((part) => part !== '..' && part !== '.' && part !== '');
}

function isWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== '..')
  );
}

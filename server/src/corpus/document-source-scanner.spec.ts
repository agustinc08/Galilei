import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  DocumentSourceScanner,
  normalizeRelativePath,
  type SourceFileSnapshot,
} from './document-source-scanner';

describe('DocumentSourceScanner', () => {
  const scanner = new DocumentSourceScanner();
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'galilei-source-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('requires a plain UNC folder path and rejects traversal/device paths', () => {
    expect(
      scanner.validateNetworkPath(String.raw`\\server\share\sentencias`),
    ).toBe(String.raw`\\server\share\sentencias`);
    expect(() =>
      scanner.validateNetworkPath(String.raw`\\server\share\..\secret`),
    ).toThrow('INVALID_NETWORK_PATH');
    expect(() =>
      scanner.validateNetworkPath(String.raw`\\?\UNC\server\share`),
    ).toThrow('INVALID_NETWORK_PATH');
    expect(() => scanner.validateNetworkPath('https://server/share')).toThrow(
      'INVALID_NETWORK_PATH',
    );
  });

  it('normalizes relative paths consistently for Windows source folders', () => {
    expect(normalizeRelativePath(String.raw`Actas\Año 2026.PDF`)).toBe(
      String.raw`actas\año 2026.pdf`,
    );
    expect(normalizeRelativePath('actas/Año 2026.PDF')).toBe(
      String.raw`actas\año 2026.pdf`,
    );
    expect(() => normalizeRelativePath(String.raw`..\secret.pdf`)).toThrow(
      'INVALID_RELATIVE_PATH',
    );
  });

  it('enumerates regular files recursively and hashes them without following links', async () => {
    await mkdir(path.join(root, 'sub'), { recursive: true });
    const content = Buffer.from('%PDF-1.4\nfixture source file');
    await writeFile(path.join(root, 'A.pdf'), content);
    await writeFile(path.join(root, 'sub', 'B.txt'), 'fixture text');
    const issues: string[] = [];
    const files: SourceFileSnapshot[] = [];
    for await (const entry of scanner.enumerate(root, (issue) =>
      issues.push(issue.code),
    ))
      files.push(entry);

    expect(issues).toEqual([]);
    expect(files.map((entry) => entry.relativePath).sort()).toEqual(
      [path.join('sub', 'B.txt'), 'A.pdf'].sort(),
    );
    expect(
      files.find((entry) => entry.fileName === 'A.pdf')?.normalizedPath,
    ).toBe('a.pdf');
    expect(
      await scanner.hash(
        files.find((entry) => entry.fileName === 'A.pdf')!,
        root,
      ),
    ).toBe(createHash('sha256').update(content).digest('hex'));
  });
});

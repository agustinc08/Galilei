import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

type RootConfig = {
  id: string;
  name: string;
  path: string;
  type: string;
  source: string;
  readOnly: boolean;
  active: boolean;
  excludedReason?: string;
};
type FileEntry = {
  rootId: string;
  relativePath: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  createdAt: string | null;
  modifiedAt: string;
  sha256: string;
  detectedMime: string;
  signatureStatus:
    | 'VALID_HEADER_AND_EOF'
    | 'HEADER_ONLY'
    | 'INVALID_HEADER'
    | 'EMPTY';
  duplicateLocations: string[];
};
type Inventory = {
  schemaVersion: '1.0';
  scanId: string;
  generatedAt: string;
  roots: Array<Omit<RootConfig, 'path'> & { relativePath: string }>;
  excludedRoots: Array<
    Omit<RootConfig, 'path'> & {
      relativePath: string;
      pdfCountObserved?: number;
    }
  >;
  files: FileEntry[];
  totals: {
    pdfPhysical: number;
    pdfByExtension: number;
    hashesUnique: number;
    duplicatePhysical: number;
    bytesTotal: number;
    zeroBytes: number;
    invalidPdf: number;
    nonPdfExtensionDetectedAsPdf: number;
    pdfValidSignature: number;
    repeatedPaths: number;
    repeatedNames: number;
    unreadable: number;
  };
};

const workspaceRoot = path.resolve(process.cwd(), '..', '..');
const configPath = path.resolve(__dirname, 'institutional-pdf-roots.json');
const outputRoot = path.resolve(
  workspaceRoot,
  '_recovery-work',
  'sprint8',
  'inventory',
);

async function main() {
  const config = JSON.parse(await readFile(configPath, 'utf8')) as {
    schemaVersion: string;
    roots: RootConfig[];
  };
  if (config.schemaVersion !== '1.0')
    throw new Error('ROOTS_SCHEMA_UNSUPPORTED');
  const roots = config.roots.map((root) => ({
    ...root,
    absolutePath: path.resolve(workspaceRoot, root.path),
  }));
  const active = roots.filter((root) => root.active);
  for (const root of roots) {
    if (root.active && !root.readOnly)
      throw new Error(`ROOT_NOT_READ_ONLY: ${root.id}`);
    if (
      isInside(root.absolutePath, outputRoot) ||
      isInside(outputRoot, root.absolutePath)
    )
      throw new Error(`OUTPUT_OVERLAPS_ROOT: ${root.id}`);
  }
  const files: FileEntry[] = [];
  const unreadable: Array<{
    rootId: string;
    relativePath: string;
    error: string;
  }> = [];
  for (const root of active) {
    const resolvedRoot = await realpath(root.absolutePath);
    const rootInfo = await stat(resolvedRoot);
    if (!rootInfo.isDirectory())
      throw new Error(`ROOT_NOT_DIRECTORY: ${root.id}`);
    await visit(root, resolvedRoot, resolvedRoot, files, unreadable);
  }
  files.sort(
    (a, b) =>
      a.rootId.localeCompare(b.rootId) ||
      a.relativePath.localeCompare(b.relativePath),
  );
  const byHash = new Map<string, FileEntry[]>();
  for (const file of files) {
    if (!byHash.has(file.sha256)) byHash.set(file.sha256, []);
    byHash.get(file.sha256)!.push(file);
  }
  for (const records of byHash.values()) {
    if (records.length > 1) {
      const locations = records.map(
        (record) => `${record.rootId}:${record.relativePath}`,
      );
      for (const record of records)
        record.duplicateLocations = locations.filter(
          (location) => location !== `${record.rootId}:${record.relativePath}`,
        );
    }
  }
  const names = new Map<string, Set<string>>();
  const paths = new Set<string>();
  let repeatedPaths = 0;
  for (const file of files) {
    const nameKey = file.filename.normalize('NFC').toLocaleLowerCase('en-US');
    if (!names.has(nameKey)) names.set(nameKey, new Set());
    names.get(nameKey)!.add(`${file.rootId}:${file.relativePath}`);
    const pathKey = `${file.rootId}:${file.relativePath}`
      .normalize('NFC')
      .toLocaleLowerCase('en-US');
    if (paths.has(pathKey)) repeatedPaths += 1;
    else paths.add(pathKey);
  }
  const generatedAt = new Date().toISOString();
  const rootsForManifest = active.map(
    ({ absolutePath: _absolutePath, ...root }) => ({
      ...root,
      relativePath: root.path,
    }),
  );
  const excludedRoots = await Promise.all(
    roots
      .filter((root) => !root.active)
      .map(async ({ absolutePath, ...root }) => ({
        ...root,
        relativePath: root.path,
        pdfCountObserved: await countPdfNames(absolutePath),
      })),
  );
  const inventory: Inventory = {
    schemaVersion: '1.0',
    scanId: randomUUID(),
    generatedAt,
    roots: rootsForManifest,
    excludedRoots,
    files,
    totals: {
      pdfPhysical: files.length,
      pdfByExtension: files.filter((file) => file.extension === '.pdf').length,
      hashesUnique: byHash.size,
      duplicatePhysical: files.length - byHash.size,
      bytesTotal: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      zeroBytes: files.filter((file) => file.signatureStatus === 'EMPTY')
        .length,
      invalidPdf: files.filter(
        (file) =>
          file.extension === '.pdf' &&
          (file.signatureStatus === 'INVALID_HEADER' ||
            file.signatureStatus === 'EMPTY'),
      ).length,
      nonPdfExtensionDetectedAsPdf: files.filter(
        (file) =>
          file.extension !== '.pdf' &&
          (file.signatureStatus === 'VALID_HEADER_AND_EOF' ||
            file.signatureStatus === 'HEADER_ONLY'),
      ).length,
      pdfValidSignature: files.filter(
        (file) =>
          file.signatureStatus === 'VALID_HEADER_AND_EOF' ||
          file.signatureStatus === 'HEADER_ONLY',
      ).length,
      repeatedPaths,
      repeatedNames: [...names.values()].filter((values) => values.size > 1)
        .length,
      unreadable: unreadable.length,
    },
  };
  const runOutput = path.join(outputRoot, inventory.scanId);
  await mkdir(runOutput, { recursive: true });
  const json = `${stableJson(inventory)}\n`;
  const manifestHash = createHash('sha256').update(json).digest('hex');
  await writeFile(
    path.join(runOutput, 'institutional-pdf-inventory.json'),
    json,
    { flag: 'wx' },
  );
  await writeFile(
    path.join(runOutput, 'institutional-pdf-inventory.sha256'),
    `${manifestHash}  institutional-pdf-inventory.json\n`,
    { flag: 'wx' },
  );
  await writeFile(
    path.join(runOutput, 'institutional-pdf-inventory-errors.json'),
    `${stableJson(unreadable)}\n`,
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify(
      {
        status: 'INVENTORY_COMPLETE',
        path: path.join(runOutput, 'institutional-pdf-inventory.json'),
        sha256: manifestHash,
        totals: inventory.totals,
        excludedRoots,
      },
      null,
      2,
    ),
  );
}

async function visit(
  root: RootConfig & { absolutePath: string },
  absoluteRoot: string,
  directory: string,
  files: FileEntry[],
  unreadable: Array<{ rootId: string; relativePath: string; error: string }>,
) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    unreadable.push({
      rootId: root.id,
      relativePath: relative(directory, absoluteRoot),
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(root, absoluteRoot, fullPath, files, unreadable);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    let signature: Buffer;
    try {
      const handle = await open(fullPath, 'r');
      try {
        signature = Buffer.alloc(5);
        await handle.read(signature, 0, 5, 0);
      } finally {
        await handle.close();
      }
    } catch (error) {
      unreadable.push({
        rootId: root.id,
        relativePath: relative(fullPath, absoluteRoot),
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const isPdf =
      extension === '.pdf' || signature.toString('ascii') === '%PDF-';
    if (!isPdf) continue;
    try {
      const info = await lstat(fullPath);
      if (info.isSymbolicLink()) continue;
      const hash = await hashFile(fullPath);
      const eof = info.size ? await hasEofMarker(fullPath, info.size) : false;
      const headerOk = signature.toString('ascii') === '%PDF-';
      const signatureStatus: FileEntry['signatureStatus'] =
        info.size === 0
          ? 'EMPTY'
          : !headerOk
            ? 'INVALID_HEADER'
            : eof
              ? 'VALID_HEADER_AND_EOF'
              : 'HEADER_ONLY';
      files.push({
        rootId: root.id,
        relativePath: relative(fullPath, absoluteRoot),
        filename: entry.name,
        extension: extension || '[no-extension]',
        sizeBytes: info.size,
        createdAt: info.birthtimeMs ? info.birthtime.toISOString() : null,
        modifiedAt: info.mtime.toISOString(),
        sha256: hash,
        detectedMime: headerOk ? 'application/pdf' : 'application/octet-stream',
        signatureStatus,
        duplicateLocations: [],
      });
    } catch (error) {
      unreadable.push({
        rootId: root.id,
        relativePath: relative(fullPath, absoluteRoot),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function hashFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
async function hasEofMarker(filePath: string, size: number) {
  const length = Math.min(4096, size);
  const buffer = Buffer.alloc(length);
  const handle = await open(filePath, 'r');
  try {
    await handle.read(buffer, 0, length, size - length);
  } finally {
    await handle.close();
  }
  return buffer.includes(Buffer.from('%%EOF'));
}
function relative(filePath: string, root: string) {
  return path.relative(root, filePath).split(path.sep).join('/');
}
function isInside(root: string, target: string) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function stableJson(value: unknown): string {
  const normalize = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(normalize)
      : input && typeof input === 'object'
        ? Object.fromEntries(
            Object.entries(input as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, normalize(item)]),
          )
        : input;
  return JSON.stringify(normalize(value), null, 2);
}
async function countPdfNames(root: string) {
  try {
    await realpath(root);
  } catch {
    return 0;
  }
  let count = 0;
  const visitDirectory = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visitDirectory(full);
      else if (
        entry.isFile() &&
        path.extname(entry.name).toLowerCase() === '.pdf'
      )
        count += 1;
    }
  };
  await visitDirectory(root);
  return count;
}

if (require.main === module)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

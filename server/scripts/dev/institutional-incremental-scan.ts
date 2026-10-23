import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Dirent } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaService } from '../../src/prisma/prisma.service';
import { classifyIncrementalFile, findMissingIncrementalFiles } from '../../src/corpus/institutional-incremental-delta';

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(process.cwd(), '..');
const originalManifestPath = path.join(workspaceRoot, '_recovery-work', 'sprint8', 'inventory', '1a063011-f3a3-421f-bd11-1ecdf3896bb2', 'institutional-pdf-inventory.json');
const rootsPath = path.resolve(__dirname, 'institutional-pdf-roots.json');
const outputRoot = path.join(workspaceRoot, '_recovery-work', 'sprint9', 'inventory');

type Root = { id: string; name: string; path: string; type: string; source: string; readOnly: boolean; active: boolean };
type FileRow = { rootId: string; relativePath: string; filename: string; extension: string; sizeBytes: number; createdAt: string | null; modifiedAt: string; sha256: string; detectedMime: string; signatureStatus: string; duplicateLocations: string[] };
type Inventory = { schemaVersion: string; scanId: string; generatedAt: string; roots: Array<Root & { relativePath: string }>; files: FileRow[]; totals: Record<string, number> };
type Finding = { change: 'NEW' | 'MODIFIED' | 'UNCHANGED' | 'MISSING'; rootId: string; relativePath: string; previousSha256?: string; currentSha256?: string; sizeBytes?: number; modifiedAt?: string };

async function main() {
  const config = JSON.parse(await readFile(rootsPath, 'utf8')) as { schemaVersion: string; roots: Root[] };
  const manifestPath = await latestManifest();
  const sourceBytes = await readFile(manifestPath);
  const expectedHash = createHash('sha256').update(sourceBytes).digest('hex');
  const sidecar = (await readFile(manifestPath.replace(/\.json$/u, '.sha256'), 'utf8')).trim().split(/\s+/u)[0];
  if (sidecar !== expectedHash) throw new Error('BASELINE_MANIFEST_SHA_MISMATCH');
  const baseline = JSON.parse(sourceBytes.toString('utf8')) as Inventory;
  if (config.schemaVersion !== '1.0' || baseline.schemaVersion !== '1.0') throw new Error('INVENTORY_SCHEMA_UNSUPPORTED');
  const activeRoots = config.roots.filter((root) => root.active);
  if (activeRoots.some((root) => !root.readOnly)) throw new Error('ACTIVE_ROOT_MUST_BE_READ_ONLY');
  const baselineByPath = new Map(baseline.files.map((row) => [key(row.rootId, row.relativePath), row]));
  const seen = new Set<string>();
  const current: FileRow[] = [];
  const findings: Finding[] = [];

  for (const root of activeRoots) {
    const absoluteRoot = path.resolve(workspaceRoot, root.path);
    if (!inside(workspaceRoot, absoluteRoot)) throw new Error(`ROOT_ESCAPES_WORKSPACE:${root.id}`);
    const resolvedRoot = await realpath(absoluteRoot);
    if (!inside(workspaceRoot, resolvedRoot)) throw new Error(`ROOT_REALPATH_ESCAPES_WORKSPACE:${root.id}`);
    await visit(root, resolvedRoot, resolvedRoot, baselineByPath, seen, current, findings);
  }
  findings.push(...findMissingIncrementalFiles(baseline.files, seen));
  findings.sort((a, b) => a.rootId.localeCompare(b.rootId) || a.relativePath.localeCompare(b.relativePath));
  current.sort((a, b) => a.rootId.localeCompare(b.rootId) || a.relativePath.localeCompare(b.relativePath));
  const now = new Date().toISOString();
  const scanId = `incremental-${now.replace(/[:.]/gu, '-')}`;
  const rootRows = activeRoots.map((root) => ({ ...root, relativePath: root.path }));
  const inventory: Inventory = { schemaVersion: '1.0', scanId, generatedAt: now, roots: rootRows, files: current, totals: { pdfPhysical: current.length, pdfByExtension: current.filter((row) => row.extension === '.pdf').length, hashesUnique: new Set(current.map((row) => row.sha256)).size, bytesTotal: current.reduce((sum, row) => sum + row.sizeBytes, 0) } };
  await mkdir(outputRoot, { recursive: true });
  const runDir = path.join(outputRoot, scanId);
  await mkdir(runDir, { recursive: false });
  const checkpoint = path.join(runDir, 'institutional-pdf-inventory.json');
  const manifest = `${stableJson(inventory)}\n`;
  const checksum = createHash('sha256').update(manifest).digest('hex');
  await writeFile(checkpoint, manifest, { flag: 'wx' });
  await writeFile(checkpoint.replace(/\.json$/u, '.sha256'), `${checksum}  institutional-pdf-inventory.json\n`, { flag: 'wx' });

  const changed = findings.filter((item) => item.change === 'NEW' || item.change === 'MODIFIED');
  let ingest: { status: string; exitCode: number | null } = { status: 'NOT_NEEDED', exitCode: 0 };
  if (changed.length) ingest = await ingestChanges(inventory, changed, runDir);
  if (ingest.status !== 'SUCCESS' && ingest.status !== 'NOT_NEEDED') throw new Error('INCREMENTAL_CHANGE_INGEST_FAILED; sourceMissing state was not changed.');

  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const presentByRoot = new Map<string, Set<string>>();
    for (const row of current) {
      if (!presentByRoot.has(row.rootId)) presentByRoot.set(row.rootId, new Set());
      presentByRoot.get(row.rootId)!.add(row.relativePath);
    }
    let missingLocations = 0;
    let restoredLocations = 0;
    let statRefreshes = 0;
    for (const root of activeRoots) {
      const rows = await prisma.corpusDocumentLocation.findMany({ where: { rootId: root.id }, select: { id: true, relativePath: true, sourceMissing: true, sizeBytes: true, modifiedAt: true } });
      const present = presentByRoot.get(root.id) ?? new Set<string>();
      const missingIds = rows.filter((row) => !present.has(row.relativePath) && !row.sourceMissing).map((row) => row.id);
      const restored = rows.filter((row) => present.has(row.relativePath) && row.sourceMissing).map((row) => row.id);
      missingLocations += missingIds.length;
      restoredLocations += restored.length;
      for (const batch of chunks(missingIds, 500)) await prisma.corpusDocumentLocation.updateMany({ where: { id: { in: batch } }, data: { sourceMissing: true } });
      for (const batch of chunks(restored, 500)) await prisma.corpusDocumentLocation.updateMany({ where: { id: { in: batch } }, data: { sourceMissing: false } });
      const byPath = new Map(current.filter((row) => row.rootId === root.id).map((row) => [row.relativePath, row]));
      for (const row of rows) {
        const latest = byPath.get(row.relativePath);
        if (latest && (Number(row.sizeBytes) !== latest.sizeBytes || row.modifiedAt?.toISOString() !== latest.modifiedAt)) {
          await prisma.corpusDocumentLocation.update({ where: { id: row.id }, data: { sizeBytes: BigInt(latest.sizeBytes), modifiedAt: new Date(latest.modifiedAt), sourceMissing: false } });
          statRefreshes += 1;
        }
      }
    }
    const report = { status: 'INCREMENTAL_SCAN_COMPLETE', scanId, baselineScanId: baseline.scanId, baselineSha256: expectedHash, checkpoint, checkpointSha256: checksum, changes: countChanges(findings), newOrModifiedFiles: changed.length, ingestedChanges: ingest, missingLocationsMarked: missingLocations, restoredLocations, statRefreshes, originalsReadOnly: true };
    await writeFile(path.join(runDir, 'incremental-scan-report.json'), `${JSON.stringify({ ...report, findings }, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

async function visit(root: Root, absoluteRoot: string, directory: string, baseline: Map<string, FileRow>, seen: Set<string>, current: FileRow[], findings: Finding[]) {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) { await visit(root, absoluteRoot, fullPath, baseline, seen, current, findings); continue; }
    if (!entry.isFile()) continue;
    const info = await lstat(fullPath);
    const relativePath = path.relative(absoluteRoot, fullPath).split(path.sep).join('/');
    const lookup = key(root.id, relativePath);
    const signature = await readSignature(fullPath);
    const extension = path.extname(entry.name).toLowerCase();
    if (extension !== '.pdf' && signature !== 'VALID_HEADER_AND_EOF' && signature !== 'HEADER_ONLY') continue;
    const previous = baseline.get(lookup);
    seen.add(lookup);
    const modifiedAt = info.mtime.toISOString();
    const sameStat = previous?.sizeBytes === info.size && previous.modifiedAt === modifiedAt;
    const currentHash = sameStat && previous ? undefined : await hashFile(fullPath);
    const classified = classifyIncrementalFile(previous, { rootId: root.id, relativePath, sizeBytes: info.size, modifiedAt, sha256: currentHash });
    const { sha256, change } = classified;
    current.push({ rootId: root.id, relativePath, filename: entry.name, extension: extension || '[no-extension]', sizeBytes: info.size, createdAt: previous?.createdAt ?? null, modifiedAt, sha256, detectedMime: 'application/pdf', signatureStatus: signature, duplicateLocations: [] });
    findings.push({ change, rootId: root.id, relativePath, ...(previous ? { previousSha256: previous.sha256 } : {}), currentSha256: sha256, sizeBytes: info.size, modifiedAt });
  }
}

async function readSignature(file: string) {
  const handle = await open(file, 'r');
  try {
    const first = Buffer.alloc(5);
    await handle.read(first, 0, 5, 0);
    if (first.toString('ascii') !== '%PDF-') return 'INVALID_HEADER';
    const info = await lstat(file);
    const tailSize = Math.min(info.size, 2048);
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tailSize, Math.max(0, info.size - tailSize));
    return tail.includes(Buffer.from('%%EOF')) ? 'VALID_HEADER_AND_EOF' : 'HEADER_ONLY';
  } finally { await handle.close(); }
}

async function ingestChanges(inventory: Inventory, changed: Finding[], runDir: string) {
  const paths = new Set(changed.map((item) => key(item.rootId, item.relativePath)));
  const rows = inventory.files.filter((row) => paths.has(key(row.rootId, row.relativePath)));
  const subset: Inventory = { ...inventory, scanId: `${inventory.scanId}-changes`, files: rows, totals: { pdfPhysical: rows.length, pdfByExtension: rows.filter((row) => row.extension === '.pdf').length, hashesUnique: new Set(rows.map((row) => row.sha256)).size, bytesTotal: rows.reduce((sum, row) => sum + row.sizeBytes, 0) } };
  const subsetPath = path.join(runDir, 'changed-files-manifest.json');
  const serialized = `${stableJson(subset)}\n`;
  const digest = createHash('sha256').update(serialized).digest('hex');
  await writeFile(subsetPath, serialized, { flag: 'wx' });
  await writeFile(subsetPath.replace(/\.json$/u, '.sha256'), `${digest}  changed-files-manifest.json\n`, { flag: 'wx' });
  const script = path.resolve(__dirname, 'ingest-institutional-pdfs.ts');
  try {
    await execFileAsync(process.execPath, [path.resolve(process.cwd(), 'node_modules/ts-node/dist/bin.js'), script, subsetPath], { cwd: process.cwd(), env: { ...process.env, BJC_INSTITUTIONAL_ARGS: '' }, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    return { status: 'SUCCESS', exitCode: 0 };
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? Number((error as { code: unknown }).code) : 1;
    throw new Error(`INCREMENTAL_INGEST_FAILED_EXIT_${Number.isFinite(code) ? code : 1}`);
  }
}

async function latestManifest() {
  const entries = await readdir(outputRoot, { withFileTypes: true }).catch(() => [] as Dirent[]);
  const candidates = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('incremental-')).map((entry) => path.join(outputRoot, entry.name, 'institutional-pdf-inventory.json')).sort().reverse();
  for (const candidate of candidates) {
    try { await readFile(candidate); return candidate; } catch { /* incomplete checkpoint; use earlier baseline */ }
  }
  return originalManifestPath;
}

function key(rootId: string, relativePath: string) { return `${rootId}\0${relativePath.normalize('NFC')}`; }
function inside(parent: string, child: string) { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); }
function chunks<T>(items: T[], size: number) { const values: T[][] = []; for (let i = 0; i < items.length; i += size) values.push(items.slice(i, i + size)); return values; }
function countChanges(items: Finding[]) { return Object.fromEntries(['NEW', 'MODIFIED', 'MISSING', 'UNCHANGED'].map((key) => [key, items.filter((item) => item.change === key).length])); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`; return JSON.stringify(value); }
function hashFile(filePath: string) { return new Promise<string>((resolve, reject) => { const digest = createHash('sha256'); const input = createReadStream(filePath); input.on('data', (chunk: Buffer) => digest.update(chunk)); input.on('error', reject); input.on('end', () => resolve(digest.digest('hex'))); }); }

if (require.main === module) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

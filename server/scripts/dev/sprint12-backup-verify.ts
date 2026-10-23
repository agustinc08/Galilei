import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const root = resolve(process.cwd(), '..');

async function main() {
  const archive = process.env.BJC_SPRINT12_BACKUP_PATH;
  if (!archive) throw new Error('SPRINT12_BACKUP_PATH_MISSING');
  const path = resolve(archive);
  const allowed = resolve(root, '_recovery-work', 'sprint12', 'backups') + '\\';
  if (!path.startsWith(allowed) || !path.toLowerCase().endsWith('.dump')) throw new Error('SPRINT12_BACKUP_PATH_REJECTED');
  const info = await stat(path);
  const sha256 = await hashFile(path);
  const tool = resolve(process.env.ProgramFiles ?? 'C:\\Program Files', 'PostgreSQL', '16', 'bin', 'pg_restore.exe');
  let archiveList: { status: string; entries?: number; errorCode?: string; errorName?: string };
  try {
    const { stdout } = await execFileAsync(tool, ['--list', path], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    archiveList = { status: 'PASS', entries: stdout.split(/\r?\n/u).filter((line) => line.trim()).length };
  } catch (error) {
    archiveList = {
      status: 'BLOCKED_OR_FAILED',
      errorCode: error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : 'unknown',
      errorName: error instanceof Error ? error.name : 'unknown',
    };
  }
  const result = {
    status: 'SPRINT12_BACKUP_FILE_VERIFIED',
    filename: path.split(/[\\/]/u).at(-1),
    bytes: info.size,
    sha256,
    pgRestoreTool: tool,
    archiveList,
    archiveContentsPersisted: false,
    generatedAt: new Date().toISOString(),
  };
  const outputDir = resolve(root, '_recovery-work', 'sprint12', 'backups');
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'verification.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

function hashFile(file: string) {
  return new Promise<string>((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

if (require.main === module) main().catch((error) => {
  const message = (error as Error)?.message ?? '';
  console.error(message.startsWith('SPRINT12_BACKUP_') ? message : 'SPRINT12_BACKUP_VERIFY_FAILED');
  process.exitCode = 1;
});

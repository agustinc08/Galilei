import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const root = path.resolve(process.cwd(), '..');
async function main() {
  const archive = process.env.BJC_SPRINT11_BACKUP_PATH;
  if (!archive) throw new Error('BACKUP_PATH_MISSING');
  const resolved = path.resolve(archive);
  const recoveryRoot = path.join(root, '_recovery-work') + path.sep;
  if (!resolved.startsWith(recoveryRoot) || path.extname(resolved).toLowerCase() !== '.dump') throw new Error('BACKUP_PATH_REJECTED');
  const info = await stat(resolved);
  const pgRestore = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PostgreSQL', '16', 'bin', 'pg_restore.exe');
  const { stdout } = await execFileAsync(pgRestore, ['--list', resolved], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const hash = await hashFile(resolved);
  console.log(JSON.stringify({ status: 'BACKUP_ARCHIVE_VERIFIED', bytes: info.size, sha256: hash, archiveEntries: stdout.split(/\r?\n/u).filter((line) => line.trim()).length }, null, 2));
}
function hashFile(file: string) {
  return new Promise<string>((resolve, reject) => {
    const digest = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk: Buffer) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(digest.digest('hex')));
  });
}
if (require.main === module) main().catch((error) => {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined;
  const details = error instanceof Error ? error.message.replace(/C:\\proyecto triple\\_recovery-work\\sprint11\\backups\\[^\s]+/giu, '[backup]') : 'unknown';
  console.error(error instanceof Error && /BACKUP_PATH/u.test(error.message) ? error.message : `BACKUP_ARCHIVE_VERIFY_FAILED; name=${error instanceof Error ? error.name : 'unknown'}; code=${code ?? 'none'}; detail=${details}`);
  process.exitCode = 1;
});

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const root = resolve(process.cwd(), '..');
const sprintLabel = process.env.BJC_SPRINT_INT1 === 'true' ? 'integration-int1' : process.env.BJC_SPRINT152 === 'true' ? 'sprint152' : process.env.BJC_SPRINT149 === 'true' ? 'sprint149' : process.env.BJC_SPRINT123 === 'true' ? 'sprint123' : 'sprint122';
const sprintNumber = sprintLabel === 'integration-int1' ? 'INT1' : sprintLabel.replace('sprint', '');
const backupRoot = resolve(root, '_recovery-work', sprintLabel, 'backups');
const phase = process.argv.includes('--final') ? 'final' : 'before-migration';

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
  const pgDump = resolve(process.env.ProgramFiles ?? 'C:\\Program Files', 'PostgreSQL', '16', 'bin', 'pg_dump.exe');
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const stem = `buscador_juridico_civil_dev-${sprintLabel}-${stamp}`;
  const customFile = resolve(backupRoot, `${stem}.dump`);
  const plainFile = resolve(backupRoot, `${stem}.sql`);
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(target.password), PGSSLMODE: 'disable' };
  delete (env as Record<string, string | undefined>).DATABASE_URL;
  await mkdir(backupRoot, { recursive: true });
  const common = ['--host=127.0.0.1', '--port=55432', '--username=bjc_dev', '--dbname=buscador_juridico_civil_dev', '--no-owner', '--no-privileges', '--no-password'];
  await execFileAsync(pgDump, [...common, '--format=custom', `--file=${customFile}`], { env, windowsHide: true, maxBuffer: 1024 * 1024 });
  await execFileAsync(pgDump, [...common, '--format=plain', '--encoding=UTF8', `--file=${plainFile}`], { env, windowsHide: true, maxBuffer: 1024 * 1024 });
  const [customStat, plainStat] = await Promise.all([stat(customFile), stat(plainFile)]);
  const [customSha256, plainSha256] = await Promise.all([hashFile(customFile), hashFile(plainFile)]);
  const report = {
    status: phase === 'final' ? `SPRINT${sprintNumber}_FINAL_BACKUP_PASS` : `SPRINT${sprintNumber}_PRE_MIGRATION_BACKUP_PASS`,
    generatedAt: new Date().toISOString(),
    target: { endpoint: '127.0.0.1:55432', database: 'buscador_juridico_civil_dev', role: 'bjc_dev' },
    backups: [
      { format: 'custom', path: customFile, bytes: customStat.size, sha256: customSha256 },
      { format: 'plain SQL UTF8', path: plainFile, bytes: plainStat.size, sha256: plainSha256 },
    ],
    passwordPersisted: false,
  };
  await writeFile(resolve(backupRoot, `manifest-${phase}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
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

main().catch((error) => {
  const message = (error as Error)?.message ?? '';
  console.error(message.startsWith('DEV_DATABASE_') ? message : 'SPRINT122_BACKUP_FAILED');
  process.exitCode = 1;
});

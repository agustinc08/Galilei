import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const root = resolve(process.cwd(), '..');
const backupRoot = resolve(root, '_recovery-work', 'sprint121', 'backups');
let currentStage = 'target-validation';

async function main() {
  const raw = process.env.DATABASE_URL;
  const mainRaw = process.env.BJC_SPRINT121_MAIN_DATABASE_URL;
  if (!raw || !mainRaw) throw new Error('TEMP_DATABASE_URL_MISSING');
  assertTarget(raw, 'buscador_juridico_civil_restore_test');
  assertTarget(mainRaw, 'buscador_juridico_civil_dev');
  const manifest = JSON.parse(await readFile(resolve(backupRoot, 'manifest.json'), 'utf8')) as {
    backups: Array<{ format: string; path: string; bytes: number; sha256: string }>;
  };
  const backup = manifest.backups.find((item) => item.format === 'plain SQL UTF8');
  if (!backup) throw new Error('PLAIN_SQL_BACKUP_MISSING');
  const backupPath = resolve(backup.path);
  if (!backupPath.toLowerCase().startsWith(`${backupRoot.toLowerCase()}\\`) || !backupPath.toLowerCase().endsWith('.sql')) throw new Error('RESTORE_BACKUP_PATH_REJECTED');
  currentStage = 'backup-integrity';
  const [info, sha256] = await Promise.all([stat(backupPath), hashFile(backupPath)]);
  if (info.size !== backup.bytes || sha256 !== backup.sha256) throw new Error('RESTORE_BACKUP_HASH_MISMATCH');
  const target = new URL(raw);
  const psql = resolve(process.env.ProgramFiles ?? 'C:\\Program Files', 'PostgreSQL', '16', 'bin', 'psql.exe');
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(target.password), PGSSLMODE: 'disable' };
  delete (env as Record<string, string | undefined>).DATABASE_URL;
  delete (env as Record<string, string | undefined>).BJC_SPRINT121_MAIN_DATABASE_URL;
  currentStage = 'psql-version';
  const version = await execFileAsync(psql, ['--version'], { env, windowsHide: true, maxBuffer: 4096 });
  if (!/psql \(PostgreSQL\) 16\./u.test(version.stdout)) throw new Error('PSQL_VERSION_REJECTED');
  console.log(JSON.stringify({ status: 'SPRINT121_PLAIN_RESTORE_STARTED', target: 'buscador_juridico_civil_restore_test', backupBytes: info.size, backupSha256: sha256, psqlVersion: version.stdout.trim(), queryTextPersisted: false }));
  currentStage = 'psql-restore';
  await execFileAsync(psql, [
    '--host=127.0.0.1', '--port=55432', '--username=bjc_dev',
    '--dbname=buscador_juridico_civil_restore_test', '--no-password',
    '--set=ON_ERROR_STOP=1', '--single-transaction', '--quiet', `--file=${backupPath}`,
  ], { env, windowsHide: true, maxBuffer: 1024 * 1024 });
  const output = resolve(root, '_recovery-work', 'sprint121', 'backups', 'restore-result.json');
  await mkdir(resolve(root, '_recovery-work', 'sprint121', 'backups'), { recursive: true });
  const result = { status: 'SPRINT121_PLAIN_RESTORE_PASS', completedAt: new Date().toISOString(), target: 'buscador_juridico_civil_restore_test@127.0.0.1:55432', method: 'PostgreSQL 16 psql plain SQL, one transaction', backupBytes: info.size, backupSha256: sha256, psqlVersion: version.stdout.trim(), passwordPersisted: false };
  const { writeFile } = await import('node:fs/promises');
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

function assertTarget(raw: string, database: string) {
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== `/${database}` || target.username !== 'bjc_dev') throw new Error('TEMP_DATABASE_TARGET_REJECTED');
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
  const code = (error as NodeJS.ErrnoException)?.code;
  const stderr = String((error as { stderr?: unknown })?.stderr ?? '').toLowerCase();
  const category = stderr.includes('password authentication failed') ? 'AUTH_REJECTED'
    : stderr.includes('permission denied') ? 'PERMISSION_DENIED'
      : stderr.includes('could not connect') ? 'CONNECTION_FAILED'
        : stderr.includes('already exists') ? 'OBJECT_EXISTS'
          : stderr.includes('does not exist') ? 'OBJECT_MISSING'
            : code === 'EACCES' || code === 'EPERM' ? 'EXECUTION_BLOCKED'
              : code === 'ENOENT' ? 'EXECUTABLE_MISSING'
                : code ? 'PROCESS_ERROR'
                  : 'UNCLASSIFIED';
  const safeCode = typeof code === 'string' && /^[A-Z0-9_]{1,32}$/u.test(code) ? code : 'NONE';
  console.error(message.startsWith('TEMP_DATABASE_') || message.startsWith('RESTORE_BACKUP_') || message.startsWith('PLAIN_SQL_') || message.startsWith('PSQL_')
    ? message
    : `SPRINT121_PLAIN_RESTORE_FAILED; stage=${currentStage}; category=${category}; code=${safeCode}`);
  process.exitCode = 1;
});

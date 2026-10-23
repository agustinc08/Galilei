import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(process.cwd(), '..', '..');
const recoveryRoot = path.join(workspaceRoot, '_recovery-work');
const backupRoot = process.env.BJC_DEV_BACKUP_DIR
  ? path.resolve(process.env.BJC_DEV_BACKUP_DIR)
  : path.join(recoveryRoot, 'sprint10', 'backups');
const backupLabel = process.env.BJC_DEV_BACKUP_LABEL ?? 'pre-sprint10';
const expected = {
  host: '127.0.0.1',
  port: '55432',
  database: 'buscador_juridico_civil_dev',
  user: 'bjc_dev',
};

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (
    target.protocol !== 'postgresql:' ||
    target.hostname !== expected.host ||
    target.port !== expected.port ||
    target.pathname !== `/${expected.database}` ||
    target.username !== expected.user
  ) {
    throw new Error('DEV_BACKUP_TARGET_REJECTED');
  }
  if (!backupRoot.startsWith(`${recoveryRoot}${path.sep}`) || !/^[a-z0-9-]{1,48}$/u.test(backupLabel)) {
    throw new Error('DEV_BACKUP_OUTPUT_REJECTED');
  }
  const pgDump = await findPgDump();
  await mkdir(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const output = path.join(
    backupRoot,
    `${expected.database}-${backupLabel}-${stamp}.dump`,
  );
  const env = {
    ...process.env,
    PGPASSWORD: decodeURIComponent(target.password),
    PGSSLMODE: 'disable',
  };
  delete (env as Record<string, string | undefined>).DATABASE_URL;
  await execFileAsync(
    pgDump,
    [
      '--host',
      expected.host,
      '--port',
      expected.port,
      '--username',
      expected.user,
      '--dbname',
      expected.database,
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--no-password',
      `--file=${output}`,
    ],
    { env, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  const info = await stat(output);
  const checksum = await hashFile(output);
  console.log(
    JSON.stringify(
      {
        status: 'DEV_BACKUP_COMPLETE',
        path: output,
        bytes: info.size,
        sha256: checksum,
        target: expected,
      },
      null,
      2,
    ),
  );
}

async function findPgDump() {
  const candidates = [
    path.join(
      process.env.ProgramFiles ?? 'C:\\Program Files',
      'PostgreSQL',
      '16',
      'bin',
      'pg_dump.exe',
    ),
  ];
  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      /* try the system path */
    }
  }
  const { stdout } = await execFileAsync('where.exe', ['pg_dump.exe'], {
    windowsHide: true,
    maxBuffer: 4096,
  });
  const candidate = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (!candidate) throw new Error('PG_DUMP_NOT_FOUND');
  return candidate;
}
function hashFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const digest = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('data', (chunk: Buffer) => digest.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(digest.digest('hex')));
  });
}
if (require.main === module)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

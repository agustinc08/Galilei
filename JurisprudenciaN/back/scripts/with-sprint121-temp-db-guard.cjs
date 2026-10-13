#!/usr/bin/env node
// Dedicated guard for the two explicitly approved temporary DEV databases.
// The general DEV guard stays restricted to buscador_juridico_civil_dev.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const envFile = path.resolve(__dirname, '..', '.env.development.local');
if (!fs.existsSync(envFile)) fail('TEMP_DB_GUARD=ABORT; DEV configuration is missing.');
const contents = fs.readFileSync(envFile, 'utf8');
const match = contents.match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/m);
if (!match) fail('TEMP_DB_GUARD=ABORT; DATABASE_URL is missing.');
const rawUrl = match[1].replace(/^(?:"(.*)"|'(.*)')$/u, (_all, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
let mainTarget;
try { mainTarget = new URL(rawUrl); } catch { fail('TEMP_DB_GUARD=ABORT; DATABASE_URL is invalid.'); }
if (mainTarget.protocol !== 'postgresql:' || mainTarget.hostname !== '127.0.0.1' || mainTarget.port !== '55432' || mainTarget.pathname !== '/buscador_juridico_civil_dev' || mainTarget.username !== 'bjc_dev') {
  fail('TEMP_DB_GUARD=ABORT; the source configuration is not the exact local DEV database.');
}

const destinations = {
  'restore-plain': 'buscador_juridico_civil_restore_test',
  'restore-verify': 'buscador_juridico_civil_restore_test',
  'migration-deploy': 'buscador_juridico_civil_migration_test',
  'migration-fixture': 'buscador_juridico_civil_migration_test',
  'migration-verify': 'buscador_juridico_civil_migration_test',
};
const commands = {
  'restore-plain': 'pnpm.cmd exec ts-node scripts/dev/sprint121-restore-plain.ts',
  'restore-verify': 'pnpm.cmd exec ts-node scripts/dev/sprint121-restore-verify.ts',
  'migration-deploy': 'pnpm.cmd exec ts-node scripts/dev/sprint121-migration-deploy.ts',
  'migration-fixture': 'pnpm.cmd exec ts-node scripts/dev/sprint121-migration-fixture.ts',
  'migration-verify': 'pnpm.cmd exec ts-node scripts/dev/sprint121-migration-verify.ts',
  cleanup: 'pnpm.cmd exec ts-node scripts/dev/sprint121-cleanup-temp-dbs.ts',
};
const action = process.argv[2];
const command = commands[action];
if (!command) fail(`Usage: node scripts/with-sprint121-temp-db-guard.cjs <${Object.keys(commands).join('|')}>`);
const database = destinations[action];
const target = new URL(rawUrl);
if (database) target.pathname = `/${database}`;
else if (action !== 'cleanup') fail('TEMP_DB_GUARD=ABORT; action has no approved target.');
const actionTarget = database ?? 'buscador_juridico_civil_dev (cleanup of two verified temporary DBs only)';
console.log(`TEMP_DB_GUARD=PASS; host=127.0.0.1; port=55432; database=${actionTarget}; role=bjc_dev`);
const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
  cwd: path.resolve(__dirname, '..'),
  env: {
    ...process.env,
    DATABASE_URL: database ? target.toString() : rawUrl,
    DOTENV_CONFIG_PATH: envFile,
    BJC_SPRINT121_MAIN_DATABASE_URL: rawUrl,
    BJC_SPRINT121_TEMP_DB_TEST: action === 'migration-fixture' ? '1' : '',
  },
  stdio: 'inherit',
  shell: false,
});
child.on('error', (error) => { console.error(`TEMP_DB_GUARD child process failed: ${error.message}`); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });

function fail(message) { console.error(message); process.exit(2); }

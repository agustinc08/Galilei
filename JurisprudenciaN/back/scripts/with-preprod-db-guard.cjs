#!/usr/bin/env node
// Preflight-only guard for an explicitly approved, isolated preproduction DB.
// Never prints DATABASE_URL, passwords, JWT secrets, or storage contents.
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const action = process.argv[2];
const allowedActions = new Set([
  'check', 'target-verify', 'migrate-status', 'migrate-deploy', 'db-report',
  'projection-rebuild', 'projection-verify', 'projection-repair',
]);
if (!allowedActions.has(action)) {
  console.error('Usage: node scripts/with-preprod-db-guard.cjs <check|target-verify|migrate-status|migrate-deploy|db-report|projection-rebuild|projection-verify|projection-repair>');
  process.exit(2);
}

let validated;
try {
  ({ validatePreproductionConfig: validate } = require('../dist/src/config/preprod-config.js'));
  validated = validate(process.env);
} catch (error) {
  console.error(`PREPROD_DB_GUARD=ABORT; ${error instanceof Error ? error.message : 'invalid configuration'}`);
  process.exit(2);
}

console.log(
  `PREPROD_DB_GUARD=PASS; target=${validated.databaseHost}:${validated.databasePort}/${validated.databaseName}; role=${validated.databaseUser}; action=${action}`,
);
if (action === 'check') {
  console.log('NO_DATABASE_CONNECTION=TRUE');
  process.exit(0);
}

const backDirectory = path.resolve(__dirname, '..');
const guardedEnv = { ...process.env, BJC_PREPROD_GUARD_VALIDATED: 'true' };
const targetCheck = spawnSync(process.execPath, [path.resolve(__dirname, 'preprod-target-verify.cjs')], {
  cwd: backDirectory,
  env: guardedEnv,
  stdio: 'inherit',
  shell: false,
});
if (targetCheck.error) {
  console.error(`Preproduction target verifier failed to start: ${targetCheck.error.message}`);
  process.exit(1);
}
if (targetCheck.status !== 0) process.exit(targetCheck.status ?? 1);
if (action === 'target-verify') process.exit(0);

if (action === 'db-report' || action.startsWith('projection-')) {
  const script = action === 'db-report' ? 'preprod-db-report.cjs' : 'preprod-search-projection.cjs';
  const scriptAction = action.replace('projection-', '');
  const child = spawn(process.execPath, [path.resolve(__dirname, script), ...(action === 'db-report' ? [] : [scriptAction])], {
    cwd: backDirectory,
    env: guardedEnv,
    stdio: 'inherit',
    shell: false,
  });
  child.on('error', (error) => {
    console.error(`Preproduction guarded command failed to start: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`Preproduction command exited with signal ${signal}.`);
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 1;
    }
  });
  return;
}

const prismaAction = action === 'migrate-status' ? 'status' : 'deploy';
const child = spawn(
  process.env.ComSpec || 'cmd.exe',
  ['/d', '/s', '/c', `pnpm.cmd exec prisma migrate ${prismaAction}`],
  {
    cwd: backDirectory,
    env: guardedEnv,
    stdio: 'inherit',
    shell: false,
  },
);
child.on('error', (error) => {
  console.error(`Preproduction Prisma command failed to start: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Prisma command exited with signal ${signal}.`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});

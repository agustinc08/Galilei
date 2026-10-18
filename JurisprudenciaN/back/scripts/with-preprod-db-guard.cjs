#!/usr/bin/env node
// Explicitly approved preproduction DB guard. Never prints URLs or credentials.
const path = require('node:path');
const { spawn } = require('node:child_process');

const action = process.argv[2];
const allowedActions = new Set([
  'check',
  'target-verify',
  'backup-plan',
  'migrate-status',
  'migrate-deploy',
  'db-report',
  'projection-rebuild',
  'projection-verify',
  'projection-repair',
]);
if (!allowedActions.has(action)) {
  console.error(
    'Usage: node scripts/with-preprod-db-guard.cjs <check|target-verify|backup-plan|migrate-status|migrate-deploy|db-report|projection-rebuild|projection-verify|projection-repair>',
  );
  process.exit(2);
}

async function main() {
  const backDirectory = path.resolve(__dirname, '..');
  let validated;
  try {
    const {
      validatePreproductionConfig,
    } = require('../dist/src/config/preprod-config.js');
    validated = validatePreproductionConfig(process.env, {
      includeApprovedDatabaseConfig: true,
    });
  } catch (error) {
    console.error(`PREPROD_DB_GUARD=ABORT; ${safeError(error)}`);
    process.exitCode = 2;
    return;
  }

  const database = validated.approvedDatabase;
  if (!database) {
    console.error(
      'PREPROD_DB_GUARD=ABORT; approved canonical database config unavailable.',
    );
    process.exitCode = 2;
    return;
  }
  console.log(
    `PREPROD_DB_GUARD=PASS; target=${database.host}:${database.port}/${database.database}; role=${database.user}; action=${action}`,
  );
  if (action === 'check') {
    console.log('NO_DATABASE_CONNECTION=TRUE');
    return;
  }

  try {
    const { verifyPreprodTarget } = require('./preprod-target-verify.cjs');
    await verifyPreprodTarget(database);
  } catch (error) {
    console.error(`PREPROD_TARGET=ABORT; ${safeError(error, database)}`);
    process.exitCode = 2;
    return;
  }
  if (action === 'target-verify') return;

  if (action === 'backup-plan') {
    const result = await runNodeChild(
      'preprod-pg-dump-plan.cjs',
      process.argv.slice(3),
      database,
      backDirectory,
    );
    process.exitCode = result;
    return;
  }

  if (action === 'db-report' || action.startsWith('projection-')) {
    const script =
      action === 'db-report'
        ? 'preprod-db-report.cjs'
        : 'preprod-search-projection.cjs';
    const scriptArgs =
      action === 'db-report' ? [] : [action.replace('projection-', '')];
    process.exitCode = await runNodeChild(
      script,
      scriptArgs,
      database,
      backDirectory,
    );
    return;
  }

  const prismaAction = action === 'migrate-status' ? 'status' : 'deploy';
  const guardedEnv = {
    ...process.env,
    DATABASE_URL: database.prismaCliUrl,
    BJC_PREPROD_GUARD_VALIDATED: 'true',
  };
  process.exitCode = await runProcess(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `pnpm.cmd exec prisma migrate ${prismaAction}`],
    { cwd: backDirectory, env: guardedEnv, stdio: 'inherit', shell: false },
  );
}

function runNodeChild(script, args, database, cwd) {
  const { DATABASE_URL: _databaseUrl, ...baseEnv } = process.env;
  const env = { ...baseEnv, BJC_PREPROD_GUARD_VALIDATED: 'true' };
  const {
    serializeCanonicalPreprodDatabase,
  } = require('./preprod-db-client.cjs');
  const input = serializeCanonicalPreprodDatabase(database);
  return runProcess(
    process.execPath,
    [path.resolve(__dirname, script), ...args],
    { cwd, env, input },
  );
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const { input, ...spawnOptions } = options;
    const stdio =
      input === undefined ? spawnOptions.stdio : ['pipe', 'inherit', 'inherit'];
    const child = spawn(command, args, { ...spawnOptions, stdio });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        console.error(`PREPROD_CHILD=FAIL; terminated by signal ${signal}.`);
        resolve(1);
      } else {
        resolve(code ?? 1);
      }
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

function safeError(error, database) {
  let message =
    error instanceof Error ? error.message : 'invalid configuration';
  for (const secret of [
    process.env.DATABASE_URL,
    database?.prismaCliUrl,
    database?.pgConfig?.password,
  ]) {
    if (secret) message = message.split(secret).join('[REDACTED]');
  }
  return message;
}

main().catch((error) => {
  console.error(`PREPROD_DB_GUARD=FAIL; ${safeError(error)}`);
  process.exitCode = 1;
});

#!/usr/bin/env node
const path = require('node:path');
const { validatePreproductionConfig } = require('../dist/src/config/preprod-config.js');
const { getApprovedDatabaseConfig } = require('../dist/src/config/approved-database-config.js');
const { buildPgDumpPlan } = require('./preprod-pg-dump-plan-lib.cjs');

if (process.env.BJC_PREPROD_GUARD_VALIDATED !== 'true') {
  console.error('PG_DUMP_PLAN=ABORT; use scripts/with-preprod-db-guard.cjs backup-plan.');
  process.exit(2);
}

try {
  const outputFile = process.argv[2];
  const validated = validatePreproductionConfig(process.env);
  const approved = getApprovedDatabaseConfig(process.env, 'preprod');
  if (
    validated.databaseHost !== approved.host ||
    Number(validated.databasePort) !== approved.port ||
    validated.databaseName !== approved.database ||
    validated.databaseUser !== approved.user
  ) throw new Error('PREPROD_DATABASE_CONFIG_DISAGREEMENT');
  const plan = buildPgDumpPlan(approved, process.env.PGPASSFILE, outputFile);
  process.stdout.write(`${JSON.stringify(plan)}\n`);
} catch (error) {
  console.error(`PG_DUMP_PLAN=ABORT; ${error instanceof Error ? error.message : 'invalid plan'}`);
  process.exit(2);
}

#!/usr/bin/env node
const path = require('node:path');
const { buildPgDumpPlan } = require('./preprod-pg-dump-plan-lib.cjs');
const { readCanonicalPreprodDatabase } = require('./preprod-db-client.cjs');

if (process.env.BJC_PREPROD_GUARD_VALIDATED !== 'true') {
  console.error(
    'PG_DUMP_PLAN=ABORT; use scripts/with-preprod-db-guard.cjs backup-plan.',
  );
  process.exit(2);
}

async function main() {
  const outputFile = process.argv[2];
  const approved = await readCanonicalPreprodDatabase();
  const plan = buildPgDumpPlan(approved, process.env.PGPASSFILE, outputFile);
  process.stdout.write(`${JSON.stringify(plan)}\n`);
}

main().catch((error) => {
  console.error(
    `PG_DUMP_PLAN=ABORT; ${error instanceof Error ? error.message : 'invalid plan'}`,
  );
  process.exitCode = 2;
});

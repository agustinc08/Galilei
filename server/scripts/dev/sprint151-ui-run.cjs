const path = require('node:path');
const { spawnSync } = require('node:child_process');

const front = path.resolve(__dirname, '../../../client');
const env = { ...process.env, CI: '1' };
const run = (args, cwd, label) => {
  const result = spawnSync('pnpm.cmd', args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: true,
  });
  if (result.error) {
    console.error(`${label} could not start: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
};

const testStatus = run(
  ['exec', 'playwright', 'test', 'tests/workspace-uat.e2e.spec.ts', '--config', 'playwright.config.ts'],
  front,
  'Sprint 15.1 UI tests',
);
const cleanupStatus = run(
  ['exec', 'ts-node', 'scripts/dev/sprint151-ui-cleanup.ts'],
  path.resolve(__dirname, '../..'),
  'Sprint 15.1 synthetic data cleanup',
);

if (cleanupStatus !== 0) {
  console.error('Sprint 15.1 UI test cleanup failed; inspect only synthetic S151UIE2E workspaces before retrying.');
  process.exit(2);
}
process.exit(testStatus);

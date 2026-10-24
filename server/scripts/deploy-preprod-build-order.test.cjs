'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const deployScript = fs.readFileSync(path.join(__dirname, 'deploy-preprod.ps1'), 'utf8');

test('preproduction backend preflight generates Prisma before compiling Nest', () => {
  const backendBlock = deployScript.match(
    /Push-Location \$backRoot\s*try \{([\s\S]*?)\} finally \{ Pop-Location \}/u,
  )?.[1];
  assert.ok(backendBlock, 'expected a guarded backend deployment block');

  const generate = backendBlock.indexOf(
    "Invoke-Checked 'Generate Prisma client for backend preflight' { pnpm run prisma:generate }",
  );
  const compile = backendBlock.indexOf(
    "Invoke-Checked 'Compile backend preflight' { pnpm exec nest build }",
  );
  const validate = backendBlock.indexOf("Invoke-Checked 'Validate preproduction target'");
  const migrate = backendBlock.indexOf("Invoke-Checked 'Apply reviewed migrations'");
  const releaseBuild = backendBlock.indexOf("Invoke-Checked 'Build backend release' { pnpm build }");

  assert.ok(generate >= 0, 'must explicitly generate Prisma client for a clean checkout');
  assert.ok(compile > generate, 'Nest preflight must run after Prisma client generation');
  assert.ok(validate > compile, 'preproduction target guard must remain after build preflight');
  assert.ok(migrate > validate, 'migration deploy must remain after target validation');
  assert.ok(releaseBuild > migrate, 'release build must remain after reviewed migrations');
});

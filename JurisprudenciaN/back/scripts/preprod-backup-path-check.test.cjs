'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const checker = path.join(__dirname, 'preprod-backup-path-check.cjs');

test('backup output reservation rejects overlap with each environment storage root', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-backup-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const roots = {
    DEV: path.join(root, 'dev'),
    PREPROD: path.join(root, 'preprod'),
    PRODUCTION: path.join(root, 'production'),
  };
  Object.values(roots).forEach((storage) => fs.mkdirSync(storage));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(vault);
  const passFile = path.join(vault, 'preprod.pgpass');
  fs.writeFileSync(passFile, 'synthetic-passfile-test-only');

  for (const [environment, storage] of Object.entries(roots)) {
    for (const candidate of [storage, path.join(storage, 'nested-backup')]) {
      const result = run(candidate, roots, passFile);
      assert.notEqual(result.status, 0, `${environment} overlap was accepted`);
      assert.match(result.stderr, new RegExp(`BJC_CORPUS_STORAGE_OVERLAP_${environment}`, 'u'));
    }
  }
  const ancestor = run(root, roots, passFile);
  assert.notEqual(ancestor.status, 0, 'common ancestor of storage roots was accepted');
  assert.match(ancestor.stderr, /BJC_CORPUS_STORAGE_OVERLAP_/u);

  const safe = run(path.join(root, 'separate-backups', 'run-1'), roots, passFile);
  assert.equal(safe.status, 0, safe.stderr);
  assert.match(safe.stdout, /BACKUP_PATH_ISOLATION=PASS/u);

  for (const storage of Object.values(roots)) {
    const credentialInStorage = path.join(storage, 'vault', 'preprod.pgpass');
    fs.mkdirSync(path.dirname(credentialInStorage));
    fs.writeFileSync(credentialInStorage, 'synthetic-passfile-test-only');
    const result = run(path.join(root, 'safe-backup-output'), roots, credentialInStorage);
    assert.notEqual(result.status, 0, 'passfile inside environment storage was accepted');
    assert.match(result.stderr, /BJC_CORPUS_STORAGE_OVERLAP_/u);
    fs.rmSync(path.join(root, 'safe-backup-output'), { recursive: true, force: true });
  }

  const outputRoot = path.join(root, 'backup-output');
  const outputNestedPassFile = path.join(outputRoot, 'vault', 'preprod.pgpass');
  fs.mkdirSync(path.dirname(outputNestedPassFile), { recursive: true });
  fs.writeFileSync(outputNestedPassFile, 'synthetic-passfile-test-only');
  const outputOverlap = run(outputRoot, roots, outputNestedPassFile);
  assert.notEqual(outputOverlap.status, 0, 'passfile inside backup output was accepted');
  assert.match(outputOverlap.stderr, /BJC_CORPUS_STORAGE_OVERLAP_BACKUP_OUTPUT/u);
});

test('backup path checker fails closed when any environment storage reference is missing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-backup-path-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const roots = {
    DEV: path.join(root, 'dev'),
    PREPROD: path.join(root, 'preprod'),
    PRODUCTION: path.join(root, 'production'),
  };
  Object.values(roots).forEach((storage) => fs.mkdirSync(storage));
  const passFile = path.join(root, 'vault', 'preprod.pgpass');
  fs.mkdirSync(path.dirname(passFile));
  fs.writeFileSync(passFile, 'synthetic-passfile-test-only');
  const result = run(path.join(root, 'backup'), { ...roots, PRODUCTION: '' }, passFile);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BJC_CORPUS_STORAGE_REFERENCE_REQUIRED_PRODUCTION/u);
});

function run(output, roots, passFile) {
  return spawnSync(process.execPath, [checker, output, passFile], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BJC_DEV_CORPUS_STORAGE_PATH: roots.DEV,
      BJC_CORPUS_STORAGE_PATH: roots.PREPROD,
      BJC_PRODUCTION_CORPUS_STORAGE_PATH: roots.PRODUCTION,
    },
  });
}

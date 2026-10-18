'use strict';

const path = require('node:path');
const { assertDisjointStorageReference } = require('../dist/src/config/storage-isolation.js');

const outputPath = process.argv[2];
const passFile = process.argv[3];
if (!outputPath || !passFile) {
  process.stderr.write('BACKUP_OUTPUT_AND_PASSFILE_PATHS_REQUIRED\n');
  process.exit(2);
}

try {
  const storageRoots = [
    { name: 'DEV', path: process.env.BJC_DEV_CORPUS_STORAGE_PATH || '' },
    { name: 'PREPROD', path: process.env.BJC_CORPUS_STORAGE_PATH || '' },
    { name: 'PRODUCTION', path: process.env.BJC_PRODUCTION_CORPUS_STORAGE_PATH || '' },
  ];
  const canonicalOutput = assertDisjointStorageReference(
    outputPath,
    storageRoots,
  );
  const passFileDirectory = path.dirname(passFile);
  assertDisjointStorageReference(passFileDirectory, [
    ...storageRoots,
    { name: 'BACKUP_OUTPUT', path: canonicalOutput },
  ]);
  process.stdout.write('BACKUP_PATH_ISOLATION=PASS\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'BACKUP_PATH_ISOLATION_FAILED'}\n`);
  process.exit(1);
}

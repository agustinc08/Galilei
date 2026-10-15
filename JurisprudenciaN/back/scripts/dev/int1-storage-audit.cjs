#!/usr/bin/env node
'use strict';

const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { readdir, stat } = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

const raw = process.env.DATABASE_URL ?? '';
const root = path.resolve(process.cwd(), '../../_dev-corpus-storage-test');
const expected = {
  protocol: 'postgresql:',
  hostname: '127.0.0.1',
  port: '55432',
  database: 'buscador_juridico_civil_dev',
  role: 'bjc_dev',
};

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256');
    const input = createReadStream(file);
    input.on('data', (chunk) => digest.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(digest.digest('hex')));
  });
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = path.resolve(directory, entry.name);
    if (!file.startsWith(`${root}${path.sep}`)) {
      throw new Error('STORAGE_PATH_ESCAPED_TEST_ROOT');
    }
    if (entry.isDirectory()) files.push(...(await walk(file)));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

async function main() {
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (
    target.protocol !== expected.protocol ||
    target.hostname !== expected.hostname ||
    target.port !== expected.port ||
    target.pathname !== `/${expected.database}` ||
    target.username !== expected.role
  ) {
    throw new Error('DEV_DATABASE_TARGET_REJECTED');
  }

  const files = await walk(root);
  const entries = await Promise.all(
    files.map(async (file) => {
      const info = await stat(file);
      return {
        path: path.relative(root, file).replaceAll(path.sep, '/'),
        bytes: info.size,
        sha256: await hashFile(file),
      };
    }),
  );
  const client = new Client({ connectionString: raw });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (
      await client.query(`
        SELECT current_database() AS database, current_user AS role,
               host(inet_server_addr()) AS address, inet_server_port() AS port
      `)
    ).rows[0];
    if (
      identity.database !== expected.database ||
      identity.role !== expected.role ||
      identity.address !== expected.hostname ||
      Number(identity.port) !== Number(expected.port)
    ) {
      throw new Error('DEV_DATABASE_IDENTITY_REJECTED');
    }

    const hashes = entries.map((entry) => entry.sha256);
    const references = hashes.length
      ? (
          await client.query(
            `SELECT id, "documentId" AS "documentId", "storageKey" AS "storageKey", "originalFilename" AS "originalFilename", sha256, "sizeBytes"::text AS bytes FROM "CorpusDocumentFile" WHERE sha256 = ANY($1::text[])`,
            [hashes],
          )
        ).rows
      : [];
    await client.query('COMMIT');

    const bySha = new Map(references.map((row) => [row.sha256, row]));
    console.log(
      JSON.stringify(
        {
          status: 'INT1_STORAGE_READ_ONLY_AUDIT_PASS',
          target: {
            host: identity.address,
            port: Number(identity.port),
            database: identity.database,
            role: identity.role,
          },
          root,
          files: entries.map((entry) => ({
            ...entry,
            filenameMatchesSha256:
              path.basename(entry.path).replace(/\.[^.]+$/u, '') ===
              entry.sha256,
            corpusFileReference: bySha.has(entry.sha256)
              ? bySha.get(entry.sha256)
              : null,
          })),
          count: entries.length,
          databaseReferences: references.length,
          writes: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'INT1_STORAGE_AUDIT_FAILED');
  process.exitCode = 1;
});

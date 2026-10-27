#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');

const serverRoot = path.resolve(__dirname, '../..');
const migrationRoot = path.join(serverRoot, 'prisma', 'migrations');
const targetMigration = '20261026160000_institutional_ingestion_workflow';
const databaseUrl = process.env.DATABASE_URL;
const databaseName = `sprint7_migration_${randomBytes(5).toString('hex')}`;
const fixtureRoot = path.join(
  serverRoot,
  'runtime',
  `sprint7-incremental-migration-${databaseName}`,
);
const targetUrl = databaseUrl ? new URL(databaseUrl) : null;
const adminUrl = targetUrl ? new URL(targetUrl) : null;
let admin;
let databaseCreated = false;

function assertQaTarget() {
  if (
    process.env.BJC_SPRINT7_ALLOW_ISOLATED_DATABASE !== 'true' ||
    process.env.BJC_DEEP_QA_ALLOW_ISOLATED_DATABASE !== 'true' ||
    process.env.BJC_DEPLOYMENT_ENV !== 'development' ||
    !targetUrl ||
    targetUrl.protocol !== 'postgresql:' ||
    targetUrl.hostname !== '127.0.0.1' ||
    targetUrl.port !== '55434' ||
    targetUrl.username !== 'bjc_dev' ||
    targetUrl.pathname !== '/buscador_juridico_civil_deepqa' ||
    targetUrl.search ||
    targetUrl.hash ||
    !targetUrl.password
  ) {
    throw new Error('SPRINT7_MIGRATION_TARGET_REJECTED');
  }
  if (!/^sprint7_migration_[a-f0-9]{10}$/u.test(databaseName)) {
    throw new Error('SPRINT7_MIGRATION_DATABASE_NAME_REJECTED');
  }
  targetUrl.pathname = `/${databaseName}`;
  adminUrl.pathname = '/postgres';
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function copyMigrationDirectory(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);
    if (entry.isDirectory())
      await fs.cp(source, destination, { recursive: true });
    else if (entry.isFile()) await fs.copyFile(source, destination);
  }
}

async function prepareMigrationFixture() {
  const migrations = (await fs.readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const targetIndex = migrations.indexOf(targetMigration);
  if (targetIndex !== migrations.length - 1 || targetIndex !== 37) {
    throw new Error('SPRINT7_MIGRATION_ORDER_OR_COUNT_UNEXPECTED');
  }

  const fixtureMigrations = path.join(fixtureRoot, 'migrations');
  await fs.mkdir(fixtureMigrations, { recursive: true });
  for (const migration of migrations.slice(0, targetIndex)) {
    await copyMigrationDirectory(
      path.join(migrationRoot, migration),
      path.join(fixtureMigrations, migration),
    );
  }
  await fs.copyFile(
    path.join(serverRoot, 'prisma', 'schema.prisma'),
    path.join(fixtureRoot, 'schema.prisma'),
  );
  await fs.copyFile(
    path.join(migrationRoot, 'migration_lock.toml'),
    path.join(fixtureMigrations, 'migration_lock.toml'),
  );
  await fs.writeFile(
    path.join(fixtureRoot, 'prisma.config.ts'),
    [
      'import "dotenv/config";',
      'import { defineConfig } from "prisma/config";',
      'export default defineConfig({',
      '  schema: "./schema.prisma",',
      '  migrations: { path: "./migrations" },',
      '  datasource: { url: process.env["DATABASE_URL"] },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
  return {
    fixtureMigrations,
    configPath: path.join(fixtureRoot, 'prisma.config.ts'),
  };
}

function runDeploy(configPath, connectionString) {
  const configArgument = path
    .relative(serverRoot, configPath)
    .split(path.sep)
    .join('/');
  const command = `pnpm.cmd exec prisma migrate deploy --config ${configArgument}`;
  const result = spawnSync(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', command],
    {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: connectionString },
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`SPRINT7_MIGRATION_DEPLOY_FAILED_${result.status}`);
  }
}

async function inspectDatabase(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        (SELECT count(*)::int FROM "_prisma_migrations"
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrations,
        to_regclass('public."InstitutionalIngestion"') IS NOT NULL AS workflow_table
    `);
    return result.rows[0];
  } finally {
    await client.end();
  }
}

async function main() {
  assertQaTarget();
  admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const identity = await admin.query(`
    SELECT current_database() AS database, current_user AS role,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      (SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user) AS can_create_database
  `);
  const server = identity.rows[0];
  if (
    server.database !== 'postgres' ||
    server.role !== 'bjc_dev' ||
    server.host !== '127.0.0.1' ||
    server.port !== 55434 ||
    server.can_create_database !== true
  ) {
    console.error(`SPRINT7_MIGRATION_IDENTITY=${JSON.stringify(server)}`);
    throw new Error('SPRINT7_MIGRATION_ADMIN_IDENTITY_REJECTED');
  }
  await admin.query(
    `CREATE DATABASE ${quoteIdentifier(databaseName)} OWNER bjc_dev`,
  );
  databaseCreated = true;
  const { fixtureMigrations, configPath } = await prepareMigrationFixture();

  runDeploy(configPath, targetUrl.toString());
  const before = await inspectDatabase(targetUrl.toString());
  if (before.migrations !== 37 || before.workflow_table) {
    throw new Error('SPRINT7_INCREMENTAL_BASE_NOT_37');
  }
  console.log('SPRINT7_INCREMENTAL_BASE=37; workflow_table=absent');

  await copyMigrationDirectory(
    path.join(migrationRoot, targetMigration),
    path.join(fixtureMigrations, targetMigration),
  );
  runDeploy(configPath, targetUrl.toString());
  const after = await inspectDatabase(targetUrl.toString());
  if (after.migrations !== 38 || !after.workflow_table) {
    throw new Error('SPRINT7_INCREMENTAL_TARGET_NOT_38');
  }
  console.log('SPRINT7_INCREMENTAL_TARGET=38; workflow_table=present');
  console.log('SPRINT7_INCREMENTAL_MIGRATION=PASS');
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'SPRINT7_MIGRATION_FAILED',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (admin) {
      if (databaseCreated) {
        try {
          await admin.query(`DROP DATABASE ${quoteIdentifier(databaseName)}`);
          console.log('SPRINT7_INCREMENTAL_DATABASE_CLEANUP=PASS');
        } catch {
          console.error('SPRINT7_INCREMENTAL_DATABASE_CLEANUP=FAIL');
          process.exitCode = 1;
        }
      }
      await admin.end().catch(() => undefined);
    }
    await fs
      .rm(fixtureRoot, { recursive: true, force: true })
      .catch(() => undefined);
  });

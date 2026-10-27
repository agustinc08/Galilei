'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { validateDevelopmentDatabaseUrl } = require('./database-url-guard.cjs');

const root = path.resolve(__dirname, '../..');
const prismaRoot = path.join(root, 'prisma');
const migrationRoot = path.join(prismaRoot, 'migrations');
const prismaCli = path.join(
  root,
  'node_modules',
  'prisma',
  'build',
  'index.js',
);
const suite9PageAwareQa =
  process.env.BJC_SPRINT9_PAGE_AWARE_ALLOW_ISOLATED_DATABASE === 'true';
const suite8Qa =
  process.env.BJC_SPRINT8_ALLOW_ISOLATED_DATABASE === 'true' &&
  !suite9PageAwareQa;
const sprintLabel = suite9PageAwareQa ? 'SPRINT9' : 'SPRINT8';
const qaPort = suite9PageAwareQa ? '55435' : '55434';
const allowedDatabases = suite9PageAwareQa
  ? [
      'galilei_page_aware_suite9_fresh',
      'galilei_page_aware_suite9_from37',
      'galilei_page_aware_suite9_from38',
      'galilei_page_aware_suite9_from39',
    ]
  : [
      'galilei_ocr_review_suite8_fresh',
      'galilei_ocr_review_suite8_from37',
      'galilei_ocr_review_suite8_from38',
    ];
const expectedFinalMigrations = [
  '20261026160000_institutional_ingestion_workflow',
  '20261026170000_ocr_human_review',
];

function safeDatabaseUrl(database) {
  const source = process.env.DATABASE_URL;
  if (!source || (!suite8Qa && !suite9PageAwareQa)) {
    throw new Error('PAGE_AWARE_MIGRATION_MATRIX_REQUIRES_GUARDED_QA');
  }
  const url = new URL(source);
  url.pathname = `/${database}`;
  const validation = validateDevelopmentDatabaseUrl(url.toString(), {
    allowIsolatedQa: true,
    allowSuite8Qa: suite8Qa,
    allowSuite9PageAwareQa: suite9PageAwareQa,
    deploymentEnvironment: process.env.BJC_DEPLOYMENT_ENV,
  });
  if (
    !validation.valid ||
    url.hostname !== '127.0.0.1' ||
    url.port !== qaPort ||
    decodeURIComponent(url.username) !== 'bjc_dev'
  ) {
    throw new Error(`PAGE_AWARE_MIGRATION_MATRIX_TARGET_REJECTED:${database}`);
  }
  return url.toString();
}

async function inspectDatabase(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const identity = await client.query(
      "SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS host, inet_server_port() AS port, current_setting('server_version_num')::integer AS version_num",
    );
    const tableCount = await client.query(
      "SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    const connectedHost = String(identity.rows[0].host ?? '').split('/')[0];
    if (
      connectedHost !== '127.0.0.1' ||
      Number(identity.rows[0].port) !== Number(qaPort) ||
      identity.rows[0].role !== 'bjc_dev' ||
      Number(identity.rows[0].version_num) < 160000
    ) {
      throw new Error(
        `${sprintLabel}_MIGRATION_MATRIX_SERVER_IDENTITY_MISMATCH:${JSON.stringify(identity.rows[0])}`,
      );
    }
    if (Number(tableCount.rows[0].count) !== 0) {
      throw new Error(
        `${sprintLabel}_MIGRATION_MATRIX_DATABASE_NOT_EMPTY:${identity.rows[0].database}`,
      );
    }
    return {
      database: identity.rows[0].database,
      role: identity.rows[0].role,
      host: connectedHost,
      port: Number(identity.rows[0].port),
      serverVersion: Number(identity.rows[0].version_num),
      publicTablesBefore: Number(tableCount.rows[0].count),
    };
  } finally {
    await client.end();
  }
}

function runPrismaDeploy(connectionString, configPath) {
  const result = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--config', configPath],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: connectionString },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, '[redacted-postgresql-url]')
    .trim();
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `SPRINT8_PRISMA_MIGRATE_DEPLOY_FAILED:${result.status ?? 'unknown'}\n${output}`,
    );
  }
  return output;
}

async function migrationCount(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      'SELECT count(*) FILTER (WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL)::integer AS applied, count(*) FILTER (WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL)::integer AS unfinished FROM "_prisma_migrations"',
    );
    return {
      applied: result.rows[0].applied,
      unfinished: result.rows[0].unfinished,
    };
  } finally {
    await client.end();
  }
}

function temporaryConfig(schemaPath, migrationsPath) {
  const configPath = path.join(
    root,
    `.prisma.suite8-matrix-${process.pid}-${crypto.randomBytes(5).toString('hex')}.config.ts`,
  );
  const config = `import "dotenv/config";\nimport { defineConfig } from "prisma/config";\nexport default defineConfig({\n  schema: ${JSON.stringify(schemaPath)},\n  migrations: { path: ${JSON.stringify(migrationsPath)} },\n  datasource: { url: process.env["DATABASE_URL"] },\n});\n`;
  fs.writeFileSync(configPath, config, { encoding: 'utf8', flag: 'wx' });
  return configPath;
}

function ensureMigrationPrefix(migrations, count) {
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), 'galilei-suite8-migrations-'),
  );
  const prefix = path.join(scratch, 'migrations');
  fs.mkdirSync(prefix, { recursive: true });
  fs.copyFileSync(
    path.join(migrationRoot, 'migration_lock.toml'),
    path.join(prefix, 'migration_lock.toml'),
  );
  for (const migration of migrations.slice(0, count)) {
    fs.cpSync(
      path.join(migrationRoot, migration),
      path.join(prefix, migration),
      {
        recursive: true,
        errorOnExist: true,
      },
    );
  }
  return { scratch, prefix };
}

async function executeMatrix() {
  const migrations = fs
    .readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (
    migrations.length !== 39 ||
    JSON.stringify(migrations.slice(-2)) !==
      JSON.stringify(expectedFinalMigrations)
  ) {
    throw new Error(`${sprintLabel}_MIGRATION_MATRIX_EXPECTED_37_PLUS_TWO_MIGRATIONS`);
  }
  if (!fs.existsSync(prismaCli))
    throw new Error(`${sprintLabel}_PRISMA_CLI_NOT_FOUND`);

  const destructiveTokens =
    /\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM)\b/iu;
  const lastTwoSql = expectedFinalMigrations.map((name) =>
    fs.readFileSync(path.join(migrationRoot, name, 'migration.sql'), 'utf8'),
  );
  if (lastTwoSql.some((sql) => destructiveTokens.test(sql))) {
    throw new Error(`${sprintLabel}_MIGRATION_MATRIX_DESTRUCTIVE_SQL_DETECTED`);
  }

  const reports = [];
  for (const database of allowedDatabases) {
    const connectionString = safeDatabaseUrl(database);
    const before = await inspectDatabase(connectionString);
    const startedAt = new Date().toISOString();
    const started = Date.now();
    let baselineCount = 0;
    let temporary = null;
    let configPath = null;
    try {
      if (database.endsWith('_from37')) baselineCount = 37;
      if (database.endsWith('_from38')) baselineCount = 38;
      if (database.endsWith('_from39')) baselineCount = 39;
      if (baselineCount > 0) {
        temporary = ensureMigrationPrefix(migrations, baselineCount);
        const schemaPath = path.join(temporary.scratch, 'schema.prisma');
        fs.copyFileSync(path.join(prismaRoot, 'schema.prisma'), schemaPath);
        configPath = temporaryConfig(schemaPath, temporary.prefix);
        runPrismaDeploy(connectionString, configPath);
        const baselineApplied = await migrationCount(connectionString);
        if (
          baselineApplied.applied !== baselineCount ||
          baselineApplied.unfinished !== 0
        ) {
          throw new Error(
            `SPRINT8_BASELINE_MIGRATION_COUNT_MISMATCH:${database}`,
          );
        }
      }

      runPrismaDeploy(connectionString, path.join(root, 'prisma.config.ts'));
      const finalApplied = await migrationCount(connectionString);
      if (finalApplied.applied !== 39 || finalApplied.unfinished !== 0) {
        throw new Error(`SPRINT8_FINAL_MIGRATION_COUNT_MISMATCH:${database}`);
      }
      const report = {
        database,
        path: `${baselineCount || 0}->39`,
        baselineMigrations: baselineCount,
        targetMigrations: finalApplied.applied,
        baselineStartedFromEmptyQaDatabase: true,
        publicTablesBefore: before.publicTablesBefore,
        server: `${before.host}:${before.port}`,
        role: before.role,
        postgresVersion: before.serverVersion,
        finalUnfinishedMigrations: finalApplied.unfinished,
        destructiveSqlInSuite7AndSuite8: false,
        startedAt,
        durationMs: Date.now() - started,
        status: 'PASS',
      };
      reports.push(report);
      console.log(`${sprintLabel}_MIGRATION_MATRIX_PASS ${JSON.stringify(report)}`);
    } finally {
      if (configPath && fs.existsSync(configPath)) fs.rmSync(configPath);
      if (temporary?.scratch && fs.existsSync(temporary.scratch)) {
        fs.rmSync(temporary.scratch, { recursive: true, force: true });
      }
    }
  }

  const evidenceFile = process.env.BJC_DEV_DB_GUARD_ENV_FILE
    ? path.resolve(
        path.dirname(process.env.BJC_DEV_DB_GUARD_ENV_FILE),
        'evidence',
        'migration-matrix.json',
      )
    : null;
  if (evidenceFile) {
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(
      evidenceFile,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'w' },
    );
  }
  return reports;
}

executeMatrix().catch((error) => {
  const safeMessage = String(error?.message ?? error)
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, '[redacted-postgresql-url]')
    .slice(0, 6000);
  console.error(safeMessage);
  process.exitCode = 1;
});

import type { PoolConfig } from 'pg';
import { getApprovedDatabaseConfig } from './approved-database-config';
import { resolveDeploymentEnvironment } from './deployment-environment';

/** In-memory PostgreSQL config issued by the single environment-aware resolver. */
declare const approvedRuntimePgConfig: unique symbol;
export type ApprovedRuntimePgConfig = PoolConfig & {
  readonly [approvedRuntimePgConfig]: true;
};

/** Resolve the one approved PostgreSQL target for the active deployment. */
export function getRuntimeDatabasePoolConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApprovedRuntimePgConfig {
  const environment = resolveDeploymentEnvironment(env);
  if (environment === 'development') {
    const databaseUrl = env.DATABASE_URL;
    if (!databaseUrl?.trim()) {
      throw new Error('DATABASE_URL no esta definida en el .env');
    }
    return getDevelopmentDatabaseConfig(databaseUrl.trim(), env);
  }
  return getApprovedDatabaseConfig(env, environment)
    .pgConfig as ApprovedRuntimePgConfig;
}

/** Parse local DEV or an explicitly enabled, allowlisted isolated-QA input. */
export function getDevelopmentDatabaseConfig(
  databaseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): ApprovedRuntimePgConfig {
  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL no es una URL válida para el entorno local.');
  }

  const suite9PageAwareQaEnabled =
    env.BJC_SPRINT9_PAGE_AWARE_ALLOW_ISOLATED_DATABASE === 'true';
  const suite8QaEnabled =
    env.BJC_SPRINT8_ALLOW_ISOLATED_DATABASE === 'true' &&
    !suite9PageAwareQaEnabled;
  const suite7QaEnabled =
    env.BJC_SPRINT7_ALLOW_ISOLATED_DATABASE === 'true' &&
    !suite8QaEnabled &&
    !suite9PageAwareQaEnabled;
  const deepQaEnabled =
    env.BJC_DEEP_QA_ALLOW_ISOLATED_DATABASE === 'true' &&
    !suite7QaEnabled &&
    !suite8QaEnabled &&
    !suite9PageAwareQaEnabled;
  const isolatedQaEnabled =
    suite9PageAwareQaEnabled ||
    suite8QaEnabled ||
    suite7QaEnabled ||
    deepQaEnabled;
  const allowedQaDatabases = suite9PageAwareQaEnabled
    ? [
        'galilei_page_aware_suite9_fresh',
        'galilei_page_aware_suite9_from37',
        'galilei_page_aware_suite9_from38',
        'galilei_page_aware_suite9_from39',
      ]
    : suite8QaEnabled
      ? [
          'galilei_ocr_review_suite8_qa',
          'galilei_ocr_review_suite8_fresh',
          'galilei_ocr_review_suite8_from37',
          'galilei_ocr_review_suite8_from38',
        ]
      : ['buscador_juridico_civil_deepqa'];
  if (isolatedQaEnabled && env.BJC_DEPLOYMENT_ENV !== 'development') {
    throw new Error(
      suite8QaEnabled
        ? 'SPRINT8_QA_DATABASE_REQUIRES_DEVELOPMENT_RUNTIME'
        : suite9PageAwareQaEnabled
          ? 'SPRINT9_PAGE_AWARE_QA_DATABASE_REQUIRES_DEVELOPMENT_RUNTIME'
          : 'DEEP_QA_DATABASE_REQUIRES_DEVELOPMENT_RUNTIME',
    );
  }
  if (
    isolatedQaEnabled &&
    (target.protocol !== 'postgresql:' ||
      target.hostname !== '127.0.0.1' ||
      target.port !== (suite9PageAwareQaEnabled ? '55435' : '55434') ||
      !allowedQaDatabases.includes(target.pathname.slice(1)) ||
      target.username !== 'bjc_dev' ||
      target.search !== '' ||
      target.hash !== '' ||
      databaseUrl.includes('?') ||
      databaseUrl.includes('#') ||
      !target.password)
  ) {
    throw new Error(
      suite8QaEnabled
        ? 'SPRINT8_QA_DATABASE_TARGET_REJECTED'
        : suite9PageAwareQaEnabled
          ? 'SPRINT9_PAGE_AWARE_QA_DATABASE_TARGET_REJECTED'
          : 'DEEP_QA_DATABASE_TARGET_REJECTED',
    );
  }

  if (
    !isolatedQaEnabled &&
    (target.protocol !== 'postgresql:' ||
      target.hostname !== '127.0.0.1' ||
      target.port !== '55432' ||
      target.pathname !== '/buscador_juridico_civil_dev' ||
      target.username !== 'bjc_dev' ||
      target.search !== '' ||
      target.hash !== '' ||
      databaseUrl.includes('?') ||
      databaseUrl.includes('#') ||
      !target.password)
  ) {
    throw new Error(
      'El backend fuera de producción sólo puede conectarse a bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev.',
    );
  }

  let password: string;
  try {
    password = decodeURIComponent(target.password);
  } catch {
    throw new Error(
      'DATABASE_URL contiene una contraseña codificada inválida.',
    );
  }
  if (!password) {
    throw new Error(
      'El backend fuera de producción sólo puede conectarse a bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev.',
    );
  }

  return {
    host: '127.0.0.1',
    port: suite9PageAwareQaEnabled ? 55435 : isolatedQaEnabled ? 55434 : 55432,
    database: isolatedQaEnabled
      ? target.pathname.slice(1)
      : 'buscador_juridico_civil_dev',
    user: 'bjc_dev',
    password,
  } as ApprovedRuntimePgConfig;
}

/**
 * Search unit fixtures and DEV-only scripts historically passed a URL directly.
 * Such strings always pass the exact local DEV parser; they cannot select a
 * remote or PREPROD/PROD target.
 */
export function resolveSearchDatabasePoolConfig(
  input?: string | ApprovedRuntimePgConfig,
  env: NodeJS.ProcessEnv = process.env,
): ApprovedRuntimePgConfig {
  if (typeof input === 'string') {
    if (env.BJC_SPRINT121_TEMP_DB_TEST === '1') {
      return getMigrationFixtureDatabaseConfig(input.trim(), env);
    }
    return getDevelopmentDatabaseConfig(input.trim(), env);
  }
  if (input) return input;
  return getRuntimeDatabasePoolConfig(env);
}

/** Only the guarded local migration-fixture runner may use this isolated DB. */
function getMigrationFixtureDatabaseConfig(
  databaseUrl: string,
  env: NodeJS.ProcessEnv,
): ApprovedRuntimePgConfig {
  if (resolveDeploymentEnvironment(env) !== 'development') {
    throw new Error('MIGRATION_FIXTURE_DATABASE_REQUIRES_DEV');
  }
  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new Error('MIGRATION_FIXTURE_DATABASE_TARGET_REJECTED');
  }
  if (
    target.protocol !== 'postgresql:' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '55432' ||
    target.pathname !== '/buscador_juridico_civil_migration_test' ||
    target.username !== 'bjc_dev' ||
    !target.password ||
    target.search ||
    target.hash
  ) {
    throw new Error('MIGRATION_FIXTURE_DATABASE_TARGET_REJECTED');
  }
  let password: string;
  try {
    password = decodeURIComponent(target.password);
  } catch {
    throw new Error('MIGRATION_FIXTURE_DATABASE_TARGET_REJECTED');
  }
  return {
    host: '127.0.0.1',
    port: 55432,
    database: 'buscador_juridico_civil_migration_test',
    user: 'bjc_dev',
    password,
  } as ApprovedRuntimePgConfig;
}

/** Legacy API retained for DEV scripts; production callers use approved config. */
export function assertDevelopmentDatabaseUrl(databaseUrl: string) {
  if (process.env.NODE_ENV === 'production') return databaseUrl;
  getDevelopmentDatabaseConfig(databaseUrl);
  return databaseUrl;
}

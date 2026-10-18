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
    return getDevelopmentDatabaseConfig(databaseUrl.trim());
  }
  return getApprovedDatabaseConfig(env, environment)
    .pgConfig as ApprovedRuntimePgConfig;
}

/** Parse DEV input once, reject every URL option, and give pg explicit fields only. */
export function getDevelopmentDatabaseConfig(
  databaseUrl: string,
): ApprovedRuntimePgConfig {
  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL no es una URL válida para el entorno local.');
  }

  if (
    target.protocol !== 'postgresql:' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '55432' ||
    target.pathname !== '/buscador_juridico_civil_dev' ||
    target.username !== 'bjc_dev' ||
    target.search !== '' ||
    target.hash !== '' ||
    databaseUrl.includes('?') ||
    databaseUrl.includes('#') ||
    !target.password
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
    port: 55432,
    database: 'buscador_juridico_civil_dev',
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
    return getDevelopmentDatabaseConfig(input.trim());
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

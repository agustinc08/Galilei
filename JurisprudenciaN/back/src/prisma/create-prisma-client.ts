import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import type { PoolConfig } from 'pg';
import { getApprovedDatabaseConfig } from '../config/approved-database-config';
import { validateRuntimeEnvironment } from '../config/runtime-preflight';

let currentPrismaPool: Pool | null = null;

export function getPrismaClientOptions() {
  const environment = validateRuntimeEnvironment(process.env);
  let pool: Pool;
  if (environment === 'development') {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl?.trim()) {
      throw new Error('DATABASE_URL no esta definida en el .env');
    }
    pool = new Pool(getDevelopmentDatabaseConfig(databaseUrl.trim()));
  } else {
    const database = getApprovedDatabaseConfig(process.env, environment);
    pool = new Pool(database.pgConfig);
  }
  currentPrismaPool = pool;
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });

  return {
    adapter,
  };
}

export function getPrismaPoolDiagnostics() {
  if (!currentPrismaPool) return null;
  const total = currentPrismaPool.totalCount;
  const idle = Math.min(currentPrismaPool.idleCount, total);
  return {
    total,
    active: Math.max(0, total - idle),
    idle,
    waiting: currentPrismaPool.waitingCount,
    max: currentPrismaPool.options.max ?? 10,
  };
}

/** Refuse accidental remote or non-DEV connections in every non-production runtime. */
export function assertDevelopmentDatabaseUrl(databaseUrl: string) {
  if (process.env.NODE_ENV === 'production') return databaseUrl;

  getDevelopmentDatabaseConfig(databaseUrl);
  return databaseUrl;
}

/** Parse DEV input once, reject every URL option, and give pg explicit fields only. */
export function getDevelopmentDatabaseConfig(databaseUrl: string): PoolConfig {
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
  };
}

export function createPrismaClient() {
  return new PrismaClient(getPrismaClientOptions());
}

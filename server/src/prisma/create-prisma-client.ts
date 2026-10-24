import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { Pool } from 'pg';
import { getRuntimeDatabasePoolConfig } from '../config/runtime-database-config';
import { validateRuntimeEnvironment } from '../config/runtime-preflight';

export {
  assertDevelopmentDatabaseUrl,
  getDevelopmentDatabaseConfig,
} from '../config/runtime-database-config';

let currentPrismaPool: Pool | null = null;

export function getPrismaClientOptions() {
  validateRuntimeEnvironment(process.env);
  const pool = new Pool(getRuntimeDatabasePoolConfig(process.env));
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

export function createPrismaClient() {
  return new PrismaClient(getPrismaClientOptions());
}

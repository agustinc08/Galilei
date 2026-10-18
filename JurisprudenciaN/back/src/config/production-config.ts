import { getApprovedDatabaseConfig } from './approved-database-config';
import { resolveDeploymentEnvironment } from './deployment-environment';
import {
  assertRequiredEnvironment,
  RATE_LIMIT_KEYS,
  validateHttpsOrigins,
  validateJwtConfiguration,
  validateRateLimitConfiguration,
} from './runtime-config-validators';
import { validateIsolatedStorage } from './storage-isolation';
import { readOpenSearchConfig } from '../busqueda/opensearch/opensearch-config';

/** Production must declare distinct DB, Search, storage, TLS, and public-origin identities. */
export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env) {
  if (resolveDeploymentEnvironment(env) !== 'production') {
    throw new Error(
      'PRODUCTION_REQUIRES_NODE_PRODUCTION_AND_BJC_DEPLOYMENT_ENV_PRODUCTION',
    );
  }

  assertRequiredEnvironment(env, [
    'DATABASE_URL',
    'BJC_PRODUCTION_DATABASE_APPROVED',
    'BJC_PRODUCTION_DB_HOST',
    'BJC_PRODUCTION_DB_PORT',
    'BJC_PRODUCTION_DB_NAME',
    'BJC_PRODUCTION_DB_USER',
    'BJC_PRODUCTION_DB_CA_PATH',
    'JWT_SECRET',
    'JWT_EXPIRES_IN',
    'FRONTEND_URL',
    'BJC_CORPUS_STORAGE_PATH',
    'BJC_DEV_CORPUS_STORAGE_PATH',
    'BJC_PREPROD_CORPUS_STORAGE_PATH',
    'BJC_API_BIND_HOST',
    'API_RATE_LIMIT_ENABLED',
    'BJC_PRODUCTION_REPLICAS',
    'BJC_SEARCH_STATEMENT_TIMEOUT_MS',
    'SEARCH_ENGINE',
    'OPENSEARCH_NODE',
    'OPENSEARCH_USERNAME',
    'OPENSEARCH_PASSWORD',
    'OPENSEARCH_INDEX_ALIAS',
    'OPENSEARCH_INDEX_PREFIX',
    ...RATE_LIMIT_KEYS,
  ]);

  if (env.SEARCH_ENGINE !== 'opensearch') {
    throw new Error(
      'SEARCH_ENGINE production debe ser opensearch; no se permite fallback.',
    );
  }
  if (
    env.BUSQUEDA_DEBUG === 'true' ||
    env.BJC_SEARCH_PROFILE === 'true' ||
    env.BJC_SEARCH_EXPLAIN_CAPTURE === 'true' ||
    env.OPENSEARCH_CANDIDATE_ONLY === 'true'
  ) {
    throw new Error(
      'Los flags de diagnóstico/candidato Search deben permanecer desactivados en production.',
    );
  }
  validateJwtConfiguration(env);
  const database = getApprovedDatabaseConfig(env, 'production');
  const frontendOrigins = validateHttpsOrigins(env);

  if (env.BJC_API_BIND_HOST !== '127.0.0.1') {
    throw new Error(
      'BJC_API_BIND_HOST production debe ser 127.0.0.1 detrás del proxy del mismo host.',
    );
  }

  const search = readOpenSearchConfig(env);
  if (
    search.alias !== 'galilei-production-search-active' ||
    search.indexPrefix !== 'galilei-production-search'
  ) {
    throw new Error(
      'OpenSearch production requiere el namespace galilei-production-search.',
    );
  }

  const storageRoot = validateIsolatedStorage(env.BJC_CORPUS_STORAGE_PATH!, [
    { name: 'DEV', path: env.BJC_DEV_CORPUS_STORAGE_PATH! },
    { name: 'PREPROD', path: env.BJC_PREPROD_CORPUS_STORAGE_PATH! },
  ]);
  validateRateLimitConfiguration(env, 'BJC_PRODUCTION_REPLICAS', 'production');

  return {
    databaseHost: database.host,
    databasePort: String(database.port),
    databaseName: database.database,
    databaseUser: database.user,
    databaseCaPath: database.caPath,
    databaseTlsMode: database.tlsMode,
    frontendOrigins,
    storageRoot,
    searchNode: search.node,
    searchAlias: search.alias,
    searchIndexPrefix: search.indexPrefix,
  };
}

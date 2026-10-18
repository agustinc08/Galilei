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

/** Validates every PREPROD resource identity before Nest creates any providers. */
export function validatePreproductionConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { includeApprovedDatabaseConfig?: boolean } = {},
) {
  if (resolveDeploymentEnvironment(env) !== 'preprod') {
    throw new Error(
      'PREPROD_REQUIRES_NODE_PRODUCTION_AND_BJC_DEPLOYMENT_ENV_PREPROD',
    );
  }

  assertRequiredEnvironment(env, [
    'DATABASE_URL',
    'BJC_PREPROD_DATABASE_APPROVED',
    'BJC_PREPROD_DB_HOST',
    'BJC_PREPROD_DB_PORT',
    'BJC_PREPROD_DB_NAME',
    'BJC_PREPROD_DB_USER',
    'BJC_PREPROD_DB_CA_PATH',
    'JWT_SECRET',
    'JWT_EXPIRES_IN',
    'FRONTEND_URL',
    'BJC_CORPUS_STORAGE_PATH',
    'BJC_DEV_CORPUS_STORAGE_PATH',
    'BJC_PRODUCTION_CORPUS_STORAGE_PATH',
    'BJC_API_BIND_HOST',
    'API_RATE_LIMIT_ENABLED',
    'BJC_PREPROD_REPLICAS',
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
      'SEARCH_ENGINE preprod debe ser opensearch; no se permite fallback.',
    );
  }
  if (hasSearchDiagnosticFlags(env)) {
    throw new Error(
      'Los flags de diagnóstico/candidato Search deben permanecer desactivados en preprod.',
    );
  }
  validateJwtConfiguration(env);
  const database = getApprovedDatabaseConfig(env, 'preprod');
  const frontendOrigins = validateHttpsOrigins(env);

  if (env.BJC_API_BIND_HOST !== '127.0.0.1') {
    throw new Error(
      'BJC_API_BIND_HOST preprod debe ser 127.0.0.1 detrás del proxy del mismo host.',
    );
  }

  const search = readOpenSearchConfig(env);
  if (
    search.alias !== 'galilei-preprod-search-active' ||
    search.indexPrefix !== 'galilei-preprod-search'
  ) {
    throw new Error(
      'OpenSearch preprod requiere el namespace galilei-preprod-search.',
    );
  }

  const storageRoot = validateIsolatedStorage(env.BJC_CORPUS_STORAGE_PATH!, [
    { name: 'DEV', path: env.BJC_DEV_CORPUS_STORAGE_PATH! },
    { name: 'PRODUCTION', path: env.BJC_PRODUCTION_CORPUS_STORAGE_PATH! },
  ]);
  validateRateLimitConfiguration(env, 'BJC_PREPROD_REPLICAS', 'preprod');

  const validated = {
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
  return options.includeApprovedDatabaseConfig
    ? { ...validated, approvedDatabase: database }
    : validated;
}

function hasSearchDiagnosticFlags(env: NodeJS.ProcessEnv) {
  return (
    env.BUSQUEDA_DEBUG === 'true' ||
    env.BJC_SEARCH_PROFILE === 'true' ||
    env.BJC_SEARCH_EXPLAIN_CAPTURE === 'true' ||
    env.OPENSEARCH_CANDIDATE_ONLY === 'true'
  );
}

import fs from 'node:fs';
import { Client } from '@opensearch-project/opensearch';
import {
  resolveDeploymentEnvironment,
  type DeploymentEnvironment,
} from '../../config/deployment-environment';

export type OpenSearchConfig = {
  node: string;
  alias: string;
  indexPrefix: string;
  requestTimeoutMs: number;
  maxRetries: number;
  allowInsecureLocal: boolean;
  clientOptions: ConstructorParameters<typeof Client>[0];
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
export const SEARCH_NAMESPACES = {
  development: {
    alias: 'galilei-search-active',
    indexPrefix: 'galilei-search',
  },
  preprod: {
    alias: 'galilei-preprod-search-active',
    indexPrefix: 'galilei-preprod-search',
  },
  production: {
    alias: 'galilei-production-search-active',
    indexPrefix: 'galilei-production-search',
  },
} as const;

export function readOpenSearchConfig(
  env: NodeJS.ProcessEnv = process.env,
): OpenSearchConfig {
  const node = (env.OPENSEARCH_NODE ?? '').trim();
  if (!node) throw new Error('OPENSEARCH_NODE_REQUIRED');
  let endpoint: URL;
  try {
    endpoint = new URL(node);
  } catch {
    throw new Error('OPENSEARCH_NODE_INVALID');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('OPENSEARCH_NODE_INVALID');
  }

  const deploymentEnvironment = resolveDeploymentEnvironment(env);
  const allowInsecureLocal = env.OPENSEARCH_ALLOW_INSECURE_LOCAL === 'true';
  const isProduction = deploymentEnvironment !== 'development';
  const isLoopback = LOOPBACK_HOSTS.has(
    endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, ''),
  );
  if (endpoint.protocol === 'http:') {
    if (!allowInsecureLocal || isProduction || !isLoopback) {
      throw new Error('OPENSEARCH_INSECURE_ENDPOINT_REJECTED');
    }
  }
  if (
    allowInsecureLocal &&
    (isProduction || !isLoopback || endpoint.protocol !== 'http:')
  ) {
    throw new Error('OPENSEARCH_INSECURE_LOCAL_SCOPE_REJECTED');
  }

  const username = env.OPENSEARCH_USERNAME?.trim();
  const password = env.OPENSEARCH_PASSWORD;
  if (Boolean(username) !== Boolean(password))
    throw new Error('OPENSEARCH_CREDENTIAL_PAIR_REQUIRED');
  if (isProduction && (!username || !password))
    throw new Error('OPENSEARCH_PRODUCTION_CREDENTIALS_REQUIRED');

  const requestTimeoutMs = integerInRange(
    env.OPENSEARCH_REQUEST_TIMEOUT_MS,
    5000,
    500,
    30000,
  );
  const maxRetries = integerInRange(env.OPENSEARCH_MAX_RETRIES, 2, 0, 5);
  const aliasValue = env.OPENSEARCH_INDEX_ALIAS?.trim();
  const indexPrefixValue = env.OPENSEARCH_INDEX_PREFIX?.trim();
  if (isProduction && (!aliasValue || !indexPrefixValue)) {
    throw new Error('OPENSEARCH_INDEX_ALIAS_AND_PREFIX_REQUIRED');
  }
  const alias = aliasValue ?? SEARCH_NAMESPACES.development.alias;
  if (
    !/^[a-z0-9][a-z0-9._-]{2,127}$/u.test(alias) ||
    alias.startsWith('_') ||
    alias.startsWith('-') ||
    alias.startsWith('+')
  ) {
    throw new Error('OPENSEARCH_INDEX_ALIAS_INVALID');
  }
  const indexPrefix =
    indexPrefixValue ?? SEARCH_NAMESPACES.development.indexPrefix;
  if (
    !/^[a-z0-9][a-z0-9._-]{2,60}$/u.test(indexPrefix) ||
    indexPrefix.startsWith('.') ||
    indexPrefix.endsWith('.') ||
    indexPrefix.endsWith('-')
  ) {
    throw new Error('OPENSEARCH_INDEX_PREFIX_INVALID');
  }
  validateEnvironmentNamespace(deploymentEnvironment, alias, indexPrefix);

  let ca: Buffer | undefined;
  const caPath = env.OPENSEARCH_CA_PATH?.trim();
  if (caPath) {
    try {
      ca = fs.readFileSync(caPath);
    } catch {
      throw new Error('OPENSEARCH_CA_UNREADABLE');
    }
  }

  return {
    node: endpoint.origin,
    alias,
    indexPrefix,
    requestTimeoutMs,
    maxRetries,
    allowInsecureLocal,
    clientOptions: {
      node: endpoint.origin,
      ...(username && password ? { auth: { username, password } } : {}),
      ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
      requestTimeout: requestTimeoutMs,
      maxRetries,
    },
  };
}

function validateEnvironmentNamespace(
  environment: DeploymentEnvironment,
  alias: string,
  indexPrefix: string,
) {
  if (environment === 'development') return;
  const expected = SEARCH_NAMESPACES[environment];
  if (alias !== expected.alias || indexPrefix !== expected.indexPrefix) {
    throw new Error(
      `OPENSEARCH_${environment.toUpperCase()}_NAMESPACE_INVALID`,
    );
  }
}

function integerInRange(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/u.test(value.trim()))
    throw new Error('OPENSEARCH_NUMERIC_CONFIG_INVALID');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error('OPENSEARCH_NUMERIC_CONFIG_INVALID');
  }
  return parsed;
}

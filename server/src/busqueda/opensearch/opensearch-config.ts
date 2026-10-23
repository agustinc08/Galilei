import fs from 'node:fs';
import { Client } from '@opensearch-project/opensearch';
import {
  resolveDeploymentEnvironment,
  type DeploymentEnvironment,
} from '../../config/deployment-environment';
import {
  SEARCH_INDEX_SCHEMA_VERSION,
  SEARCH_INDEX_SCHEMA_VERSION_V4,
  type SearchIndexSchemaVersion,
} from './opensearch-mapping';

export type OpenSearchConfig = {
  node: string;
  topology: 'principal-cutover' | 'fresh-v4';
  alias: string;
  indexPrefix: string;
  searchTarget: string;
  searchSchemaVersion: SearchIndexSchemaVersion;
  readOnlyCandidate: boolean;
  trustedPhysicalWriter: boolean;
  requestTimeoutMs: number;
  maxRetries: number;
  allowInsecureLocal: boolean;
  clientOptions: ConstructorParameters<typeof Client>[0];
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const PHYSICAL_INDEX = /^galilei-search-v00[34]-\d{8}t\d{9}z-[a-f0-9]{8}$/u;
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
  const topologyValue = env.BJC_SEARCH_TOPOLOGY?.trim();
  if (
    topologyValue !== undefined &&
    topologyValue !== 'principal-cutover' &&
    topologyValue !== 'fresh-v4'
  ) {
    throw new Error('OPENSEARCH_TOPOLOGY_INVALID');
  }
  const topology = topologyValue ?? 'principal-cutover';
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

  const schemaVersionValue = env.OPENSEARCH_SEARCH_SCHEMA_VERSION?.trim();
  if (
    schemaVersionValue &&
    schemaVersionValue !== '3' &&
    schemaVersionValue !== '4'
  )
    throw new Error('OPENSEARCH_SCHEMA_VERSION_INVALID');
  const searchSchemaVersion: SearchIndexSchemaVersion =
    schemaVersionValue === '4'
      ? SEARCH_INDEX_SCHEMA_VERSION_V4
      : SEARCH_INDEX_SCHEMA_VERSION;
  if (topology === 'fresh-v4' && searchSchemaVersion !== 4) {
    throw new Error('OPENSEARCH_FRESH_V4_SCHEMA_REQUIRED');
  }
  const rawSearchTarget = env.OPENSEARCH_SEARCH_TARGET;
  const searchTargetValue = rawSearchTarget?.trim();
  if (rawSearchTarget !== undefined && !searchTargetValue) {
    throw new Error('OPENSEARCH_SEARCH_TARGET_INVALID');
  }
  const searchTarget = searchTargetValue ?? alias;
  const readOnlyCandidateValue = env.OPENSEARCH_READ_ONLY_CANDIDATE?.trim();
  if (
    readOnlyCandidateValue !== undefined &&
    readOnlyCandidateValue !== '' &&
    readOnlyCandidateValue !== 'true' &&
    readOnlyCandidateValue !== 'false'
  ) {
    throw new Error('OPENSEARCH_READ_ONLY_CANDIDATE_INVALID');
  }
  const readOnlyCandidate = readOnlyCandidateValue === 'true';
  const trustedWriterValue = env.OPENSEARCH_TRUSTED_PHYSICAL_WRITE?.trim();
  if (
    trustedWriterValue !== undefined &&
    trustedWriterValue !== 'true' &&
    trustedWriterValue !== 'false'
  ) {
    throw new Error('OPENSEARCH_TRUSTED_PHYSICAL_WRITE_INVALID');
  }
  const trustedPhysicalWriter = trustedWriterValue === 'true';
  if (searchTargetValue) {
    if (
      !PHYSICAL_INDEX.test(searchTarget) ||
      !searchTarget.includes(
        `-v${String(searchSchemaVersion).padStart(3, '0')}-`,
      ) ||
      isProduction ||
      !isLoopback
    ) {
      throw new Error('OPENSEARCH_SEARCH_TARGET_INVALID');
    }
  }
  if (
    readOnlyCandidate &&
    (searchSchemaVersion !== SEARCH_INDEX_SCHEMA_VERSION_V4 ||
      !searchTargetValue ||
      isProduction ||
      !isLoopback)
  ) {
    throw new Error('OPENSEARCH_READ_ONLY_CANDIDATE_SCOPE_INVALID');
  }
  if (
    trustedPhysicalWriter &&
    (readOnlyCandidate ||
      !searchTargetValue ||
      !PHYSICAL_INDEX.test(searchTarget) ||
      !searchTarget.includes(
        `-v${String(searchSchemaVersion).padStart(3, '0')}-`,
      ) ||
      isProduction ||
      !isLoopback)
  ) {
    throw new Error('OPENSEARCH_TRUSTED_PHYSICAL_WRITE_SCOPE_INVALID');
  }
  if (
    searchSchemaVersion === SEARCH_INDEX_SCHEMA_VERSION_V4 &&
    !readOnlyCandidate &&
    !trustedPhysicalWriter &&
    topology !== 'fresh-v4'
  ) {
    throw new Error('OPENSEARCH_V4_REQUIRES_READ_ONLY_CANDIDATE');
  }
  if (
    topology === 'fresh-v4' &&
    !readOnlyCandidate &&
    !trustedPhysicalWriter &&
    searchTarget !== alias
  ) {
    throw new Error('OPENSEARCH_FRESH_V4_ALIAS_TARGET_REQUIRED');
  }
  if (searchTargetValue && !readOnlyCandidate && !trustedPhysicalWriter) {
    throw new Error('OPENSEARCH_SEARCH_TARGET_OPERATOR_MODE_REQUIRED');
  }

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
    topology,
    alias,
    indexPrefix,
    searchTarget,
    searchSchemaVersion,
    readOnlyCandidate,
    trustedPhysicalWriter,
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

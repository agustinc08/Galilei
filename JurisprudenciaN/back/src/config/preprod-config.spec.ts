import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePreproductionConfig } from './preprod-config';

describe('validatePreproductionConfig', () => {
  let storageRoot: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-preprod-config-'));
    env = {
      NODE_ENV: 'production',
      BJC_DEPLOYMENT_ENV: 'preprod',
      DATABASE_URL:
        'postgresql://preprod_user:synthetic-test-password@preprod-db.internal:5432/buscador_juridico_civil_preprod?sslmode=verify-full',
      BJC_PREPROD_DATABASE_APPROVED: 'true',
      BJC_PREPROD_DB_HOST: 'preprod-db.internal',
      BJC_PREPROD_DB_PORT: '5432',
      BJC_PREPROD_DB_NAME: 'buscador_juridico_civil_preprod',
      BJC_PREPROD_DB_USER: 'preprod_user',
      JWT_SECRET: 'a7K9m2Q4v8N1x5C3p6R0t9W2b4H7d1F8z3L5',
      JWT_EXPIRES_IN: '2h',
      FRONTEND_URL: 'https://preprod.example.intra',
      BJC_CORPUS_STORAGE_PATH: storageRoot,
      BJC_API_BIND_HOST: '127.0.0.1',
      OPENSEARCH_NODE: 'https://preprod-search.internal:9200',
      OPENSEARCH_USERNAME: 'preprod-search-user',
      OPENSEARCH_PASSWORD: 'synthetic-search-password',
      OPENSEARCH_INDEX_ALIAS: 'galilei-preprod-search-active',
      OPENSEARCH_INDEX_PREFIX: 'galilei-preprod-search',
      API_RATE_LIMIT_ENABLED: 'true',
      BJC_PREPROD_REPLICAS: '1',
      API_RATE_LIMIT_WINDOW_MS: '60000',
      API_RATE_LIMIT_AUTH_MAX: '15',
      API_RATE_LIMIT_SEARCH_MAX: '120',
      API_RATE_LIMIT_MATCHES_MAX: '120',
      API_RATE_LIMIT_DOWNLOAD_MAX: '120',
      BJC_SEARCH_STATEMENT_TIMEOUT_MS: '4000',
      SEARCH_ENGINE: 'opensearch',
    };
  });

  afterEach(() => fs.rmSync(storageRoot, { recursive: true, force: true }));

  it('accepts an explicitly approved isolated configuration without connecting to its database', () => {
    expect(validatePreproductionConfig(env)).toMatchObject({
      databaseHost: 'preprod-db.internal',
      databasePort: '5432',
      databaseName: 'buscador_juridico_civil_preprod',
      databaseUser: 'preprod_user',
      frontendOrigins: ['https://preprod.example.intra'],
      storageRoot,
      searchNode: 'https://preprod-search.internal:9200',
      searchAlias: 'galilei-preprod-search-active',
      searchIndexPrefix: 'galilei-preprod-search',
    });
  });

  it('rejects missing critical values and does not fall back to local defaults', () => {
    delete env.JWT_EXPIRES_IN;
    expect(() => validatePreproductionConfig(env)).toThrow(/JWT_EXPIRES_IN/);
  });

  it('rejects a database URL that does not match the approved target or points to DEV', () => {
    env.DATABASE_URL =
      'postgresql://bjc_dev:synthetic@127.0.0.1:55432/buscador_juridico_civil_dev?sslmode=verify-full';
    expect(() => validatePreproductionConfig(env)).toThrow(/coincid/);
  });

  it('rejects a database name outside the dedicated preproduction identity', () => {
    env.BJC_PREPROD_DB_NAME = 'buscador_juridico_civil';
    env.DATABASE_URL =
      'postgresql://preprod_user:synthetic-test-password@preprod-db.internal:5432/buscador_juridico_civil?sslmode=verify-full';
    expect(() => validatePreproductionConfig(env)).toThrow(
      /identidad preprod aprobada/,
    );
  });

  it('requires PostgreSQL TLS with full certificate and hostname verification', () => {
    env.DATABASE_URL =
      'postgresql://preprod_user:synthetic-test-password@preprod-db.internal:5432/buscador_juridico_civil_preprod';
    expect(() => validatePreproductionConfig(env)).toThrow(/TLS verify-full/);
  });

  it('rejects loopback even when the declared preproduction identity matches it', () => {
    env.DATABASE_URL =
      'postgresql://preprod_user:synthetic@127.0.0.1:55432/buscador_juridico_civil_preprod?sslmode=verify-full';
    env.BJC_PREPROD_DB_HOST = '127.0.0.1';
    env.BJC_PREPROD_DB_PORT = '55432';
    expect(() => validatePreproductionConfig(env)).toThrow(/coincid/);
    env.DATABASE_URL =
      'postgresql://preprod_user:synthetic@[::1]:55432/buscador_juridico_civil_preprod?sslmode=verify-full';
    env.BJC_PREPROD_DB_HOST = '::1';
    expect(() => validatePreproductionConfig(env)).toThrow(/coincid/);
  });

  it('requires explicit HTTPS CORS origins', () => {
    env.FRONTEND_URL = 'http://localhost:4002';
    expect(() => validatePreproductionConfig(env)).toThrow(/HTTPS/);
  });

  it('rejects multiple replicas while rate limits are process-local', () => {
    env.BJC_PREPROD_REPLICAS = '2';
    expect(() => validatePreproductionConfig(env)).toThrow(/una sola réplica/);
  });

  it('rejects the local DEV storage fallback', () => {
    env.BJC_CORPUS_STORAGE_PATH = path.resolve(
      storageRoot,
      '..',
      '_dev-corpus-storage',
    );
    expect(() => validatePreproductionConfig(env)).toThrow(/storage DEV/);
  });

  it('requires a loopback API bind behind the approved local reverse proxy', () => {
    env.BJC_API_BIND_HOST = '0.0.0.0';
    expect(() => validatePreproductionConfig(env)).toThrow(/BJC_API_BIND_HOST/);
  });

  it('requires a dedicated physical index prefix and alias for preproduction', () => {
    env.OPENSEARCH_INDEX_ALIAS = 'galilei-search-active';
    env.OPENSEARCH_INDEX_PREFIX = 'galilei-search';
    expect(() => validatePreproductionConfig(env)).toThrow(
      /alias y prefijo físico exclusivos/,
    );
  });

  it('requires authenticated HTTPS OpenSearch without accepting a development endpoint', () => {
    env.OPENSEARCH_NODE = 'http://127.0.0.1:9200';
    env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';
    expect(() => validatePreproductionConfig(env)).toThrow(
      'OPENSEARCH_INSECURE_ENDPOINT_REJECTED',
    );
  });

  it('requires the certified Search engine and rejects query/debug capture flags', () => {
    env.SEARCH_ENGINE = 'postgres';
    expect(() => validatePreproductionConfig(env)).toThrow(
      /SEARCH_ENGINE preprod/,
    );
    env.SEARCH_ENGINE = 'opensearch';
    env.BUSQUEDA_DEBUG = 'true';
    expect(() => validatePreproductionConfig(env)).toThrow(
      /flags de diagnóstico/,
    );
  });
});

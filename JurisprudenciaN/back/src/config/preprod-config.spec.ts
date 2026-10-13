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
      DATABASE_URL: 'postgresql://preprod_user:synthetic-test-password@preprod-db.internal:5432/buscador_juridico_civil_preprod',
      BJC_PREPROD_DATABASE_APPROVED: 'true',
      BJC_PREPROD_DB_HOST: 'preprod-db.internal',
      BJC_PREPROD_DB_PORT: '5432',
      BJC_PREPROD_DB_NAME: 'buscador_juridico_civil_preprod',
      BJC_PREPROD_DB_USER: 'preprod_user',
      JWT_SECRET: 'a7K9m2Q4v8N1x5C3p6R0t9W2b4H7d1F8z3L5',
      JWT_EXPIRES_IN: '2h',
      FRONTEND_URL: 'https://preprod.example.intra',
      BJC_CORPUS_STORAGE_PATH: storageRoot,
      API_RATE_LIMIT_ENABLED: 'true',
      BJC_PREPROD_REPLICAS: '1',
      API_RATE_LIMIT_WINDOW_MS: '60000',
      API_RATE_LIMIT_AUTH_MAX: '15',
      API_RATE_LIMIT_SEARCH_MAX: '120',
      API_RATE_LIMIT_MATCHES_MAX: '120',
      API_RATE_LIMIT_DOWNLOAD_MAX: '120',
      BJC_SEARCH_STATEMENT_TIMEOUT_MS: '4000',
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
    });
  });

  it('rejects missing critical values and does not fall back to local defaults', () => {
    delete env.JWT_EXPIRES_IN;
    expect(() => validatePreproductionConfig(env)).toThrow(/JWT_EXPIRES_IN/);
  });

  it('rejects a database URL that does not match the approved target or points to DEV', () => {
    env.DATABASE_URL = 'postgresql://bjc_dev:synthetic@127.0.0.1:55432/buscador_juridico_civil_dev';
    expect(() => validatePreproductionConfig(env)).toThrow(/no coincide/);
  });

  it('rejects loopback even when the declared preproduction identity matches it', () => {
    env.DATABASE_URL = 'postgresql://preprod_user:synthetic@127.0.0.1:55432/buscador_juridico_civil_preprod';
    env.BJC_PREPROD_DB_HOST = '127.0.0.1';
    env.BJC_PREPROD_DB_PORT = '55432';
    expect(() => validatePreproductionConfig(env)).toThrow(/no coincide/);
    env.DATABASE_URL = 'postgresql://preprod_user:synthetic@[::1]:55432/buscador_juridico_civil_preprod';
    env.BJC_PREPROD_DB_HOST = '::1';
    expect(() => validatePreproductionConfig(env)).toThrow(/no coincide/);
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
    env.BJC_CORPUS_STORAGE_PATH = path.resolve(storageRoot, '..', '_dev-corpus-storage');
    expect(() => validatePreproductionConfig(env)).toThrow(/storage DEV/);
  });
});

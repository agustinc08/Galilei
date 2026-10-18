import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rootCertificates } from 'node:tls';
import { validateProductionConfig } from './production-config';

describe('validateProductionConfig storage identities', () => {
  let tempRoot: string;
  let productionStorage: string;
  let devStorage: string;
  let preprodStorage: string;
  let caPath: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-production-config-'));
    productionStorage = path.join(tempRoot, 'production-storage');
    devStorage = path.join(tempRoot, 'dev-storage');
    preprodStorage = path.join(tempRoot, 'preprod-storage');
    for (const directory of [productionStorage, devStorage, preprodStorage]) {
      fs.mkdirSync(directory);
    }
    caPath = path.join(tempRoot, 'root-ca.pem');
    fs.writeFileSync(caPath, rootCertificates[0]);
    env = {
      NODE_ENV: 'production',
      BJC_DEPLOYMENT_ENV: 'production',
      BJC_PRODUCTION_DATABASE_APPROVED: 'true',
      BJC_PRODUCTION_DB_HOST: 'production-db.internal',
      BJC_PRODUCTION_DB_PORT: '5432',
      BJC_PRODUCTION_DB_NAME: 'galilei_production',
      BJC_PRODUCTION_DB_USER: 'galilei_prod_runtime',
      BJC_PRODUCTION_DB_CA_PATH: caPath,
      DATABASE_URL: `postgresql://galilei_prod_runtime:synthetic-test-password@production-db.internal:5432/galilei_production?sslmode=verify-full&sslrootcert=${encodeURIComponent(caPath)}`,
      JWT_SECRET: 'K7m4V9q2X6b1N8c3R5t0W4y7A2d9F6h1P8u3',
      JWT_EXPIRES_IN: '2h',
      FRONTEND_URL: 'https://galilei.example.intra',
      BJC_CORPUS_STORAGE_PATH: productionStorage,
      BJC_DEV_CORPUS_STORAGE_PATH: devStorage,
      BJC_PREPROD_CORPUS_STORAGE_PATH: preprodStorage,
      BJC_API_BIND_HOST: '127.0.0.1',
      API_RATE_LIMIT_ENABLED: 'true',
      BJC_PRODUCTION_REPLICAS: '1',
      API_RATE_LIMIT_WINDOW_MS: '60000',
      API_RATE_LIMIT_AUTH_MAX: '15',
      API_RATE_LIMIT_SEARCH_MAX: '120',
      API_RATE_LIMIT_MATCHES_MAX: '120',
      API_RATE_LIMIT_DOWNLOAD_MAX: '120',
      BJC_SEARCH_STATEMENT_TIMEOUT_MS: '4000',
      SEARCH_ENGINE: 'opensearch',
      OPENSEARCH_NODE: 'https://production-search.internal:9200',
      OPENSEARCH_USERNAME: 'production-search-user',
      OPENSEARCH_PASSWORD: 'synthetic-search-password',
      OPENSEARCH_INDEX_ALIAS: 'galilei-production-search-active',
      OPENSEARCH_INDEX_PREFIX: 'galilei-production-search',
    };
  });

  afterEach(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  it('accepts only a fully isolated production storage identity', () => {
    expect(validateProductionConfig(env).storageRoot).toBe(
      fs.realpathSync.native(productionStorage),
    );
  });

  it.each(['BJC_DEV_CORPUS_STORAGE_PATH', 'BJC_PREPROD_CORPUS_STORAGE_PATH'])(
    'fails closed when the required peer reference %s is absent',
    (key) => {
      delete env[key];
      expect(() => validateProductionConfig(env)).toThrow(new RegExp(key));
    },
  );

  it('rejects exact, parent, and child overlap with PREPROD', () => {
    env.BJC_CORPUS_STORAGE_PATH = preprodStorage;
    expect(() => validateProductionConfig(env)).toThrow(
      'BJC_CORPUS_STORAGE_OVERLAP_PREPROD',
    );

    const nestedProduction = path.join(preprodStorage, 'production-child');
    fs.mkdirSync(nestedProduction);
    env.BJC_CORPUS_STORAGE_PATH = nestedProduction;
    expect(() => validateProductionConfig(env)).toThrow(
      'BJC_CORPUS_STORAGE_OVERLAP_PREPROD',
    );

    const nestedPreprod = path.join(productionStorage, 'preprod-child');
    fs.mkdirSync(nestedPreprod);
    env.BJC_CORPUS_STORAGE_PATH = productionStorage;
    env.BJC_PREPROD_CORPUS_STORAGE_PATH = nestedPreprod;
    expect(() => validateProductionConfig(env)).toThrow(
      'BJC_CORPUS_STORAGE_OVERLAP_PREPROD',
    );
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { rootCertificates } from 'node:tls';
import { FederatedSearchService } from './federated-search.service';
import {
  BUSQUEDA_RUNTIME_PROVIDERS,
  createSearchDatabasePoolConfig,
  SEARCH_DATABASE_POOL_CONFIG,
} from './busqueda.module';
import { OpenSearchRuntimeService } from './opensearch/opensearch-runtime.service';
import { createSearchPostgresHydrators } from './search-postgres-adapters';
import type { ApprovedRuntimePgConfig } from '../config/runtime-database-config';

type EnvironmentCase = {
  label: string;
  nodeEnvironment: 'development' | 'production';
  deploymentEnvironment: 'development' | 'preprod' | 'production';
  databaseHost: string;
  databasePort: string;
  databaseName: string;
  databaseUser: string;
};

const cases: EnvironmentCase[] = [
  {
    label: 'DEV',
    nodeEnvironment: 'development',
    deploymentEnvironment: 'development',
    databaseHost: '127.0.0.1',
    databasePort: '55432',
    databaseName: 'buscador_juridico_civil_dev',
    databaseUser: 'bjc_dev',
  },
  {
    label: 'PREPROD',
    nodeEnvironment: 'production',
    deploymentEnvironment: 'preprod',
    databaseHost: 'preprod-db.synthetic.invalid',
    databasePort: '5432',
    databaseName: 'buscador_juridico_civil_preprod',
    databaseUser: 'preprod_user',
  },
  {
    label: 'PROD',
    nodeEnvironment: 'production',
    deploymentEnvironment: 'production',
    databaseHost: 'production-db.synthetic.invalid',
    databasePort: '6432',
    databaseName: 'galilei_production',
    databaseUser: 'galilei_prod_runtime',
  },
];

const managedEnvKeys = [
  'NODE_ENV',
  'BJC_DEPLOYMENT_ENV',
  'DATABASE_URL',
  'SEARCH_ENGINE',
  'OPENSEARCH_NODE',
  'OPENSEARCH_USERNAME',
  'OPENSEARCH_PASSWORD',
  'OPENSEARCH_INDEX_ALIAS',
  'OPENSEARCH_INDEX_PREFIX',
  'OPENSEARCH_ALLOW_INSECURE_LOCAL',
  'OPENSEARCH_CA_PATH',
  'BJC_PREPROD_DATABASE_APPROVED',
  'BJC_PREPROD_DB_HOST',
  'BJC_PREPROD_DB_PORT',
  'BJC_PREPROD_DB_NAME',
  'BJC_PREPROD_DB_USER',
  'BJC_PREPROD_DB_CA_PATH',
  'BJC_PRODUCTION_DATABASE_APPROVED',
  'BJC_PRODUCTION_DB_HOST',
  'BJC_PRODUCTION_DB_PORT',
  'BJC_PRODUCTION_DB_NAME',
  'BJC_PRODUCTION_DB_USER',
  'BJC_PRODUCTION_DB_CA_PATH',
  'BJC_SPRINT121_TEMP_DB_TEST',
];

describe('Search Nest provider wiring uses one canonical PostgreSQL identity', () => {
  let tempRoot: string;
  let caPath: string;
  let restoreEnv: (() => void) | undefined;
  let moduleRef: TestingModule | undefined;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-search-provider-'));
    caPath = path.join(tempRoot, 'root-ca.pem');
    fs.writeFileSync(caPath, rootCertificates[0]);
  });

  afterEach(async () => {
    if (moduleRef) {
      await moduleRef.close();
      moduleRef = undefined;
    }
    restoreEnv?.();
    restoreEnv = undefined;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it.each(cases)(
    'constructs Nest Search providers for $label without opening PostgreSQL',
    async (environment) => {
      restoreEnv = installEnvironment(makeEnvironment(environment, caPath));
      moduleRef = await Test.createTestingModule({
        providers: BUSQUEDA_RUNTIME_PROVIDERS,
      }).compile();

      const approved = moduleRef.get<ApprovedRuntimePgConfig | null>(
        SEARCH_DATABASE_POOL_CONFIG,
      );
      expect(approved).not.toBeNull();
      expect(approved).toMatchObject({
        host: environment.databaseHost,
        port: Number(environment.databasePort),
        database: environment.databaseName,
        user: environment.databaseUser,
      });

      const runtime = moduleRef.get(OpenSearchRuntimeService);
      const service = moduleRef.get(FederatedSearchService);
      expect(Reflect.get(service, 'jurisprudencia')).toBeTruthy();
      expect(Reflect.get(service, 'corpus')).toBeTruthy();

      const repositoryPool = readPool(runtime.repository);
      expect(repositoryPool.options).toMatchObject({
        host: environment.databaseHost,
        port: Number(environment.databasePort),
        database: environment.databaseName,
        user: environment.databaseUser,
      });
      expect(repositoryPool.totalCount).toBe(0);

      const hydrators = createSearchPostgresHydrators(approved!);
      for (const adapter of [hydrators.jurisprudencia, hydrators.corpus]) {
        const pool = readPool(adapter);
        expect(pool.options).toMatchObject({
          host: environment.databaseHost,
          port: Number(environment.databasePort),
          database: environment.databaseName,
          user: environment.databaseUser,
          min: 1,
        });
        expect(pool.totalCount).toBe(0);
        if (environment.deploymentEnvironment !== 'development') {
          const ssl = pool.options.ssl as {
            ca: Buffer;
            rejectUnauthorized: boolean;
          };
          expect(ssl.rejectUnauthorized).toBe(true);
          expect(ssl.ca.equals(fs.readFileSync(caPath))).toBe(true);
        }
        await adapter.close();
      }
    },
  );

  it.each(['preprod', 'production'] as const)(
    'rejects DEV DB identity in %s',
    (environment) => {
      const testCase = cases.find(
        (item) => item.deploymentEnvironment === environment,
      )!;
      const env = makeEnvironment(testCase, caPath);
      env.DATABASE_URL =
        'postgresql://bjc_dev:synthetic@127.0.0.1:55432/buscador_juridico_civil_dev';
      expect(() => createSearchDatabasePoolConfig(env)).toThrow();
    },
  );

  it('rejects environment marker mismatch before Search wiring', () => {
    expect(() =>
      createSearchDatabasePoolConfig({
        NODE_ENV: 'development',
        BJC_DEPLOYMENT_ENV: 'preprod',
        SEARCH_ENGINE: 'opensearch',
        DATABASE_URL:
          'postgresql://bjc_dev:synthetic@127.0.0.1:55432/buscador_juridico_civil_dev',
      }),
    ).toThrow('BJC_DEPLOYMENT_ENV_NODE_ENV_MISMATCH');
  });
});

function readPool(instance: unknown): Pool {
  return (instance as { pool: Pool }).pool;
}

function makeEnvironment(
  testCase: EnvironmentCase,
  ca: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: testCase.nodeEnvironment,
    BJC_DEPLOYMENT_ENV: testCase.deploymentEnvironment,
    SEARCH_ENGINE: 'opensearch',
    OPENSEARCH_USERNAME: 'synthetic-search-user',
    OPENSEARCH_PASSWORD: 'synthetic-only',
  };
  if (testCase.deploymentEnvironment === 'development') {
    env.DATABASE_URL =
      'postgresql://bjc_dev:synthetic@127.0.0.1:55432/buscador_juridico_civil_dev';
    env.OPENSEARCH_NODE = 'http://127.0.0.1:9200';
    env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';
    env.OPENSEARCH_INDEX_ALIAS = 'galilei-search-active';
    env.OPENSEARCH_INDEX_PREFIX = 'galilei-search';
    return env;
  }

  env.OPENSEARCH_NODE = `https://${testCase.deploymentEnvironment}-search.synthetic.invalid:9200`;
  env.OPENSEARCH_INDEX_ALIAS =
    testCase.deploymentEnvironment === 'preprod'
      ? 'galilei-preprod-search-active'
      : 'galilei-production-search-active';
  env.OPENSEARCH_INDEX_PREFIX =
    testCase.deploymentEnvironment === 'preprod'
      ? 'galilei-preprod-search'
      : 'galilei-production-search';
  const prefix =
    testCase.deploymentEnvironment === 'preprod'
      ? 'BJC_PREPROD'
      : 'BJC_PRODUCTION';
  env[`${prefix}_DATABASE_APPROVED`] = 'true';
  env[`${prefix}_DB_HOST`] = testCase.databaseHost;
  env[`${prefix}_DB_PORT`] = testCase.databasePort;
  env[`${prefix}_DB_NAME`] = testCase.databaseName;
  env[`${prefix}_DB_USER`] = testCase.databaseUser;
  env[`${prefix}_DB_CA_PATH`] = ca;
  env.DATABASE_URL = `postgresql://${testCase.databaseUser}:synthetic-only@${testCase.databaseHost}:${testCase.databasePort}/${testCase.databaseName}?sslmode=verify-full&sslrootcert=${encodeURIComponent(ca)}`;
  return env;
}

function installEnvironment(next: NodeJS.ProcessEnv) {
  const prior = new Map<string, string | undefined>();
  for (const key of managedEnvKeys) {
    prior.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) process.env[key] = value;
  }
  return () => {
    for (const key of managedEnvKeys) {
      const value = prior.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

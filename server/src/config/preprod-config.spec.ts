import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rootCertificates } from 'node:tls';
import { validatePreproductionConfig } from './preprod-config';

describe('validatePreproductionConfig', () => {
  let tempRoot: string;
  let storageRoot: string;
  let devStorageRoot: string;
  let productionStorageRoot: string;
  let caPath: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-preprod-config-'));
    storageRoot = path.join(tempRoot, 'preprod-storage');
    devStorageRoot = path.join(tempRoot, 'dev-storage');
    productionStorageRoot = path.join(tempRoot, 'production-storage');
    fs.mkdirSync(storageRoot);
    fs.mkdirSync(devStorageRoot);
    fs.mkdirSync(productionStorageRoot);
    caPath = path.join(tempRoot, 'root-ca.pem');
    fs.writeFileSync(caPath, rootCertificates[0]);
    env = {
      NODE_ENV: 'production',
      BJC_DEPLOYMENT_ENV: 'preprod',
      DATABASE_URL: '',
      BJC_PREPROD_DATABASE_APPROVED: 'true',
      BJC_PREPROD_DB_HOST: 'preprod-db.internal',
      BJC_PREPROD_DB_PORT: '5432',
      BJC_PREPROD_DB_NAME: 'buscador_juridico_civil_preprod',
      BJC_PREPROD_DB_USER: 'preprod_user',
      BJC_PREPROD_DB_CA_PATH: caPath,
      JWT_SECRET: 'a7K9m2Q4v8N1x5C3p6R0t9W2b4H7d1F8z3L5',
      JWT_EXPIRES_IN: '2h',
      FRONTEND_URL: 'https://preprod.example.intra',
      BJC_CORPUS_STORAGE_PATH: storageRoot,
      BJC_DEV_CORPUS_STORAGE_PATH: devStorageRoot,
      BJC_PRODUCTION_CORPUS_STORAGE_PATH: productionStorageRoot,
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
    env.DATABASE_URL = databaseUrl(env);
  });

  afterEach(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  it('accepts an explicitly approved isolated config without connecting to PostgreSQL', () => {
    expect(validatePreproductionConfig(env)).toMatchObject({
      databaseHost: 'preprod-db.internal',
      databasePort: '5432',
      databaseName: 'buscador_juridico_civil_preprod',
      databaseUser: 'preprod_user',
      databaseCaPath: fs.realpathSync.native(caPath),
      databaseTlsMode: 'verify-full',
      frontendOrigins: ['https://preprod.example.intra'],
      storageRoot: fs.realpathSync.native(storageRoot),
      searchNode: 'https://preprod-search.internal:9200',
      searchAlias: 'galilei-preprod-search-active',
      searchIndexPrefix: 'galilei-preprod-search',
    });
    const publicResult = validatePreproductionConfig(env);
    expect('approvedDatabase' in publicResult).toBe(false);
  });

  it('can hand the validated canonical DB object to a guarded consumer without reparsing a Prisma URL', () => {
    const result = validatePreproductionConfig(env, {
      includeApprovedDatabaseConfig: true,
    });
    expect('approvedDatabase' in result).toBe(true);
    if (!('approvedDatabase' in result)) {
      throw new Error('Expected guard-only canonical DB adapter');
    }
    expect(result.approvedDatabase).toMatchObject({
      host: 'preprod-db.internal',
      port: 5432,
      database: 'buscador_juridico_civil_preprod',
      user: 'preprod_user',
      tlsMode: 'verify-full',
    });
    expect(
      new URL(result.approvedDatabase.prismaCliUrl).searchParams.get('sslmode'),
    ).toBe('require');
    expect(
      new URL(result.approvedDatabase.prismaCliUrl).searchParams.get(
        'sslaccept',
      ),
    ).toBe('strict');
  });

  it('rejects a startup environment marker that disagrees with NODE_ENV', () => {
    env.NODE_ENV = 'development';
    expect(() => validatePreproductionConfig(env)).toThrow(
      'BJC_DEPLOYMENT_ENV_NODE_ENV_MISMATCH',
    );
  });

  it('rejects missing critical values without defaults', () => {
    delete env.BJC_PREPROD_DB_CA_PATH;
    expect(() => validatePreproductionConfig(env)).toThrow(
      /BJC_PREPROD_DB_CA_PATH/,
    );
  });

  it('fails closed when the reserved PROD storage reference is missing', () => {
    delete env.BJC_PRODUCTION_CORPUS_STORAGE_PATH;
    expect(() => validatePreproductionConfig(env)).toThrow(
      /BJC_PRODUCTION_CORPUS_STORAGE_PATH/,
    );
  });

  it('rejects the canonical DEV database identity', () => {
    env.DATABASE_URL = databaseUrl(env, {
      host: '127.0.0.1',
      port: '55432',
      database: 'buscador_juridico_civil_dev',
      user: 'bjc_dev',
    });
    env.BJC_PREPROD_DB_HOST = '127.0.0.1';
    env.BJC_PREPROD_DB_PORT = '55432';
    env.BJC_PREPROD_DB_NAME = 'buscador_juridico_civil_preprod';
    env.BJC_PREPROD_DB_USER = 'preprod_user';
    expect(() => validatePreproductionConfig(env)).toThrow(
      /identidad preprod aprobada/,
    );
  });

  it('rejects query overrides for host, port, database, user, service and driver options', () => {
    for (const parameter of [
      'host=127.0.0.1',
      'hostaddr=127.0.0.1',
      'port=55432',
      'dbname=buscador_juridico_civil_dev',
      'user=bjc_dev',
      'service=unexpected',
      'options=-c%20sslmode=disable',
      'sslcert=%2Ftmp%2Fclient.crt',
      'target_session_attrs=read-write',
    ]) {
      env.DATABASE_URL = `${databaseUrl(env)}&${parameter}`;
      expect(() => validatePreproductionConfig(env)).toThrow(
        parameter.startsWith('sslrootcert=')
          ? 'DATABASE_URL_DUPLICATE_SECURITY_PARAMETER'
          : 'DATABASE_URL_UNSUPPORTED_CONNECTION_PARAMETER',
      );
    }
  });

  it('rejects duplicate SSL parameters and TLS downgrade attempts using node-postgres rules', () => {
    env.DATABASE_URL = `${databaseUrl(env)}&sslmode=disable`;
    expect(() => validatePreproductionConfig(env)).toThrow(
      'DATABASE_URL_DUPLICATE_SECURITY_PARAMETER',
    );
    env.DATABASE_URL = databaseUrl(env).replace(
      'sslmode=verify-full',
      'sslmode=disable',
    );
    expect(() => validatePreproductionConfig(env)).toThrow(
      'DATABASE_URL_TLS_PARAMETERS_INVALID',
    );
  });

  it('requires the CA query path to be the same canonical file as the environment setting', () => {
    const otherCa = path.join(tempRoot, 'other-ca.pem');
    fs.writeFileSync(otherCa, rootCertificates[1]);
    env.DATABASE_URL = databaseUrl(env, { caPath: otherCa });
    expect(() => validatePreproductionConfig(env)).toThrow(
      'DATABASE_URL_CA_PATH_MISMATCH',
    );
  });

  it('rejects invalid CA data and malformed URL encodings', () => {
    fs.writeFileSync(caPath, 'not a certificate');
    expect(() => validatePreproductionConfig(env)).toThrow(
      'DATABASE_CA_CERTIFICATE_INVALID',
    );
    fs.writeFileSync(caPath, rootCertificates[0]);
    env.DATABASE_URL =
      'postgresql://bad%ZZ:synthetic@preprod-db.internal:5432/preprod?sslmode=verify-full';
    expect(() => validatePreproductionConfig(env)).toThrow(
      'DATABASE_URL contiene credenciales o identidad codificadas inválidas.',
    );
  });

  it('rejects multiple replicas while rate limits are process-local', () => {
    env.BJC_PREPROD_REPLICAS = '2';
    expect(() => validatePreproductionConfig(env)).toThrow(/una sola réplica/);
  });

  it('rejects relative paths and same, parent, child, and symlink storage overlap', () => {
    env.BJC_CORPUS_STORAGE_PATH = 'relative/storage';
    expect(() => validatePreproductionConfig(env)).toThrow(
      'BJC_CORPUS_STORAGE_PATH_MUST_BE_ABSOLUTE',
    );

    env.BJC_CORPUS_STORAGE_PATH = devStorageRoot;
    expect(() => validatePreproductionConfig(env)).toThrow(
      'BJC_CORPUS_STORAGE_OVERLAP_DEV',
    );

    const nestedStorage = path.join(devStorageRoot, 'preprod-child');
    fs.mkdirSync(nestedStorage);
    env.BJC_CORPUS_STORAGE_PATH = nestedStorage;
    expect(() => validatePreproductionConfig(env)).toThrow(
      'BJC_CORPUS_STORAGE_OVERLAP_DEV',
    );

    const nestedDev = path.join(storageRoot, 'dev-child');
    fs.mkdirSync(nestedDev);
    env.BJC_CORPUS_STORAGE_PATH = storageRoot;
    env.BJC_DEV_CORPUS_STORAGE_PATH = nestedDev;
    expect(() => validatePreproductionConfig(env)).toThrow(
      'BJC_CORPUS_STORAGE_OVERLAP_DEV',
    );

    const junction = path.join(tempRoot, 'storage-alias');
    try {
      fs.symlinkSync(
        devStorageRoot,
        junction,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      env.BJC_CORPUS_STORAGE_PATH = junction;
      env.BJC_DEV_CORPUS_STORAGE_PATH = devStorageRoot;
      expect(() => validatePreproductionConfig(env)).toThrow(
        'BJC_CORPUS_STORAGE_OVERLAP_DEV',
      );
    } catch (error) {
      if (
        !['EPERM', 'EACCES', 'ENOTSUP'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      ) {
        throw error;
      }
    }
  });

  it('rejects exact, parent/child, case-equivalent, and junction aliases of PROD storage', () => {
    env.BJC_CORPUS_STORAGE_PATH = productionStorageRoot;
    expect(() => validatePreproductionConfig(env)).toThrow(
      'BJC_CORPUS_STORAGE_OVERLAP_PRODUCTION',
    );

    const nestedPreprod = path.join(productionStorageRoot, 'preprod-child');
    fs.mkdirSync(nestedPreprod);
    env.BJC_CORPUS_STORAGE_PATH = nestedPreprod;
    expect(() => validatePreproductionConfig(env)).toThrow(
      'BJC_CORPUS_STORAGE_OVERLAP_PRODUCTION',
    );

    const nestedProd = path.join(storageRoot, 'production-child');
    fs.mkdirSync(nestedProd);
    env.BJC_CORPUS_STORAGE_PATH = storageRoot;
    env.BJC_PRODUCTION_CORPUS_STORAGE_PATH = nestedProd;
    expect(() => validatePreproductionConfig(env)).toThrow(
      'BJC_CORPUS_STORAGE_OVERLAP_PRODUCTION',
    );

    if (process.platform === 'win32') {
      env.BJC_CORPUS_STORAGE_PATH = storageRoot.toUpperCase();
      env.BJC_PRODUCTION_CORPUS_STORAGE_PATH = storageRoot;
      expect(() => validatePreproductionConfig(env)).toThrow(
        'BJC_CORPUS_STORAGE_OVERLAP_PRODUCTION',
      );
    }

    const junction = path.join(tempRoot, 'production-storage-alias');
    try {
      fs.symlinkSync(
        productionStorageRoot,
        junction,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      env.BJC_CORPUS_STORAGE_PATH = junction;
      env.BJC_PRODUCTION_CORPUS_STORAGE_PATH = productionStorageRoot;
      expect(() => validatePreproductionConfig(env)).toThrow(
        'BJC_CORPUS_STORAGE_OVERLAP_PRODUCTION',
      );
    } catch (error) {
      if (
        !['EPERM', 'EACCES', 'ENOTSUP'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      ) {
        throw error;
      }
    }
  });

  it('requires the approved host-local bind and namespace', () => {
    env.BJC_API_BIND_HOST = '0.0.0.0';
    expect(() => validatePreproductionConfig(env)).toThrow(/BJC_API_BIND_HOST/);
    env.BJC_API_BIND_HOST = '127.0.0.1';
    env.OPENSEARCH_INDEX_ALIAS = 'galilei-search-active';
    env.OPENSEARCH_INDEX_PREFIX = 'galilei-search';
    expect(() => validatePreproductionConfig(env)).toThrow(
      /PREPROD_NAMESPACE_INVALID/,
    );
  });

  it('requires explicit public HTTPS CORS origins and the certified Search engine', () => {
    env.FRONTEND_URL = 'http://localhost:4002';
    expect(() => validatePreproductionConfig(env)).toThrow(/HTTPS/);
    env.FRONTEND_URL = 'https://preprod.example.intra';
    env.SEARCH_ENGINE = 'postgres';
    expect(() => validatePreproductionConfig(env)).toThrow(
      /SEARCH_ENGINE preprod/,
    );
  });
});

function databaseUrl(
  env: NodeJS.ProcessEnv,
  overrides: {
    host?: string;
    port?: string;
    database?: string;
    user?: string;
    caPath?: string;
  } = {},
) {
  const host = overrides.host ?? env.BJC_PREPROD_DB_HOST!;
  const port = overrides.port ?? env.BJC_PREPROD_DB_PORT!;
  const database = overrides.database ?? env.BJC_PREPROD_DB_NAME!;
  const user = overrides.user ?? env.BJC_PREPROD_DB_USER!;
  const caPath = overrides.caPath ?? env.BJC_PREPROD_DB_CA_PATH!;
  const urlHost =
    host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const encodedCa = encodeURIComponent(caPath);
  return `postgresql://${encodeURIComponent(user)}:synthetic-test-password@${urlHost}:${port}/${database}?sslmode=verify-full&sslrootcert=${encodedCa}`;
}

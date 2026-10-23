import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rootCertificates } from 'node:tls';
import {
  getRuntimeDatabasePoolConfig,
  resolveSearchDatabasePoolConfig,
} from './runtime-database-config';

describe('canonical runtime PostgreSQL pool configuration', () => {
  let tempRoot: string;
  let caPath: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-runtime-db-config-'));
    caPath = path.join(tempRoot, 'root-ca.pem');
    fs.writeFileSync(caPath, rootCertificates[0]);
  });

  afterEach(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  it('keeps DEV identity loopback-only and emits explicit pg fields', () => {
    const config = getRuntimeDatabasePoolConfig({
      NODE_ENV: 'development',
      BJC_DEPLOYMENT_ENV: 'development',
      DATABASE_URL:
        'postgresql://bjc_dev:synthetic@127.0.0.1:55432/buscador_juridico_civil_dev',
    });
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 55432,
      database: 'buscador_juridico_civil_dev',
      user: 'bjc_dev',
      password: 'synthetic',
    });
    expect(config).not.toHaveProperty('connectionString');
    expect(config.ssl).toBeUndefined();
  });

  it('allows only the exact isolated deep-QA identity behind an explicit local flag', () => {
    const config = getRuntimeDatabasePoolConfig({
      NODE_ENV: 'development',
      BJC_DEPLOYMENT_ENV: 'development',
      BJC_DEEP_QA_ALLOW_ISOLATED_DATABASE: 'true',
      DATABASE_URL:
        'postgresql://bjc_dev:synthetic@127.0.0.1:55434/buscador_juridico_civil_deepqa',
    });
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 55434,
      database: 'buscador_juridico_civil_deepqa',
      user: 'bjc_dev',
      password: 'synthetic',
    });
  });

  it('requires an explicit development deployment mode for isolated deep-QA', () => {
    expect(() =>
      getRuntimeDatabasePoolConfig({
        NODE_ENV: 'development',
        BJC_DEEP_QA_ALLOW_ISOLATED_DATABASE: 'true',
        DATABASE_URL:
          'postgresql://bjc_dev:synthetic@127.0.0.1:55434/buscador_juridico_civil_deepqa',
      }),
    ).toThrow('DEEP_QA_DATABASE_REQUIRES_DEVELOPMENT_RUNTIME');
  });
  it('rejects all non-QA database identities while isolated deep-QA mode is enabled', () => {
    expect(() =>
      getRuntimeDatabasePoolConfig({
        NODE_ENV: 'development',
        BJC_DEPLOYMENT_ENV: 'development',
        BJC_DEEP_QA_ALLOW_ISOLATED_DATABASE: 'true',
        DATABASE_URL:
          'postgresql://bjc_dev:synthetic@127.0.0.1:55432/buscador_juridico_civil_dev',
      }),
    ).toThrow('DEEP_QA_DATABASE_TARGET_REJECTED');
    expect(() =>
      getRuntimeDatabasePoolConfig({
        NODE_ENV: 'development',
        BJC_DEPLOYMENT_ENV: 'development',
        BJC_DEEP_QA_ALLOW_ISOLATED_DATABASE: 'true',
        DATABASE_URL:
          'postgresql://bjc_dev:synthetic@remote.invalid:55434/buscador_juridico_civil_deepqa',
      }),
    ).toThrow('DEEP_QA_DATABASE_TARGET_REJECTED');
  });

  it('rejects the isolated deep-QA identity without its explicit local flag', () => {
    expect(() =>
      getRuntimeDatabasePoolConfig({
        NODE_ENV: 'development',
        BJC_DEPLOYMENT_ENV: 'development',
        DATABASE_URL:
          'postgresql://bjc_dev:synthetic@127.0.0.1:55434/buscador_juridico_civil_deepqa',
      }),
    ).toThrow(
      'El backend fuera de producción sólo puede conectarse a bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev.',
    );
  });

  it.each([
    {
      environment: 'preprod' as const,
      host: 'preprod-db.synthetic.invalid',
      port: '5432',
      database: 'buscador_juridico_civil_preprod',
      user: 'preprod_user',
      prefix: 'BJC_PREPROD',
    },
    {
      environment: 'production' as const,
      host: 'production-db.synthetic.invalid',
      port: '6432',
      database: 'galilei_production',
      user: 'galilei_prod_runtime',
      prefix: 'BJC_PRODUCTION',
    },
  ])(
    'uses approved $environment identity and verified TLS',
    ({ environment, host, port, database, user, prefix }) => {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'production',
        BJC_DEPLOYMENT_ENV: environment,
        [`${prefix}_DATABASE_APPROVED`]: 'true',
        [`${prefix}_DB_HOST`]: host,
        [`${prefix}_DB_PORT`]: port,
        [`${prefix}_DB_NAME`]: database,
        [`${prefix}_DB_USER`]: user,
        [`${prefix}_DB_CA_PATH`]: caPath,
        DATABASE_URL: `postgresql://${user}:synthetic@${host}:${port}/${database}?sslmode=verify-full&sslrootcert=${encodeURIComponent(caPath)}`,
      };
      const config = getRuntimeDatabasePoolConfig(env);
      expect(config).toMatchObject({
        host,
        port: Number(port),
        database,
        user,
      });
      expect(config.ssl).toMatchObject({ rejectUnauthorized: true });
      const ssl = config.ssl as { ca: Buffer };
      expect(ssl.ca.equals(fs.readFileSync(caPath))).toBe(true);
      expect(config).not.toHaveProperty('connectionString');
    },
  );

  it.each(['preprod', 'production'] as const)(
    'rejects DEV identity for %s',
    (environment) => {
      const prefix =
        environment === 'preprod' ? 'BJC_PREPROD' : 'BJC_PRODUCTION';
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'production',
        BJC_DEPLOYMENT_ENV: environment,
        [`${prefix}_DATABASE_APPROVED`]: 'true',
        [`${prefix}_DB_HOST`]: 'approved-db.synthetic.invalid',
        [`${prefix}_DB_PORT`]: '5432',
        [`${prefix}_DB_NAME`]:
          environment === 'preprod'
            ? 'buscador_juridico_civil_preprod'
            : 'galilei_production',
        [`${prefix}_DB_USER`]:
          environment === 'preprod' ? 'preprod_user' : 'galilei_prod_runtime',
        [`${prefix}_DB_CA_PATH`]: caPath,
        DATABASE_URL:
          'postgresql://bjc_dev:synthetic@127.0.0.1:55432/buscador_juridico_civil_dev',
      };
      expect(() => getRuntimeDatabasePoolConfig(env)).toThrow();
    },
  );

  it('rejects production with no explicit deployment environment', () => {
    expect(() =>
      getRuntimeDatabasePoolConfig({
        NODE_ENV: 'production',
        DATABASE_URL:
          'postgresql://bjc_dev:synthetic@127.0.0.1:55432/buscador_juridico_civil_dev',
      }),
    ).toThrow('BJC_DEPLOYMENT_ENV_REQUIRED');
  });

  it('retains only the guarded local migration-fixture boundary', () => {
    const fixture = resolveSearchDatabasePoolConfig(
      'postgresql://bjc_dev:synthetic@127.0.0.1:55432/buscador_juridico_civil_migration_test',
      { NODE_ENV: 'test', BJC_SPRINT121_TEMP_DB_TEST: '1' },
    );
    expect(fixture).toMatchObject({
      host: '127.0.0.1',
      port: 55432,
      database: 'buscador_juridico_civil_migration_test',
      user: 'bjc_dev',
    });
    expect(() =>
      resolveSearchDatabasePoolConfig(
        'postgresql://bjc_dev:synthetic@remote.invalid:55432/buscador_juridico_civil_migration_test',
        { NODE_ENV: 'test', BJC_SPRINT121_TEMP_DB_TEST: '1' },
      ),
    ).toThrow('MIGRATION_FIXTURE_DATABASE_TARGET_REJECTED');
  });
});

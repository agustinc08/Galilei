import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { rootCertificates } from 'node:tls';
import { getApprovedDatabaseConfig } from './approved-database-config';

describe('approved PostgreSQL connection config', () => {
  let tempRoot: string;
  let caPath: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-approved-db-'));
    caPath = path.join(tempRoot, 'root-ca.pem');
    fs.writeFileSync(caPath, rootCertificates[0]);
    env = {
      NODE_ENV: 'production',
      BJC_DEPLOYMENT_ENV: 'preprod',
      BJC_PREPROD_DATABASE_APPROVED: 'true',
      BJC_PREPROD_DB_HOST: 'preprod-db.internal',
      BJC_PREPROD_DB_PORT: '5432',
      BJC_PREPROD_DB_NAME: 'buscador_juridico_civil_preprod',
      BJC_PREPROD_DB_USER: 'preprod_user',
      BJC_PREPROD_DB_CA_PATH: caPath,
      DATABASE_URL: '',
    };
    env.DATABASE_URL = makeUrl(env, caPath);
  });

  afterEach(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  it('constructs an explicit pg config whose actual driver target and TLS match the validated identity', () => {
    const approved = getApprovedDatabaseConfig(env, 'preprod');
    const client = new Client(approved.pgConfig);
    const effective = (
      client as unknown as {
        connectionParameters: {
          host: string;
          port: number;
          user: string;
          database: string;
          ssl: { ca: Buffer; rejectUnauthorized: boolean };
        };
      }
    ).connectionParameters;

    expect(effective).toMatchObject({
      host: approved.host,
      port: approved.port,
      user: approved.user,
      database: approved.database,
    });
    expect(Buffer.isBuffer(effective.ssl.ca)).toBe(true);
    expect(effective.ssl.rejectUnauthorized).toBe(true);
    expect(effective.ssl.ca.equals(fs.readFileSync(caPath))).toBe(true);
    expect(approved.tlsMode).toBe('verify-full');
    expect(approved.pgConfig).not.toHaveProperty('connectionString');
    const prismaUrl = new URL(approved.prismaCliUrl);
    expect(prismaUrl.hostname).toBe('preprod-db.internal');
    expect(prismaUrl.port).toBe('5432');
    expect(prismaUrl.pathname).toBe('/buscador_juridico_civil_preprod');
    expect(prismaUrl.searchParams.getAll('sslmode')).toEqual(['require']);
    expect(prismaUrl.searchParams.getAll('sslcert')).toEqual([approved.caPath]);
    expect(prismaUrl.searchParams.getAll('sslaccept')).toEqual(['strict']);
    expect([...prismaUrl.searchParams.keys()]).toEqual([
      'sslmode',
      'sslcert',
      'sslaccept',
    ]);
  });

  it('constructs the PROD pg adapter from the same validated identity and TLS trust file', () => {
    const productionEnv: NodeJS.ProcessEnv = {
      ...env,
      NODE_ENV: 'production',
      BJC_DEPLOYMENT_ENV: 'production',
      BJC_PRODUCTION_DATABASE_APPROVED: 'true',
      BJC_PRODUCTION_DB_HOST: 'production-db.internal',
      BJC_PRODUCTION_DB_PORT: '6432',
      BJC_PRODUCTION_DB_NAME: 'galilei_production',
      BJC_PRODUCTION_DB_USER: 'galilei_prod_runtime',
      BJC_PRODUCTION_DB_CA_PATH: caPath,
    };
    productionEnv.DATABASE_URL = makeUrl(productionEnv, caPath, 'production');
    const approved = getApprovedDatabaseConfig(productionEnv, 'production');
    const client = new Client(approved.pgConfig);
    const effective = (
      client as unknown as {
        connectionParameters: {
          host: string;
          port: number;
          user: string;
          database: string;
          ssl: { ca: Buffer; rejectUnauthorized: boolean };
        };
      }
    ).connectionParameters;
    expect(effective).toMatchObject({
      host: 'production-db.internal',
      port: 6432,
      user: 'galilei_prod_runtime',
      database: 'galilei_production',
    });
    expect(effective.ssl.rejectUnauthorized).toBe(true);
    expect(effective.ssl.ca.equals(fs.readFileSync(caPath))).toBe(true);
    expect(new URL(approved.prismaCliUrl).searchParams.get('sslmode')).toBe(
      'require',
    );
    expect(new URL(approved.prismaCliUrl).searchParams.get('sslaccept')).toBe(
      'strict',
    );
  });

  it('rejects malformed URLs, wrong identities, and query-string authority overrides', () => {
    for (const DATABASE_URL of [
      'not-a-url',
      makeUrl(env, caPath).replace(
        'preprod-db.internal:5432',
        'different.internal:5432',
      ),
      makeUrl(env, caPath).replace(':5432/', ':55432/'),
      makeUrl(env, caPath).replace(
        '/buscador_juridico_civil_preprod?',
        '/other_db?',
      ),
      makeUrl(env, caPath).replace('preprod_user:', 'other_user:'),
      `${makeUrl(env, caPath)}&host=127.0.0.1`,
      `${makeUrl(env, caPath)}&hostaddr=127.0.0.1`,
      `${makeUrl(env, caPath)}&port=55432`,
      `${makeUrl(env, caPath)}&dbname=buscador_juridico_civil_dev`,
      `${makeUrl(env, caPath)}&user=bjc_dev`,
      `${makeUrl(env, caPath)}&service=dev`,
      `${makeUrl(env, caPath)}&options=-c%20sslmode=disable`,
      `${makeUrl(env, caPath)}&sslrootcert=${encodeURIComponent(caPath)}`,
      `${makeUrl(env, caPath)}&sslaccept=strict`,
    ]) {
      env.DATABASE_URL = DATABASE_URL;
      expect(() => getApprovedDatabaseConfig(env, 'preprod')).toThrow();
    }
  });

  it('rejects duplicate TLS controls and downgrade attempts', () => {
    const url = makeUrl(env, caPath);
    for (const DATABASE_URL of [
      `${url}&sslmode=disable`,
      url.replace('sslmode=verify-full', 'sslmode=disable'),
      `${url}&sslrootcert=${encodeURIComponent(caPath)}`,
      `${url}&sslaccept=accept_invalid_certs`,
    ]) {
      env.DATABASE_URL = DATABASE_URL;
      expect(() => getApprovedDatabaseConfig(env, 'preprod')).toThrow();
    }
  });
});

function makeUrl(
  env: NodeJS.ProcessEnv,
  caPath: string,
  profile: 'preprod' | 'production' = 'preprod',
) {
  const prefix = profile === 'preprod' ? 'BJC_PREPROD' : 'BJC_PRODUCTION';
  const database = env[`${prefix}_DB_NAME`]!;
  const user = env[`${prefix}_DB_USER`]!;
  const host = env[`${prefix}_DB_HOST`]!;
  const port = env[`${prefix}_DB_PORT`]!;
  const encodedCa = encodeURIComponent(caPath);
  return `postgresql://${encodeURIComponent(user)}:synthetic-test-password@${host}:${port}/${database}?sslmode=verify-full&sslrootcert=${encodedCa}`;
}

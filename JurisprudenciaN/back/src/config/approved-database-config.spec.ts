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
    expect(prismaUrl.searchParams.getAll('sslmode')).toEqual(['verify-full']);
    expect(prismaUrl.searchParams.getAll('sslcert')).toEqual([approved.caPath]);
    expect(prismaUrl.searchParams.getAll('sslaccept')).toEqual(['strict']);
    expect([...prismaUrl.searchParams.keys()]).toEqual([
      'sslmode',
      'sslcert',
      'sslaccept',
    ]);
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
      `${makeUrl(env, caPath)}&sslcert=${encodeURIComponent(caPath)}&sslaccept=accept_invalid_certs`,
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
      url.replace('sslrootcert=', 'sslcert=relative-ca.pem&sslrootcert='),
      url.replace(
        'sslrootcert=',
        'sslaccept=accept_invalid_certs&sslrootcert=',
      ),
    ]) {
      env.DATABASE_URL = DATABASE_URL;
      expect(() => getApprovedDatabaseConfig(env, 'preprod')).toThrow();
    }
  });
});

function makeUrl(env: NodeJS.ProcessEnv, caPath: string) {
  const encodedCa = encodeURIComponent(caPath);
  return `postgresql://preprod_user:synthetic-test-password@${env.BJC_PREPROD_DB_HOST}:${env.BJC_PREPROD_DB_PORT}/${env.BJC_PREPROD_DB_NAME}?sslmode=verify-full&sslrootcert=${encodedCa}&sslcert=${encodedCa}&sslaccept=strict`;
}

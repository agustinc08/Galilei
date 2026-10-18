import { Client } from 'pg';
import {
  assertDevelopmentDatabaseUrl,
  getDevelopmentDatabaseConfig,
} from './create-prisma-client';

describe('assertDevelopmentDatabaseUrl', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('accepts only the isolated PostgreSQL DEV target', () => {
    const localUrl =
      'postgresql://bjc_dev:fixture-only@127.0.0.1:55432/buscador_juridico_civil_dev';
    expect(assertDevelopmentDatabaseUrl(localUrl)).toBe(localUrl);
  });

  it('constructs an effective pg.Client target from explicit canonical DEV fields without connecting', () => {
    const pgConfig = getDevelopmentDatabaseConfig(
      'postgresql://bjc_dev:fixture-only@127.0.0.1:55432/buscador_juridico_civil_dev',
    );
    const client = new Client(pgConfig);
    const effective = (
      client as unknown as {
        connectionParameters: {
          host: string;
          port: number;
          database: string;
          user: string;
          ssl: unknown;
        };
      }
    ).connectionParameters;
    expect(effective).toMatchObject({
      host: '127.0.0.1',
      port: 55432,
      database: 'buscador_juridico_civil_dev',
      user: 'bjc_dev',
    });
    expect(effective.ssl).toBeFalsy();
    expect(pgConfig).not.toHaveProperty('connectionString');
  });

  it.each([
    'postgresql://bjc_dev:fixture-only@10.0.0.3:55432/buscador_juridico_civil_dev',
    'postgresql://bjc_dev:fixture-only@127.0.0.1:5432/buscador_juridico_civil_dev',
    'postgresql://bjc_dev:fixture-only@127.0.0.1:55432/production',
    'postgresql://postgres:fixture-only@127.0.0.1:55432/buscador_juridico_civil_dev',
  ])('rejects an unsafe or non-DEV target', (databaseUrl) => {
    expect(() => assertDevelopmentDatabaseUrl(databaseUrl)).toThrow(
      'El backend fuera de producción sólo puede conectarse',
    );
  });

  it.each([
    '?host=production-db.invalid',
    '?hostaddr=192.0.2.10',
    '?port=5432',
    '?user=production_role',
    '?sslmode=disable',
    '?sslmode=verify-full&sslmode=disable',
    '?host=127.0.0.1&host=production-db.invalid',
    '?port=55432&port=5432',
    '?user=bjc_dev&user=production_role',
    '?target_session_attrs=read-write',
    '?options=-c%20sslmode=disable',
  ])('rejects every DEV URL query modifier: %s', (query) => {
    const url = `postgresql://bjc_dev:fixture-only@127.0.0.1:55432/buscador_juridico_civil_dev${query}`;
    expect(() => getDevelopmentDatabaseConfig(url)).toThrow(
      'El backend fuera de producción sólo puede conectarse',
    );
  });

  it('allows explicitly production-configured deployments to supply their own target', () => {
    process.env.NODE_ENV = 'production';
    const productionUrl = 'postgresql://service:anywhere@db.internal:5432/app';
    expect(assertDevelopmentDatabaseUrl(productionUrl)).toBe(productionUrl);
  });
});

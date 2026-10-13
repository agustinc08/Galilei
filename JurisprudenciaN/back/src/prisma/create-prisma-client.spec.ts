import { assertDevelopmentDatabaseUrl } from './create-prisma-client';

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
    const localUrl = 'postgresql://bjc_dev:fixture-only@127.0.0.1:55432/buscador_juridico_civil_dev';
    expect(assertDevelopmentDatabaseUrl(localUrl)).toBe(localUrl);
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

  it('allows explicitly production-configured deployments to supply their own target', () => {
    process.env.NODE_ENV = 'production';
    const productionUrl = 'postgresql://service:anywhere@db.internal:5432/app';
    expect(assertDevelopmentDatabaseUrl(productionUrl)).toBe(productionUrl);
  });
});

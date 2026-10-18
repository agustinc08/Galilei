import { resolveDeploymentEnvironment } from './deployment-environment';
import { validateRuntimeEnvironment } from './runtime-preflight';

describe('deployment runtime preflight', () => {
  it('keeps ordinary DEV and Jest identities in development', () => {
    expect(resolveDeploymentEnvironment({ NODE_ENV: 'development' })).toBe(
      'development',
    );
    expect(resolveDeploymentEnvironment({ NODE_ENV: 'test' })).toBe(
      'development',
    );
  });

  it('rejects marker mismatches before a preproduction or production runtime can initialize', () => {
    expect(() =>
      resolveDeploymentEnvironment({
        NODE_ENV: 'development',
        BJC_DEPLOYMENT_ENV: 'preprod',
      }),
    ).toThrow('BJC_DEPLOYMENT_ENV_NODE_ENV_MISMATCH');
    expect(() =>
      resolveDeploymentEnvironment({
        NODE_ENV: 'test',
        BJC_DEPLOYMENT_ENV: 'production',
      }),
    ).toThrow('BJC_DEPLOYMENT_ENV_NODE_ENV_MISMATCH');
    expect(() =>
      resolveDeploymentEnvironment({ NODE_ENV: 'production' }),
    ).toThrow('BJC_DEPLOYMENT_ENV_REQUIRED');
  });

  it('fails closed for PREPROD before Nest bootstrap when required identity is absent', () => {
    expect(() =>
      validateRuntimeEnvironment({
        NODE_ENV: 'production',
        BJC_DEPLOYMENT_ENV: 'preprod',
      }),
    ).toThrow(/Configuración incompleta/);
  });

  it('fails closed for PROD instead of inheriting DEV configuration', () => {
    expect(() =>
      validateRuntimeEnvironment({
        NODE_ENV: 'production',
        BJC_DEPLOYMENT_ENV: 'production',
      }),
    ).toThrow(/Configuración incompleta/);
  });
});

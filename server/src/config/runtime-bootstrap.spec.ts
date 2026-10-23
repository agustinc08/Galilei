import { createApplicationAfterPreflight } from './runtime-bootstrap';

describe('runtime bootstrap gate', () => {
  it('never constructs the Nest application when PREPROD guard config is missing', async () => {
    const createApplication = jest
      .fn()
      .mockResolvedValue({ initialized: true });
    await expect(
      createApplicationAfterPreflight(
        {
          NODE_ENV: 'production',
          BJC_DEPLOYMENT_ENV: 'preprod',
        },
        createApplication,
      ),
    ).rejects.toThrow(/Configuración incompleta/);
    expect(createApplication).not.toHaveBeenCalled();
  });

  it('never constructs the Nest application when PROD guard config is missing', async () => {
    const createApplication = jest
      .fn()
      .mockResolvedValue({ initialized: true });
    await expect(
      createApplicationAfterPreflight(
        {
          NODE_ENV: 'production',
          BJC_DEPLOYMENT_ENV: 'production',
        },
        createApplication,
      ),
    ).rejects.toThrow(/Configuración incompleta/);
    expect(createApplication).not.toHaveBeenCalled();
  });

  it('preserves regular DEV startup behavior', async () => {
    const application = { initialized: true };
    const result = await createApplicationAfterPreflight(
      { NODE_ENV: 'development' },
      () => Promise.resolve(application),
    );
    expect(result).toEqual({
      deploymentEnvironment: 'development',
      application,
    });
  });
});

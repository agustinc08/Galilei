import { validateRuntimeEnvironment } from './runtime-preflight';

/** Gate application construction so Nest lifecycle hooks cannot run before environment validation. */
export async function createApplicationAfterPreflight<T>(
  env: NodeJS.ProcessEnv,
  createApplication: () => Promise<T>,
) {
  const deploymentEnvironment = validateRuntimeEnvironment(env);
  const application = await createApplication();
  return { deploymentEnvironment, application };
}

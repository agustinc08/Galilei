import { resolveDeploymentEnvironment } from './deployment-environment';
import { validatePreproductionConfig } from './preprod-config';
import { validateProductionConfig } from './production-config';

/** Must complete before NestFactory.create, which initializes mutating startup providers. */
export function validateRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
) {
  const environment = resolveDeploymentEnvironment(env);
  if (environment === 'preprod') validatePreproductionConfig(env);
  if (environment === 'production') validateProductionConfig(env);
  return environment;
}

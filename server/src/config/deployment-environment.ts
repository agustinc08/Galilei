export type DeploymentEnvironment = 'development' | 'preprod' | 'production';

const ALLOWED_NODE_ENVIRONMENTS = new Set([
  'development',
  'test',
  'production',
]);
const ALLOWED_DEPLOYMENT_ENVIRONMENTS = new Set<DeploymentEnvironment>([
  'development',
  'preprod',
  'production',
]);

/** BJC_DEPLOYMENT_ENV is the resource identity; NODE_ENV must agree with its runtime class. */
export function resolveDeploymentEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): DeploymentEnvironment {
  const nodeEnvironment = env.NODE_ENV?.trim().toLowerCase() || 'development';
  if (!ALLOWED_NODE_ENVIRONMENTS.has(nodeEnvironment)) {
    throw new Error('NODE_ENV_INVALID');
  }

  const configured = env.BJC_DEPLOYMENT_ENV?.trim().toLowerCase();
  if (!configured) {
    if (nodeEnvironment === 'production') {
      throw new Error('BJC_DEPLOYMENT_ENV_REQUIRED');
    }
    return 'development';
  }

  if (
    !ALLOWED_DEPLOYMENT_ENVIRONMENTS.has(configured as DeploymentEnvironment)
  ) {
    throw new Error('BJC_DEPLOYMENT_ENV_INVALID');
  }

  const deploymentEnvironment = configured as DeploymentEnvironment;
  const productionRuntime = nodeEnvironment === 'production';
  const productionDeployment = deploymentEnvironment !== 'development';
  if (productionRuntime !== productionDeployment) {
    throw new Error('BJC_DEPLOYMENT_ENV_NODE_ENV_MISMATCH');
  }

  return deploymentEnvironment;
}

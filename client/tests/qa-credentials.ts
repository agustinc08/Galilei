import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export type E2eCredentials = {
  accounts: Record<string, { email: string; password: string }>;
};

function getQaRuntimeRoot() {
  const configuredRoot = process.env.BJC_E2E_RUNTIME_ROOT?.trim();
  if (!configuredRoot || !isAbsolute(configuredRoot)) {
    throw new Error('BJC_E2E_RUNTIME_ROOT debe apuntar a una carpeta QA aislada y absoluta.');
  }
  return resolve(configuredRoot);
}

function assertInside(root: string, target: string, label: string) {
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} debe permanecer dentro de BJC_E2E_RUNTIME_ROOT.`);
  }
}

export function loadE2eCredentials(): E2eCredentials {
  const credentialsPath = getE2eRuntimePath('BJC_E2E_CREDENTIALS_PATH');
  return JSON.parse(readFileSync(credentialsPath, 'utf8')) as E2eCredentials;
}

export function getE2eRuntimePath(variableName: string) {
  const runtimeRoot = getQaRuntimeRoot();
  const configuredPath = process.env[variableName]?.trim();
  if (!configuredPath || !isAbsolute(configuredPath)) {
    throw new Error(`${variableName} debe apuntar a un archivo QA aislado y absoluto.`);
  }
  const runtimePath = resolve(configuredPath);
  assertInside(runtimeRoot, runtimePath, variableName);
  return runtimePath;
}

export function getE2eArtifactPath(...segments: string[]) {
  const runtimeRoot = getQaRuntimeRoot();
  const configuredRoot = process.env.BJC_E2E_ARTIFACTS_ROOT?.trim();
  const artifactRoot = resolve(configuredRoot || resolve(runtimeRoot, 'e2e-artifacts'));
  assertInside(runtimeRoot, artifactRoot, 'BJC_E2E_ARTIFACTS_ROOT');
  const artifactPath = resolve(artifactRoot, ...segments);
  assertInside(artifactRoot, artifactPath, 'E2E artifact path');
  return artifactPath;
}

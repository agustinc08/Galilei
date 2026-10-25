import { defineConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const backendPort = process.env.BJC_PLAYWRIGHT_BACKEND_PORT ?? '4001';
const frontendPort = process.env.BJC_PLAYWRIGHT_FRONTEND_PORT ?? '4002';
const configuredRuntimeRoot = process.env.BJC_E2E_RUNTIME_ROOT?.trim();
if (!configuredRuntimeRoot || !isAbsolute(configuredRuntimeRoot)) {
  throw new Error('Define BJC_E2E_RUNTIME_ROOT con una ruta absoluta aislada antes de ejecutar Playwright.');
}
const e2eRuntimeRoot = resolve(configuredRuntimeRoot);
function assertInsideRuntime(path: string, label: string) {
  const pathFromRoot = relative(e2eRuntimeRoot, path);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} debe permanecer dentro de BJC_E2E_RUNTIME_ROOT.`);
  }
}
const e2eStoragePath = resolve(e2eRuntimeRoot, 'storage');
const e2eOutputPath = resolve(e2eRuntimeRoot, 'playwright-output');
const e2eArtifactPath = resolve(process.env.BJC_E2E_ARTIFACTS_ROOT?.trim() || resolve(e2eRuntimeRoot, 'e2e-artifacts'));
assertInsideRuntime(e2eStoragePath, 'BJC_PLAYWRIGHT_STORAGE_PATH');
assertInsideRuntime(e2eOutputPath, 'BJC_PLAYWRIGHT_OUTPUT_DIR');
assertInsideRuntime(e2eArtifactPath, 'BJC_E2E_ARTIFACTS_ROOT');
mkdirSync(e2eStoragePath, { recursive: true });
mkdirSync(e2eOutputPath, { recursive: true });

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  outputDir: e2eOutputPath,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
    reducedMotion: 'reduce',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/with-dev-db-guard.cjs serve',
      cwd: '../server',
      url: `http://127.0.0.1:${backendPort}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: backendPort,
        BJC_API_BIND_HOST: '127.0.0.1',
        FRONTEND_URLS: `http://127.0.0.1:${frontendPort}`,
        BJC_CORPUS_STORAGE_PATH: e2eStoragePath,
        OCR_ENABLED: 'true',
        API_RATE_LIMIT_AUTH_MAX: process.env.BJC_PLAYWRIGHT_AUTH_MAX ?? '200',
      },
    },
    {
      command: `pnpm.cmd exec vite --host 127.0.0.1 --strictPort --port ${frontendPort}`,
      url: `http://127.0.0.1:${frontendPort}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_API_URL: '/api',
        BJC_DEV_API_PROXY: `http://127.0.0.1:${backendPort}`,
      },
    },
  ],
});

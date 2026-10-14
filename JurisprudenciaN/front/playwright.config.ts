import { defineConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const backendPort = process.env.BJC_PLAYWRIGHT_BACKEND_PORT ?? '4001';
const frontendPort = process.env.BJC_PLAYWRIGHT_FRONTEND_PORT ?? '4002';
const e2eStoragePath = resolve(process.cwd(), '../../_dev-corpus-storage-test/sprint1561-e2e');
mkdirSync(e2eStoragePath, { recursive: true });

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  outputDir: '../../_recovery-work/sprint1561/playwright-output',
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/with-dev-db-guard.cjs serve',
      cwd: '../back',
      url: `http://127.0.0.1:${backendPort}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: backendPort,
        FRONTEND_URLS: `http://127.0.0.1:${frontendPort}`,
        BJC_CORPUS_STORAGE_PATH: e2eStoragePath,
        OCR_ENABLED: 'true',
      },
    },
    {
      command: `.\\node_modules\\.bin\\next.cmd start -H 127.0.0.1 -p ${frontendPort}`,
      url: `http://127.0.0.1:${frontendPort}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${backendPort}/api` },
    },
  ],
});

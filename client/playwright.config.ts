import { defineConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const backendPort = process.env.BJC_PLAYWRIGHT_BACKEND_PORT ?? '4001';
const frontendPort = process.env.BJC_PLAYWRIGHT_FRONTEND_PORT ?? '4002';
const e2eStoragePath = process.env.BJC_PLAYWRIGHT_STORAGE_PATH
  ? resolve(process.cwd(), process.env.BJC_PLAYWRIGHT_STORAGE_PATH)
  : resolve(process.cwd(), '../_dev-corpus-storage-test/sprint1561-e2e');
mkdirSync(e2eStoragePath, { recursive: true });
const e2eOutputPath = process.env.BJC_PLAYWRIGHT_OUTPUT_DIR
  ? resolve(process.cwd(), process.env.BJC_PLAYWRIGHT_OUTPUT_DIR)
  : resolve(process.cwd(), '../_recovery-work/sprint1561/playwright-output');
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
        FRONTEND_URLS: `http://127.0.0.1:${frontendPort}`,
        BJC_CORPUS_STORAGE_PATH: e2eStoragePath,
        OCR_ENABLED: 'true',
        API_RATE_LIMIT_AUTH_MAX: process.env.BJC_PLAYWRIGHT_AUTH_MAX ?? '200',
      },
    },
    {
      command: `pnpm.cmd run dev:qa -- --port ${frontendPort}`,
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

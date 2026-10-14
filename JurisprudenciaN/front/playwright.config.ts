import { defineConfig } from '@playwright/test';

const backendPort = process.env.BJC_PLAYWRIGHT_BACKEND_PORT ?? '4001';
const frontendPort = process.env.BJC_PLAYWRIGHT_FRONTEND_PORT ?? '4002';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  outputDir: '../../_recovery-work/sprint154a/playwright-output',
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
      },
    },
    {
      command: `pnpm exec next start -H 127.0.0.1 -p ${frontendPort}`,
      url: `http://127.0.0.1:${frontendPort}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${backendPort}/api` },
    },
  ],
});

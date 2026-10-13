import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  outputDir: '../../_recovery-work/sprint123/acceptance/playwright-output',
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4002',
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
      url: 'http://localhost:4001/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { PORT: '4001' },
    },
    {
      command: 'pnpm exec next start -H 127.0.0.1 -p 4002',
      url: 'http://localhost:4002/login',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4001/api' },
    },
  ],
});

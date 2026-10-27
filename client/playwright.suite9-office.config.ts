import { defineConfig } from '@playwright/test';
import { join } from 'node:path';

const frontendPort = process.env.BJC_SPRINT9_REAL_FRONTEND_PORT ?? '4613';
const backendPort = process.env.BJC_SPRINT9_REAL_BACKEND_PORT ?? '4011';

export default defineConfig({
  testDir: './tests',
  testMatch: 'suite9-office-viewer.real.e2e.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  outputDir: join(
    process.env.BJC_SPRINT9_REAL_EVIDENCE_ROOT ?? 'test-results',
    'playwright-results',
  ),
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    browserName: 'chromium',
    ...(process.platform === 'win32' ? { channel: 'msedge' as const } : {}),
    headless: true,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --strictPort --port ${frontendPort}`,
    url: `http://127.0.0.1:${frontendPort}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_API_URL: '/api',
      BJC_DEV_API_PROXY: `http://127.0.0.1:${backendPort}`,
    },
  },
});

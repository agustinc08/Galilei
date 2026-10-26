import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const frontendPort = process.env.BJC_RESEARCH_E2E_FRONTEND_PORT ?? '4612';

export default defineConfig({
  testDir: './tests',
  testMatch: 'research-continuity.e2e.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  outputDir: join(tmpdir(), 'galilei-research-suite-2-playwright'),
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    browserName: 'chromium',
    ...(process.platform === 'win32' ? { channel: 'msedge' as const } : {}),
    headless: true,
    reducedMotion: 'reduce',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --strictPort --port ${frontendPort}`,
    url: `http://127.0.0.1:${frontendPort}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_API_URL: '/api' },
  },
});

import { defineConfig } from '@playwright/test';

const frontendPort = process.env.BJC_RESEARCH_FRONTEND_PORT ?? '4012';

export default defineConfig({
  testDir: './tests',
  testMatch: 'research-continuity.e2e.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
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
  webServer: {
    command: `pnpm.cmd exec vite --host 127.0.0.1 --strictPort --port ${frontendPort}`,
    cwd: '.',
    url: `http://127.0.0.1:${frontendPort}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_API_URL: '/api',
      BJC_DEV_API_PROXY: 'http://127.0.0.1:9',
    },
  },
});

import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import paths from './paths.cjs';

const configDir = path.dirname(fileURLToPath(import.meta.url));

const baseURL = process.env.UX_QA_BASE_URL;

if (!baseURL) {
  throw new Error('UX_QA_BASE_URL was not set by the local runner. Set it to an already-running local preview or use the npm QA scripts.');
}
const baseHost = new URL(baseURL).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(baseHost)) {
  throw new Error('UX QA only accepts a loopback preview URL. Do not point it at production or institutional services.');
}

export default defineConfig({
  testDir: path.resolve(configDir, '../tests'),
  testMatch: 'ux-*.spec.cjs',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: paths.playwrightOutputDir,
  reporter: [['list'], [path.resolve(configDir, 'reporter.cjs')]],
  use: {
    baseURL,
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    trace: 'off',
    screenshot: 'off',
    actionTimeout: 10_000,
  },
});

import { defineConfig } from '@playwright/test';
import { isAbsolute } from 'node:path';

const required = [
  'BJC_DEPLOYMENT_ENV', 'NODE_ENV', 'BJC_PREPROD_DATABASE_APPROVED', 'BJC_PREPROD_FRONTEND_ORIGIN',
  'BJC_PREPROD_API_ORIGIN', 'BJC_PREPROD_SMOKE_EMAIL', 'BJC_PREPROD_SMOKE_PASSWORD',
  'BJC_PREPROD_SMOKE_DOCUMENT_ID', 'BJC_RELEASE_ID', 'BJC_BACKEND_BUILD_ID', 'BJC_FRONTEND_BUILD_ID',
  'BJC_PREPROD_REPORT_PATH',
];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) throw new Error(`Preprod smoke detenido: faltan variables explícitas (${missing.join(', ')}).`);
if (process.env.NODE_ENV !== 'production' || process.env.BJC_DEPLOYMENT_ENV !== 'preprod' || process.env.BJC_PREPROD_DATABASE_APPROVED !== 'true') {
  throw new Error('Preprod smoke detenido: requiere NODE_ENV=production, destino preprod y aprobación DB explícita.');
}
for (const key of ['BJC_PREPROD_FRONTEND_ORIGIN', 'BJC_PREPROD_API_ORIGIN']) {
  const value = process.env[key]!;
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.origin !== value || ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new Error(`${key} debe ser un origin HTTPS preprod explícito, fuera de loopback.`);
  }
}
if (!isAbsolute(process.env.BJC_PREPROD_REPORT_PATH!)) throw new Error('BJC_PREPROD_REPORT_PATH debe ser absoluto.');

export default defineConfig({
  testDir: './preprod-tests',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.BJC_PREPROD_FRONTEND_ORIGIN,
    browserName: 'chromium',
    headless: true,
    trace: 'off',
    screenshot: 'off',
  },
});

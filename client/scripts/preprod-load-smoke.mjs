#!/usr/bin/env node
// Small approved-window concurrency smoke, not a capacity/load test.
import { openSync, writeFileSync, closeSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const required = [
  'NODE_ENV', 'BJC_DEPLOYMENT_ENV', 'BJC_PREPROD_DATABASE_APPROVED', 'BJC_PREPROD_LOAD_APPROVED',
  'BJC_PREPROD_API_ORIGIN', 'BJC_PREPROD_LOAD_EMAIL', 'BJC_PREPROD_LOAD_PASSWORD',
  'BJC_RELEASE_ID', 'BJC_PREPROD_REPORT_PATH',
];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) throw new Error(`Load smoke detenido: faltan variables explícitas (${missing.join(', ')}).`);
if (process.env.NODE_ENV !== 'production' || process.env.BJC_DEPLOYMENT_ENV !== 'preprod' ||
    process.env.BJC_PREPROD_DATABASE_APPROVED !== 'true' || process.env.BJC_PREPROD_LOAD_APPROVED !== 'true') {
  throw new Error('Load smoke detenido: requiere runtime production/preprod y aprobación específica de ventana/carga.');
}
const api = new URL(process.env.BJC_PREPROD_API_ORIGIN);
if (api.protocol !== 'https:' || api.origin !== process.env.BJC_PREPROD_API_ORIGIN ||
    ['localhost', '127.0.0.1', '::1'].includes(api.hostname)) {
  throw new Error('BJC_PREPROD_API_ORIGIN debe ser un origin HTTPS preprod fuera de loopback.');
}
const reportPath = resolve(process.env.BJC_PREPROD_REPORT_PATH);
if (!process.env.BJC_PREPROD_REPORT_PATH.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(process.env.BJC_PREPROD_REPORT_PATH)) {
  throw new Error('BJC_PREPROD_REPORT_PATH debe ser una ruta absoluta.');
}

const errors = [];
const waves = [];
const query = 'responsabilidad';
async function main() {
  const health = await fetch(`${api.origin}/api/health/ready`);
  if (!health.ok) throw new Error('Readiness failed; no concurrency requests were sent.');
  const login = await fetch(`${api.origin}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.BJC_PREPROD_LOAD_EMAIL, password: process.env.BJC_PREPROD_LOAD_PASSWORD }),
  });
  if (!login.ok) throw new Error('Load smoke login failed; no concurrency requests were sent.');
  const { accessToken } = await login.json();
  if (!accessToken) throw new Error('Load smoke login response did not include an access token.');

  for (const virtualUsers of [1, 5, 10]) {
    const results = await Promise.all(Array.from({ length: virtualUsers }, async () => {
      const started = performance.now();
      try {
        const response = await fetch(`${api.origin}/api/busqueda/avanzada?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000),
        });
        const body = response.ok ? await response.json() : null;
        return { status: response.status, elapsedMs: Math.round(performance.now() - started), valid: Array.isArray(body?.data) };
      } catch {
        return { status: 0, elapsedMs: Math.round(performance.now() - started), valid: false };
      }
    }));
    const sorted = results.map((item) => item.elapsedMs).sort((a, b) => a - b);
    const percentile = (p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
    const errorCount = results.filter((item) => item.status < 200 || item.status >= 300 || !item.valid).length;
    if (errorCount) errors.push(`concurrency_${virtualUsers}_errors`);
    waves.push({ virtualUsers, requests: results.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), errors: errorCount });
  }

  const report = {
    environment: 'preprod', releaseId: process.env.BJC_RELEASE_ID, origin: api.origin,
    generatedAt: new Date().toISOString(), type: 'approved-concurrency-smoke',
    waves, errors, queryTextPersisted: false, credentialPersisted: false,
    result: errors.length ? 'FAIL' : 'PASS',
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  const fd = openSync(reportPath, 'wx');
  try { writeFileSync(fd, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); } finally { closeSync(fd); }
  console.log(JSON.stringify({ reportPath, result: report.result, waves }));
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`PREPROD_LOAD_SMOKE=ABORT; ${error instanceof Error ? error.message : 'load smoke failed'}`);
  process.exitCode = 1;
});

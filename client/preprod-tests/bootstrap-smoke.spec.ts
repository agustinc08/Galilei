import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const frontendOrigin = process.env.BJC_PREPROD_FRONTEND_ORIGIN!;
const apiOrigin = process.env.BJC_PREPROD_API_ORIGIN!;
const reportPath = resolve(process.env.BJC_PREPROD_REPORT_PATH!);

test('preprod bootstrap smoke: health, login, search families, document range, logout', async ({ page, request }) => {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const searchTimings: Array<{ family: string; status: number; elapsedMs: number }> = [];
  const report: Record<string, unknown> = {
    environment: 'preprod',
    releaseId: process.env.BJC_RELEASE_ID,
    backendBuildId: process.env.BJC_BACKEND_BUILD_ID,
    frontendBuildId: process.env.BJC_FRONTEND_BUILD_ID,
    generatedAt: startedAt,
    origin: frontendOrigin,
    health: null,
    databaseMigrationStatus: null,
    corpus: null,
    projection: null,
    searchTimings,
    errors,
    queryTextPersisted: false,
    credentialPersisted: false,
  };

  try {
    const ready = await request.get(`${apiOrigin}/api/health/ready`);
    report.health = { status: ready.status(), ok: ready.ok() };
    if (!ready.ok()) errors.push('health_ready_failed');

    const login = await request.post(`${apiOrigin}/api/auth/login`, {
      data: { email: process.env.BJC_PREPROD_SMOKE_EMAIL, password: process.env.BJC_PREPROD_SMOKE_PASSWORD },
    });
    if (!login.ok()) {
      errors.push('login_failed');
    } else {
      const loginBody = await login.json() as { accessToken?: string };
      if (!loginBody.accessToken) errors.push('login_token_missing');
      else {
        const headers = { Authorization: `Bearer ${loginBody.accessToken}` };
        const families = [
          ['TERM', 'responsabilidad'], ['PHRASE', '"responsabilidad civil"'], ['PREFIX', 'responsabilid%'],
          ['SUFFIX', '%civil'], ['SHORT', 'de'], ['AND', 'responsabilidad AND contrato'],
          ['OR', 'responsabilidad OR contrato'], ['NOT', 'responsabilidad NOT mediacion'],
        ] as const;
        for (const [family, query] of families) {
          const start = Date.now();
          const response = await request.get(`${apiOrigin}/api/busqueda/avanzada`, { headers, params: { q: query } });
          searchTimings.push({ family, status: response.status(), elapsedMs: Date.now() - start });
          if (!response.ok()) errors.push(`search_${family.toLowerCase()}_failed`);
          else {
            const body = await response.json() as { data?: unknown };
            if (!Array.isArray(body.data)) errors.push(`search_${family.toLowerCase()}_response_invalid`);
          }
        }

        const documentId = process.env.BJC_PREPROD_SMOKE_DOCUMENT_ID!;
        const document = await request.get(`${apiOrigin}/api/corpus/documents/${encodeURIComponent(documentId)}`, { headers });
        if (!document.ok()) errors.push('document_open_failed');
        const range = await request.get(`${apiOrigin}/api/corpus/documents/${encodeURIComponent(documentId)}/file`, {
          headers: { ...headers, Range: 'bytes=0-31' },
        });
        if (range.status() !== 206) errors.push('pdf_range_failed');

        await page.goto('/login');
        await page.getByLabel('Correo electrónico').fill(process.env.BJC_PREPROD_SMOKE_EMAIL!);
        await page.getByLabel('Contraseña').fill(process.env.BJC_PREPROD_SMOKE_PASSWORD!);
        await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
        await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
        await page.goto(`${frontendOrigin}/corpus/${encodeURIComponent(documentId)}`);
        await expect(page.getByRole('heading', { name: 'Datos y procedencia' })).toBeVisible({ timeout: 30_000 });
        const logout = page.getByRole('button', { name: 'Cerrar sesión' });
        await expect(logout).toBeVisible();
        await logout.click();
        await expect(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 15_000 });
      }
    }

    const backDirectory = resolve(process.cwd(), '../server');
    const output = execFileSync(process.execPath, ['scripts/with-preprod-db-guard.cjs', 'db-report'], {
      cwd: backDirectory,
      env: process.env,
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const dbReportLine = output.split(/\r?\n/u).filter((line) => line.startsWith('{')).at(-1);
    if (!dbReportLine) throw new Error('Guarded database report JSON is missing.');
    const dbReport = JSON.parse(dbReportLine) as Record<string, unknown>;
    report.databaseMigrationStatus = { applied: dbReport.appliedMigrations, pending: dbReport.pendingMigrations };
    report.corpus = { documents: dbReport.corpusDocuments, files: dbReport.corpusFiles, bytes: dbReport.corpusBytes };
    report.projection = { ready: dbReport.projectionReady, staleDocuments: dbReport.staleDocuments };
    if (Number(dbReport.pendingMigrations) !== 0) errors.push('database_migrations_pending');
    if (dbReport.projectionReady !== true || Number(dbReport.staleDocuments) !== 0) errors.push('search_projection_not_ready');
  } catch {
    errors.push('smoke_execution_failed');
  } finally {
    report.completedAt = new Date().toISOString();
    report.result = errors.length ? 'FAIL' : 'PASS';
    mkdirSync(dirname(reportPath), { recursive: true });
    const fd = openSync(reportPath, 'wx');
    try { writeFileSync(fd, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); } finally { closeSync(fd); }
    console.log(JSON.stringify({ acceptanceReport: reportPath, result: report.result, errorCount: errors.length }));
  }

  expect(errors).toEqual([]);
  expect(searchTimings).toHaveLength(8);
  expect(report.health).toMatchObject({ ok: true });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const credentials = JSON.parse(readFileSync(resolve(process.cwd(), '../../_recovery-work/sprint10/acceptance/credentials.json'), 'utf8')) as {
  accounts: Record<string, { email: string; password: string }>;
};
const apiBase = 'http://localhost:4001/api';

test('LECTOR ejecuta una búsqueda normal desde la interfaz y recibe resultados completos', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.reader.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.reader.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/busqueda-avanzada$/);

  await page.getByLabel('Buscar en jurisprudencia y documentos').fill('responsabilidad');
  const apiResponse = page.waitForResponse((response) =>
    response.url().includes('/api/busqueda/avanzada') && response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Buscar', exact: true }).last().click();
  const response = await apiResponse;
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { data: unknown[]; federated?: { partial?: boolean } };
  expect(body.data.length).toBeGreaterThan(0);
  expect(body.federated?.partial).toBe(false);
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
});

test('LECTOR inicia sesión, busca en una colección Digesto y abre PDF con texto resaltado', async ({ page, request }) => {
  const login = await request.post(`${apiBase}/auth/login`, { data: credentials.accounts.reader });
  expect(login.ok()).toBeTruthy();
  const token = (await login.json()).accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  const collectionsResponse = await request.get(`${apiBase}/corpus/curation/digesto/collections`, { headers });
  expect(collectionsResponse.ok()).toBeTruthy();
  const collections = await collectionsResponse.json() as Array<{ id: string; name: string; _count: { memberships: number } }>;
  const collection = collections.find((item) => item._count.memberships > 0);
  expect(collection).toBeTruthy();

  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.reader.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.reader.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/busqueda-avanzada$/);
  await expect(page.getByRole('link', { name: 'Administración' })).toHaveCount(0);

  await page.getByLabel('Colección Digesto').selectOption(collection!.id);
  const searchStarted = Date.now();
  await page.getByRole('button', { name: 'Buscar', exact: true }).last().click();
  const firstResult = page.getByRole('link', { name: 'Abrir documento' }).first();
  await expect(firstResult).toBeVisible({ timeout: 60_000 });
  const searchRenderMs = Date.now() - searchStarted;
  const resultHref = await firstResult.getAttribute('href');
  const documentId = resultHref?.match(/\/corpus\/([^?]+)/)?.[1];
  expect(documentId).toBeTruthy();
  const metadata = await request.get(`${apiBase}/corpus/documents/${documentId}`, { headers, params: { pageNumber: 1 } });
  const pageText = (await metadata.json()).selectedPage.text as string;
  let searchTerm = '';
  for (const candidate of [...new Set(pageText.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{5,}/gu) ?? [])].slice(0, 12)) {
    const matchCheck = await request.get(`${apiBase}/corpus/documents/${documentId}/matches`, { headers, params: { q: candidate } });
    if (((await matchCheck.json()).total as number) > 0) { searchTerm = candidate; break; }
  }
  expect(searchTerm).toBeTruthy();
  const started = Date.now();
  await firstResult.click();
  await expect(page).toHaveURL(/\/corpus\//);
  await expect(page.locator('.react-pdf__Page')).toBeVisible({ timeout: 60_000 });
  const viewerMs = Date.now() - started;
  await page.getByLabel('Buscar en este documento').fill(searchTerm);
  await page.getByRole('button', { name: 'Buscar', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Coincidencias' })).toBeVisible();
  await expect(page.locator('.react-pdf__Page__textContent mark').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Datos y procedencia' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar a revisión' })).toHaveCount(0);
  expect(viewerMs).toBeGreaterThan(0);
  console.log(JSON.stringify({ metric: 'pilot-ui', searchResultsVisibleMs: searchRenderMs, pdfPageVisibleMs: viewerMs }));
});

test('API expone cabeceras de seguridad del piloto', async ({ request }) => {
  const response = await request.get(`${apiBase}/health`);
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).checks).toEqual({ api: 'ok', database: 'ok', storage: 'ok' });
  expect((await request.get(`${apiBase}/health/live`)).ok()).toBeTruthy();
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['x-frame-options']).toBe('SAMEORIGIN');
  expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(response.headers()['permissions-policy']).toContain('camera=()');
});

test('ADMIN inicia sesión y ve el dashboard operativo', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.admin.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.admin.password);
  const dashboardStarted = Date.now();
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Panel institucional' })).toBeVisible();
  await expect(page.getByText('Documentos Digesto')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  console.log(JSON.stringify({ metric: 'dashboard-ui', visibleMs: Date.now() - dashboardStarted }));
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('REVISOR, JURISPRUDENCIA y DIGESTO sólo ven navegación de su rol', async ({ page }) => {
  const cases = [
    { account: credentials.accounts.reviewer, visible: ['Revisión'], hidden: ['Digesto', 'Administración', 'Panel institucional'] },
    { account: credentials.accounts.jurisprudencia, visible: ['Jurisprudencia', 'Revisión'], hidden: ['Digesto', 'Administración', 'Panel institucional'] },
    { account: credentials.accounts.digesto, visible: ['Digesto'], hidden: ['Jurisprudencia', 'Revisión', 'Administración', 'Panel institucional'] },
  ];
  for (const scenario of cases) {
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill(scenario.account.email);
    await page.getByLabel('Contraseña').fill(scenario.account.password);
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Buscar', exact: true })).toBeVisible();
    for (const label of scenario.visible) await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible();
    for (const label of scenario.hidden) await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
});

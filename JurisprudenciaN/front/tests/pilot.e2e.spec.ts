import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const credentials = JSON.parse(readFileSync(resolve(process.cwd(), '../../_recovery-work/sprint10/acceptance/credentials.json'), 'utf8')) as {
  accounts: Record<string, { email: string; password: string }>;
};
const apiBase = `http://127.0.0.1:${process.env.BJC_PLAYWRIGHT_BACKEND_PORT ?? '4001'}/api`;

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
  const screenshotDir = resolve(process.cwd(), '../../_recovery-work/sprint155/screenshots');
  mkdirSync(screenshotDir, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(screenshotDir, 'search-general-1366.png'), fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(screenshotDir, 'search-general-1920.png'), fullPage: true });
});

test('LECTOR abre un PDF con resaltado visual seguro o fallback explícito', async ({ page, request }) => {
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
  const activeMark = page.locator('.bjc-pdf-match-current');
  const mappingFallback = page.getByText(/Coincidencia encontrada en el texto indexado/u);
  await expect.poll(async () => (await activeMark.count()) > 0 || (await mappingFallback.count()) > 0, { timeout: 30_000 }).toBe(true);
  const hasHighlight = (await activeMark.count()) > 0;
  if (hasHighlight) await expect(activeMark.first()).toBeVisible();
  else {
    await expect(mappingFallback).toBeVisible();
    await expect(activeMark).toHaveCount(0);
  }
  if (process.env.BJC_CAPTURE_VIEWER_SCREENSHOTS === 'true') {
    const screenshotDir = resolve(process.cwd(), '../../_recovery-work/sprint1532/screenshots');
    const sprint155ScreenshotDir = resolve(process.cwd(), '../../_recovery-work/sprint155/screenshots');
    const canvas = page.locator('.react-pdf__Page__canvas').first();
    mkdirSync(screenshotDir, { recursive: true });
    mkdirSync(sprint155ScreenshotDir, { recursive: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    const sampledInk = () => canvas.evaluate((element) => {
      const canvasElement = element as HTMLCanvasElement;
      const pixels = canvasElement.getContext('2d')?.getImageData(0, 0, canvasElement.width, canvasElement.height).data;
      let count = 0;
      if (pixels) for (let index = 0; index < pixels.length; index += 4 * 64) {
        if (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245) count += 1;
      }
      return count;
    });
    if (hasHighlight) {
      await expect(canvas).toBeVisible();
      await expect.poll(sampledInk, { timeout: 30_000 }).toBeGreaterThan(0);
    }
    const renderMetrics = await page.evaluate(() => {
      const canvasElement = document.querySelector<HTMLCanvasElement>('.react-pdf__Page__canvas');
      const textLayer = document.querySelector<HTMLElement>('.react-pdf__Page__textContent');
      const mark = document.querySelector<HTMLElement>('.bjc-pdf-match-current');
      const pixels = canvasElement?.getContext('2d')?.getImageData(0, 0, canvasElement.width, canvasElement.height).data;
      let nonWhiteSamples = 0;
      if (pixels) for (let index = 0; index < pixels.length; index += 4 * 64) {
        if (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245) nonWhiteSamples += 1;
      }
      const rect = (element: HTMLElement | null) => {
        if (!element) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        canvas: canvasElement ? { width: canvasElement.width, height: canvasElement.height, nonWhiteSamples, rect: rect(canvasElement) } : null,
        textLayer: textLayer ? { textLength: textLayer.textContent?.length ?? 0, rect: rect(textLayer), color: getComputedStyle(textLayer).color } : null,
        mark: mark ? { textLength: mark.textContent?.length ?? 0, rect: rect(mark), background: getComputedStyle(mark).backgroundColor } : null,
      };
    });
    if (hasHighlight) {
      expect(renderMetrics.canvas?.nonWhiteSamples).toBeGreaterThan(0);
      expect(renderMetrics.mark?.background).toBe('rgb(251, 146, 60)');
    } else {
      expect(renderMetrics.mark).toBeNull();
      await expect(mappingFallback).toBeVisible();
    }
    console.log(`PDF_VISUAL_RENDER_METRICS=${JSON.stringify(renderMetrics)}`);
    if (hasHighlight) await expect(activeMark.first()).toBeVisible();
    else await expect(mappingFallback).toBeVisible();
    await page.screenshot({ path: resolve(screenshotDir, 'real-viewer-default.png'), fullPage: true });
    await page.screenshot({ path: resolve(sprint155ScreenshotDir, 'viewer-native-highlight.png'), fullPage: true });
    await page.setViewportSize({ width: 1093, height: 614 });
    if (hasHighlight) await expect(activeMark.first()).toBeVisible();
    else await expect(mappingFallback).toBeVisible();
    if (hasHighlight) await expect.poll(sampledInk, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: resolve(screenshotDir, 'real-viewer-zoom-in.png'), fullPage: true });
    await page.setViewportSize({ width: 1708, height: 960 });
    if (hasHighlight) await expect(activeMark.first()).toBeVisible();
    else await expect(mappingFallback).toBeVisible();
    if (hasHighlight) await expect.poll(sampledInk, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: resolve(screenshotDir, 'real-viewer-zoom-out.png'), fullPage: true });
    await page.setViewportSize({ width: 900, height: 768 });
    if (hasHighlight) await expect(activeMark.first()).toBeVisible();
    else await expect(mappingFallback).toBeVisible();
    if (hasHighlight) await expect.poll(sampledInk, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: resolve(screenshotDir, 'real-viewer-resized.png'), fullPage: true });
  }
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

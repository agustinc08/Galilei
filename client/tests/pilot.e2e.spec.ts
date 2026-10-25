import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { getE2eArtifactPath, loadE2eCredentials } from './qa-credentials';

const credentials = loadE2eCredentials();
const apiBase = `http://127.0.0.1:${process.env.BJC_PLAYWRIGHT_BACKEND_PORT ?? '4001'}/api`;

test('LECTOR ejecuta una búsqueda normal desde la interfaz y recibe resultados completos', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.reader.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.reader.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/galilei$/);
  await expect(page.getByRole('heading', { name: '¿Qué querés consultar?' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Secciones principales' }).getByRole('link')).toHaveCount(3);
  await page.goto('/busqueda-avanzada');

  await page.getByLabel('Buscar jurisprudencia').fill('responsabilidad');
  const apiResponse = page.waitForResponse((response) =>
    response.url().includes('/api/busqueda/avanzada') && response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Buscar', exact: true }).last().click();
  const response = await apiResponse;
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { data: unknown[]; federated?: { partial?: boolean } };
  expect(body.federated?.partial).toBe(false);
  if (body.data.length > 0) {
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(page.getByText('Sin resultados', { exact: true })).toBeVisible({ timeout: 30_000 });
  }
  const screenshotDir = getE2eArtifactPath('pilot', 'screenshots');
  mkdirSync(screenshotDir, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(screenshotDir, 'search-general-1366.png'), fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(screenshotDir, 'search-general-1920.png'), fullPage: true });
});

test('LECTOR abre un PDF con resaltado visual seguro o fallback explícito', async ({ page, request }) => {
  test.skip(
    !process.env.BJC_PLAYWRIGHT_STORAGE_PATH,
    'La suite usa almacenamiento aislado sin los blobs Corpus existentes; este smoke se ejecuta aparte en almacenamiento Corpus de sólo lectura.',
  );
  const login = await request.post(`${apiBase}/auth/login`, { data: credentials.accounts.reader });
  expect(login.ok()).toBeTruthy();
  const token = (await login.json()).accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  const collectionsResponse = await request.get(`${apiBase}/corpus/curation/digesto/collections`, { headers });
  expect(collectionsResponse.ok()).toBeTruthy();
  const collections = await collectionsResponse.json() as Array<{ id: string; name: string; _count: { memberships: number } }>;
  let selectedCollection: (typeof collections)[number] | undefined;
  let selected: { sourceId: string; document: { href: string; mimeType: string | null } } | undefined;
  let searchTerm = '';
  for (const collection of collections.filter((item) => item._count.memberships > 0)) {
    const collectionUrl = new URL(`${apiBase}/busqueda/avanzada`);
    collectionUrl.searchParams.set('digestoCollectionId', collection.id);
    collectionUrl.searchParams.set('page', '1');
    collectionUrl.searchParams.set('pageSize', '50');
    const collectionSearch = await request.get(collectionUrl.toString(), { headers });
    if (!collectionSearch.ok()) continue;
    const collectionBody = await collectionSearch.json() as {
      federated?: { results?: Array<{ sourceId: string; title?: string; document?: { href?: string; mimeType?: string | null } }> };
    };
    for (const candidate of collectionBody.federated?.results ?? []) {
      if (!candidate.document?.href || candidate.document.mimeType !== 'application/pdf') continue;
      const fileResponse = await request.get(new URL(candidate.document.href, apiBase).toString(), {
        headers: { ...headers, Range: 'bytes=0-31' },
      });
      if (fileResponse.status() !== 200 && fileResponse.status() !== 206) continue;
      const bytes = await fileResponse.body();
      if (!fileResponse.headers()['content-type']?.toLowerCase().includes('application/pdf')
        || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') continue;

      const metadataResponse = await request.get(`${apiBase}/corpus/documents/${candidate.sourceId}`, {
        headers,
        params: { pageNumber: 1 },
      });
      if (!metadataResponse.ok()) continue;
      const metadata = await metadataResponse.json() as { selectedPage?: { text?: string } };
      const words = [...new Set(`${candidate.title ?? ''} ${metadata.selectedPage?.text ?? ''}`
        .match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{5,}/gu) ?? [])]
        .sort((left, right) => right.length - left.length)
        .slice(0, 16);
      for (const word of words) {
        const termUrl = new URL(`${apiBase}/busqueda/avanzada`);
        termUrl.searchParams.set('q', word);
        termUrl.searchParams.set('digestoCollectionId', collection.id);
        termUrl.searchParams.set('page', '1');
        termUrl.searchParams.set('pageSize', '50');
        const termResponse = await request.get(termUrl.toString(), { headers });
        if (!termResponse.ok()) continue;
        const termBody = await termResponse.json() as {
          federated?: { results?: Array<{ sourceId: string }> };
        };
        if (termBody.federated?.results?.some((result) => result.sourceId === candidate.sourceId)) {
          selectedCollection = collection;
          selected = { sourceId: candidate.sourceId, document: { href: candidate.document.href, mimeType: candidate.document.mimeType } };
          searchTerm = word;
          break;
        }
      }
      if (selected) break;
    }
    if (selected) break;
  }
  expect(selected, 'Debe existir en una colección un PDF Corpus real, indexado y descargable.').toBeTruthy();
  expect(selectedCollection).toBeTruthy();

  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.reader.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.reader.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/galilei$/);
  await expect(page.getByRole('navigation', { name: 'Secciones principales' }).getByRole('link')).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Administración técnica' })).toHaveCount(0);
  await page.goto('/busqueda-avanzada');

  await page.getByLabel('Colección Digesto').selectOption(selectedCollection!.id);
  await page.getByLabel('Buscar jurisprudencia').fill(searchTerm);
  const searchStarted = Date.now();
  const searchResponse = page.waitForResponse((response) =>
    response.url().includes('/api/busqueda/avanzada')
      && response.request().method() === 'GET'
      && new URL(response.url()).searchParams.get('q') === searchTerm,
  );
  await page.getByRole('button', { name: 'Buscar', exact: true }).last().click();
  const response = await searchResponse;
  expect(response.ok()).toBeTruthy();
  const documentId = selected!.sourceId;
  const firstResult = page.locator(`a[href^="/corpus/${documentId}?"]`);
  await expect(firstResult).toBeVisible({ timeout: 60_000 });
  const searchRenderMs = Date.now() - searchStarted;
  const matchCheck = await request.get(`${apiBase}/corpus/documents/${documentId}/matches`, { headers, params: { q: searchTerm } });
  expect(((await matchCheck.json()).total as number)).toBeGreaterThan(0);
  const started = Date.now();
  await firstResult.click();
  await expect(page).toHaveURL(/\/corpus\//);
  const pdfRenderFallback = page.getByText('No se pudo renderizar el PDF. Podés usar la descarga y el contexto lateral.');
  await expect.poll(async () =>
    (await page.locator('.react-pdf__Page').count()) > 0 || await pdfRenderFallback.isVisible().catch(() => false),
    { timeout: 60_000 },
  ).toBe(true);
  if (await pdfRenderFallback.isVisible().catch(() => false)) {
    throw new Error('El Viewer abrió el documento pero sólo mostró el fallback de descarga; no se certifica el renderizado PDF.');
  }
  await expect(page.locator('.react-pdf__Page')).toBeVisible({ timeout: 60_000 });
  const viewerMs = Date.now() - started;
  await page.getByLabel('Buscar en este documento').fill(searchTerm);
  await page.getByRole('button', { name: 'Buscar', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Coincidencias' })).toBeVisible();
  const activeMark = page.locator('.bjc-pdf-match-current');
  const mappingFallback = page.getByText(
    /Encontramos la coincidencia en el texto del documento, pero no pudimos señalarla en la página/u,
  );
  await expect.poll(async () => (await activeMark.count()) > 0 || (await mappingFallback.count()) > 0, { timeout: 30_000 }).toBe(true);
  const hasHighlight = (await activeMark.count()) > 0;
  if (hasHighlight) await expect(activeMark.first()).toBeVisible();
  else {
    await expect(mappingFallback).toBeVisible();
    await expect(activeMark).toHaveCount(0);
  }
  if (process.env.BJC_CAPTURE_VIEWER_SCREENSHOTS === 'true') {
    const screenshotDir = getE2eArtifactPath('pilot-pdf', 'screenshots');
    const sprint155ScreenshotDir = getE2eArtifactPath('pilot', 'screenshots');
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
      expect(renderMetrics.canvas?.width).toBeGreaterThan(0);
      expect(renderMetrics.canvas?.height).toBeGreaterThan(0);
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
  expect((await response.json()).checks).toMatchObject({ api: 'ok', database: 'ok', storage: 'ok', search: 'ok' });
  expect((await request.get(`${apiBase}/health/live`)).ok()).toBeTruthy();
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['x-frame-options']).toBe('SAMEORIGIN');
  expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(response.headers()['permissions-policy']).toContain('camera=()');
});

test('ADMIN inicia en Galilei y conserva el panel técnico separado', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.admin.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.admin.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/galilei$/);
  await expect(page.getByRole('heading', { name: '¿Qué querés consultar?' })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Secciones principales' });
  await expect(navigation.getByRole('link')).toHaveCount(3);
  const technicalLink = page.getByRole('link', { name: 'Panel técnico', exact: true });
  await expect(technicalLink).toBeVisible();
  const dashboardStarted = Date.now();
  await technicalLink.click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Panel institucional' })).toBeVisible();
  await expect(page.getByText('Documentos Digesto')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  console.log(JSON.stringify({ metric: 'dashboard-ui', visibleMs: Date.now() - dashboardStarted }));
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('roles institucionales comparten tres destinos y conservan acciones de jurisprudencia según permiso', async ({ page }) => {
  const cases = [
    { account: credentials.accounts.reviewer, review: true, manage: false },
    { account: credentials.accounts.jurisprudencia, review: true, manage: true },
    { account: credentials.accounts.digesto, review: false, manage: false },
  ];
  for (const scenario of cases) {
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill(scenario.account.email);
    await page.getByLabel('Contraseña').fill(scenario.account.password);
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(page).toHaveURL(/\/galilei$/);
    const navigation = page.getByRole('navigation', { name: 'Secciones principales' });
    await expect(navigation.getByRole('link')).toHaveCount(3);
    await expect(navigation.getByRole('link', { name: /Jurisprudencia/u })).toBeVisible();
    await expect(navigation.getByRole('link', { name: /Mi Sala \/ Juzgado/u })).toBeVisible();
    await expect(navigation.getByRole('link', { name: /Mis documentos/u })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Panel técnico', exact: true })).toHaveCount(0);
    await page.goto('/consulta');
    await expect(page.getByRole('heading', { name: 'Jurisprudencia', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Requieren revisión' })).toHaveCount(scenario.review ? 1 : 0);
    await expect(page.getByRole('link', { name: 'Gestión y borradores' })).toHaveCount(scenario.manage ? 1 : 0);
    await expect(page.getByRole('link', { name: '+ Nuevo fallo' })).toHaveCount(scenario.manage ? 1 : 0);
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
});

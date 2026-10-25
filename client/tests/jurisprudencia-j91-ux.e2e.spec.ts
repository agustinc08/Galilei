import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { getE2eArtifactPath, loadE2eCredentials } from './qa-credentials';

const credentials = loadE2eCredentials();
const artifactRoot = getE2eArtifactPath('jurisprudencia-j91');
const screenshotRoot = resolve(artifactRoot, 'screenshots');

async function signIn(page: import('@playwright/test').Page, role: 'reader' | 'operator') {
  const account = credentials.accounts[role];
  await page.goto('/consulta');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(account.email);
  await page.getByLabel('Contraseña').fill(account.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 });
}

test('J9.1 reader zero-training journey, visual states and target desktop widths', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(screenshotRoot, { recursive: true });
  await signIn(page, 'reader');
  await page.setViewportSize({ width: 1366, height: 768 });
  const initialRenderStart = Date.now();
  await page.getByRole('navigation', { name: 'Secciones principales' })
    .getByRole('link', { name: /Jurisprudencia/u })
    .click();
  await expect(page).toHaveURL(/\/consulta$/u);
  await expect(page.getByRole('heading', { name: 'Jurisprudencia', exact: true })).toBeVisible();
  await expect(page.getByLabel('Buscar jurisprudencia')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Nuevo fallo' })).toHaveCount(0);
  const initialRenderMs = Date.now() - initialRenderStart;

  const renderStart = Date.now();
  await page.getByLabel('Buscar jurisprudencia').fill('daño');
  const firstSearchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/public/busqueda') && url.searchParams.get('q') === 'daño';
  });
  await page.getByLabel('Buscar jurisprudencia').press('Enter');
  await expect(page).toHaveURL(/q=da%C3%B1o/u);
  const filterInteractionMs = Date.now() - renderStart;
  const response = await firstSearchResponse;
  expect(response.ok()).toBeTruthy();
  const responseBody = await response.json() as { data?: unknown[] };
  const hasResults = Boolean(responseBody.data?.length);
  const responseReceivedAt = Date.now();
  if (hasResults) {
    await expect(page.getByRole('link', { name: 'Ver sumario', exact: true }).first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('Buscando con:')).toBeVisible();
  } else {
    await expect(page.getByText('No encontramos fallos con estos criterios.')).toBeVisible({ timeout: 45_000 });
  }
  const resultRenderAfterApiMs = Date.now() - responseReceivedAt;

  await page.getByRole('textbox', { name: 'Sala' }).fill('Sala H');
  const filteredResponsePromise = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return url.pathname.endsWith('/api/public/busqueda') && (url.searchParams.get('sala') ?? '').length > 0;
  });
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page).toHaveURL(/sala=Sala\+H|sala=H/u);
  const filteredResponse = await filteredResponsePromise;
  expect(filteredResponse.ok()).toBeTruthy();
  const filteredBody = await filteredResponse.json() as { data?: unknown[] };
  if (filteredBody.data?.length) {
    await expect(page.getByRole('link', { name: 'Ver sumario', exact: true }).first()).toBeVisible({ timeout: 45_000 });
  } else {
    await expect(page.getByText('No encontramos fallos con estos criterios.')).toBeVisible({ timeout: 45_000 });
  }
  await page.screenshot({ path: resolve(screenshotRoot, 'reader-search-1366.png'), fullPage: true });
  await page.screenshot({ path: resolve(screenshotRoot, 'reader-results-1366.png'), fullPage: true });

  const viewportResults = [];
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 1600, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1920, height: 1200 },
    { width: 2560, height: 1440 },
  ]) {
    await page.setViewportSize(viewport);
    const measured = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    }));
    expect(measured.documentWidth, `${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(viewport.width);
    viewportResults.push({ ...viewport, ...measured, pass: true });
    if (viewport.width === 1920 && viewport.height === 1080) {
      await page.screenshot({ path: resolve(screenshotRoot, 'reader-search-1920.png'), fullPage: true });
      await page.screenshot({ path: resolve(screenshotRoot, 'reader-results-1920.png'), fullPage: true });
    }
  }

  let sumarioAvailable: boolean | null = null;
  let detailUiMs: number | null = null;
  let viewerOpened = false;
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/consulta?q=da%C3%B1o');
  if (hasResults) {
    const detailStart = Date.now();
    await page.getByRole('link', { name: 'Ver sumario', exact: true }).first().click();
    await expect(page).toHaveURL(/\/consulta\/sentencia\//u);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Sumarios', { exact: true })).toBeVisible();
    sumarioAvailable = await page.getByText('No hay sumarios publicados para este fallo.').count() === 0;
    detailUiMs = Date.now() - detailStart;
    await page.screenshot({ path: resolve(screenshotRoot, 'reader-detail.png'), fullPage: true });
    const openFallo = page.getByRole('link', { name: 'Abrir fallo', exact: true });
    if (await openFallo.count()) {
      viewerOpened = true;
      await openFallo.click();
      await expect(page).toHaveURL(/\/fallos\//u);
      await expect(page.getByRole('link', { name: /Volver a resultados/u })).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: resolve(screenshotRoot, 'reader-viewer.png'), fullPage: true });
      await page.getByRole('link', { name: /Volver a resultados/u }).click();
      await expect(page).toHaveURL(/\/consulta/u);
    } else {
      await page.getByRole('link', { name: 'Volver a resultados' }).click();
      await expect(page).toHaveURL(/\/consulta/u);
    }
  } else {
    await expect(page.getByText('No encontramos fallos con estos criterios.')).toBeVisible({ timeout: 45_000 });
    await page.screenshot({ path: resolve(screenshotRoot, 'reader-empty-corpus.png'), fullPage: true });
  }
  await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).first().click();
  await expect(page).toHaveURL(/\/consulta$/u);
  await page.getByRole('button', { name: 'Más filtros' }).click();
  await expect(page.getByLabel('N° sumario')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'N° sentencia' })).toBeVisible();

  await page.goto('/consulta?q=zzj91-ux-no-results');
  await expect(page.getByText('No encontramos fallos con estos criterios.')).toBeVisible({ timeout: 45_000 });
  await page.screenshot({ path: resolve(screenshotRoot, 'reader-empty.png'), fullPage: true });

  await page.route('**/api/public/busqueda**', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'service unavailable' }),
  }));
  await page.goto('/consulta?q=zzj91-ux-forced-error');
  await expect(page.getByText('No se pudo completar la consulta')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: resolve(screenshotRoot, 'reader-error.png'), fullPage: true });
  await page.unrouteAll({ behavior: 'wait' });

  writeFileSync(resolve(artifactRoot, 'responsive-matrix.json'), `${JSON.stringify({ route: '/consulta?sala=H', viewports: viewportResults, horizontalOverflowCount: viewportResults.filter((item) => item.horizontalOverflow).length }, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(artifactRoot, 'reader-e2e.json'), `${JSON.stringify({ enterJurisprudencia: 'PASS', search: 'PASS', filterSalaH: 'PASS', openResult: hasResults ? 'PASS' : 'NOT_APPLICABLE_NO_PUBLISHED_RESULTS_IN_ISOLATED_QA', detail: hasResults ? 'PASS' : 'NOT_APPLICABLE_NO_PUBLISHED_RESULTS_IN_ISOLATED_QA', publishedSumarioAvailableForSelectedResult: sumarioAvailable, viewer: viewerOpened ? 'PASS' : hasResults ? 'NO_PDF_ACTION' : 'NOT_APPLICABLE_NO_PUBLISHED_RESULTS_IN_ISOLATED_QA', backToResults: hasResults ? 'PASS' : 'NOT_APPLICABLE_NO_PUBLISHED_RESULTS_IN_ISOLATED_QA', clearFilters: 'PASS', advancedFilters: 'PASS', operatorControlsVisibleToReader: 0, isolatedQaPublishedResults: responseBody.data?.length ?? 0, note: 'The isolated QA corpus is empty; J9.0.1 separately creates, publishes, searches, views and archives a synthetic case through the real API.' }, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(artifactRoot, 'frontend-performance.json'), `${JSON.stringify({ initialRenderMs, filterInteractionMs, resultRenderAfterApiMs, detailNavigationMs: detailUiMs, operatorFormInteractionMs: null, searchResponseStatus: response.status(), note: 'Result rendering is measured from API response receipt to first visible result card. Search backend latency is not included as frontend render time.' }, null, 2)}\n`, 'utf8');
});

test('J9.1 operator entry and responsive management list', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(screenshotRoot, { recursive: true });
  await signIn(page, 'operator');
  await page.setViewportSize({ width: 1366, height: 768 });
  const formStart = Date.now();
  await page.goto('/sentencias/nueva');
  await expect(page.getByRole('heading', { name: 'Nuevo fallo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Subir PDF y continuar' })).toBeVisible();
  const operatorFormInteractionMs = Date.now() - formStart;
  await page.screenshot({ path: resolve(screenshotRoot, 'operator-new.png'), fullPage: true });

  await page.goto('/sentencias?publicado=false&activo=true');
  await expect(page.getByRole('navigation', { name: 'Estado de los fallos' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gestión de fallos' })).toBeVisible();
  const draftEditLinks = page.getByRole('link', { name: 'Editar fallo', exact: true });
  const hasDraftRows = await draftEditLinks.count() > 0;
  if (hasDraftRows) {
    await expect(draftEditLinks.first()).toBeVisible({ timeout: 45_000 });
  } else {
    await expect(page.getByText('No encontramos fallos con esos criterios')).toBeVisible({ timeout: 45_000 });
  }
  const dimensions = [];
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    await page.setViewportSize(viewport);
    const measured = await page.evaluate(() => ({ viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth }));
    expect(measured.documentWidth, `operator ${viewport.width}`).toBeLessThanOrEqual(viewport.width);
    dimensions.push({ ...viewport, ...measured, horizontalOverflow: false });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: resolve(screenshotRoot, 'operator-draft.png'), fullPage: true });
  await page.goto('/sentencias?publicado=true&activo=true&pageSize=10');
  await expect(page.getByRole('heading', { name: 'Gestión de fallos' })).toBeVisible();
  const publishedEditLinks = page.getByRole('link', { name: 'Editar fallo', exact: true });
  const hasPublishedRows = await publishedEditLinks.count() > 0;
  if (hasPublishedRows) {
    await expect(publishedEditLinks.first()).toBeVisible({ timeout: 45_000 });
  } else {
    await expect(page.getByText('No encontramos fallos con esos criterios')).toBeVisible({ timeout: 45_000 });
  }
  await page.screenshot({ path: resolve(screenshotRoot, 'operator-manage.png'), fullPage: true });
  if (hasPublishedRows) {
    await publishedEditLinks.first().click();
    await expect(page.getByLabel('Carátula')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: resolve(screenshotRoot, 'operator-published.png'), fullPage: true });
  }
  writeFileSync(resolve(artifactRoot, 'operator-responsive-matrix.json'), `${JSON.stringify({ viewports: dimensions, horizontalOverflowCount: 0, operatorFormInteractionMs }, null, 2)}\n`, 'utf8');
});

'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');
const viewports = require('../ux-qa/viewports.cjs');
const { captureScenario, accessibleButtonNames } = require('../ux-qa/helpers.cjs');

async function captureAndCheck(page, testInfo, scenario) {
  const record = await captureScenario(page, testInfo, scenario);
  expect(record.horizontalOverflow.passes, `${scenario.id} horizontal overflow at ${record.viewport.width}x${record.viewport.height}`).toBe(true);
  expect(record.bodyScroll.unexpectedInternalScrollContainers, `${scenario.id} unexpected nested scroll`).toEqual([]);
  expect(record.pageErrors, `${scenario.id} page errors`).toEqual([]);
  expect(record.consoleErrors, `${scenario.id} console errors`).toEqual([]);
  expect(record.reactWarnings, `${scenario.id} React warnings`).toEqual([]);
  expect(record.networkErrors, `${scenario.id} network failures`).toEqual([]);
  expect(record.fixtureMisses, `${scenario.id} fixture misses`).toEqual([]);
  expect(record.reducedMotion, `${scenario.id} reduced-motion preference`).toBe(true);
  return record;
}

test.describe('public entry routes @public @responsive', () => {
  for (const viewport of viewports) {
    test(`home and login ${viewport.name}`, async ({ page }, testInfo) => {
      const started = Date.now();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const homeResponse = await page.goto('/');
      expect(homeResponse?.status()).toBe(200);
      await expect(page).toHaveTitle(/Jurisprudencia Civil/u);
      await expect(page.getByRole('heading', { name: 'Jurisprudencia Civil', exact: true })).toBeVisible();
      await expect(page.locator('header').getByText('Cámara Nacional de Apelaciones en lo Civil', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Buscar jurisprudencia', exact: true })).toHaveAttribute('href', '/consulta');
      await expect(page.getByRole('link', { name: 'Acceso interno', exact: true })).toHaveAttribute('href', '/login');
      await expect(page.getByRole('link', { name: 'Mi Sala / Juzgado' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Mis documentos' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Revisión de OCR' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Registros' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
      await expect(page.getByRole('main')).toBeVisible();
      await captureAndCheck(page, testInfo, { id: 'home', route: '/' });

      const loginResponse = await page.goto('/login');
      expect(loginResponse?.status()).toBe(200);
      await expect(page.getByRole('heading', { name: 'Ingresar', exact: true })).toBeVisible();
      await expect(page.getByLabel('Correo electrónico')).toBeVisible();
      await expect(page.getByLabel('Contraseña')).toBeVisible();
      let focused = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await page.keyboard.press('Tab');
        focused = await page.evaluate(() => document.activeElement instanceof HTMLElement
          ? { tag: document.activeElement.tagName, id: document.activeElement.id, name: document.activeElement.getAttribute('name'), focusVisible: document.activeElement.matches(':focus-visible'), outlineStyle: getComputedStyle(document.activeElement).outlineStyle, outlineWidth: getComputedStyle(document.activeElement).outlineWidth }
          : null);
        if (focused && focused.tag !== 'NEXTJS-PORTAL' && focused.focusVisible) break;
      }
      expect(focused).not.toBeNull();
      expect(focused.focusVisible).toBe(true);
      await page.keyboard.press('Shift+Tab');
      const reverseFocused = await page.evaluate(() => document.activeElement instanceof HTMLElement
        ? { tag: document.activeElement.tagName, id: document.activeElement.id, name: document.activeElement.getAttribute('name') }
        : null);
      expect(reverseFocused).not.toEqual({ tag: focused.tag, id: focused.id, name: focused.name });
      await page.keyboard.press('Tab');
      const forwardFocused = await page.evaluate(() => document.activeElement instanceof HTMLElement
        ? { tag: document.activeElement.tagName, id: document.activeElement.id, name: document.activeElement.getAttribute('name') }
        : null);
      expect(forwardFocused).toEqual({ tag: focused.tag, id: focused.id, name: focused.name });
      await captureAndCheck(page, testInfo, { id: 'login', route: '/login', durationMs: Date.now() - started, notes: [`Tab / Shift+Tab focus: ${JSON.stringify(focused)}`] });
    });
  }

  test('anonymous direct links to Galilei-only routes return to login @auth', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    const protectedRoutes = [
      '/galilei',
      '/busqueda-avanzada',
      '/jurisprudencia/ingreso',
      '/sentencias',
      '/sumarios',
      '/revision',
      '/citas-pendientes',
      '/admin/jurisprudencia/ocr',
      '/admin/usuarios',
      '/admin/logs',
      '/spaces',
      '/spaces/manage',
      '/personal',
      '/colecciones',
      '/corpus',
    ];

    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login$/u);
      await expect(page.getByRole('heading', { name: 'Ingresar', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toHaveCount(0);
    }
  });
});

test.describe('public Search and Viewer journey @public @responsive @search @viewer @accessibility', () => {
  for (const viewport of viewports) {
    test(`search, help, pagination and Viewer ${viewport.name}`, async ({ page }, testInfo) => {
      const started = Date.now();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const response = await page.goto('/consulta');
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(/Jurisprudencia Civil/u);
      expect(await page.title()).not.toContain('Galilei');
      const searchInput = page.getByLabel('Buscar jurisprudencia');
      await expect(searchInput).toBeVisible();
      await expect(page.getByText('4 resultados', { exact: true })).toBeVisible();
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Galilei' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Mi Sala / Juzgado' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Mis documentos' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Guardar búsqueda' })).toHaveCount(0);
      expect(await accessibleButtonNames(page)).toEqual([]);
      if (viewport.width <= 430) {
        const firstResult = page.locator('article[class*="resultCard"]').first();
        await expect(firstResult).toBeVisible();
        const firstResultTop = await firstResult.evaluate((element) => element.getBoundingClientRect().top);
        expect(firstResultTop, 'mobile search should show the first result earlier in the first viewport').toBeLessThan(600);
      }
      await captureAndCheck(page, testInfo, { id: 'search', route: '/consulta' });

      await searchInput.fill('responsabilidad civil');
      await searchInput.press('Escape');
      await searchInput.press('Enter');
      await expect(page).toHaveURL(/q=responsabilidad(?:\+|%20)civil/u);
      await expect(page.getByText('4 resultados', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Más filtros', exact: true }).click();
      await expect(page.getByLabel('Frase exacta')).toBeVisible();
      await page.getByLabel('Frase exacta').fill('daños');
      await page.locator('select:has(option[value="Sala A"])').selectOption('Sala A');
      await page.getByRole('button', { name: 'Buscar', exact: true }).click();
      await expect(page).toHaveURL(/sala=A(?:&|$)/u);
      await captureAndCheck(page, testInfo, { id: 'search-filters', route: '/consulta' });

      const multipleSummaries = page.getByRole('link', { name: 'Ver 4 sumarios', exact: true }).first();
      await expect(multipleSummaries).toBeVisible();
      await expect(page.getByText('PDF disponible', { exact: true }).first()).toBeVisible();
      await multipleSummaries.click();
      await expect(page).toHaveURL(/\/consulta\/sentencia\/ux-qa-001/u);
      await expect(page.getByRole('heading', { name: 'Sumarios del fallo', exact: true })).toBeVisible();
      await expect(page.locator('article[class*="summaryCard"]')).toHaveCount(4);
      const firstSummary = page.locator('article[class*="summaryCard"]').first();
      await expect(firstSummary).toContainText('El médico explicó el tratamiento aplicado.');
      await expect(firstSummary).toContainText('Segundo párrafo de prueba.');
      await expect(firstSummary).not.toContainText('<p');
      await expect(firstSummary.locator('img, script')).toHaveCount(0);
      expect(await page.evaluate(() => window.__qaSummaryXss)).toBeUndefined();
      const relatedFallo = page.getByRole('complementary', { name: 'Fallo relacionado' });
      await expect(relatedFallo.getByText('FALLO RELACIONADO', { exact: true })).toBeVisible();
      await expect(relatedFallo.getByRole('link', { name: 'Abrir fallo completo', exact: true })).toBeVisible();
      const openPdf = relatedFallo.getByRole('link', { name: 'Abrir PDF', exact: true });
      await expect(openPdf).toHaveAttribute('href', /\/api\/public\/sentencias\/ux-qa-001\/pdf$/u);
      await expect(openPdf).toHaveAttribute('target', '_blank');
      const returnUrl = new URL(page.url()).searchParams.get('returnTo') ?? '';
      expect(returnUrl).toContain('/consulta?q=responsabilidad');
      expect(returnUrl).toContain('sala=A');
      await captureAndCheck(page, testInfo, { id: 'sumario-detail-multiple', route: '/consulta/sentencia/ux-qa-001' });
      await page.getByRole('link', { name: 'Volver a resultados', exact: true }).click();
      await expect(page).toHaveURL(/\/consulta\?/u);
      await expect(page.getByLabel('Buscar jurisprudencia')).toHaveValue('responsabilidad civil');
      await expect(page).toHaveURL(/sala=A(?:&|$)/u);

      const noPdfCard = page.locator('article').nth(1);
      await expect(noPdfCard.getByText('Sin PDF', { exact: true })).toBeVisible();
      await expect(noPdfCard.getByRole('link', { name: 'Abrir PDF', exact: true })).toHaveCount(0);
      await noPdfCard.getByRole('button', { name: 'Por qué no hay PDF', exact: true }).click();
      await expect(page.getByText('El fallo seleccionado no tiene PDF público disponible.', { exact: true })).toBeVisible();
      await noPdfCard.getByRole('link', { name: 'Ver sumario', exact: true }).click();
      await expect(page).toHaveURL(/\/consulta\/sentencia\/ux-qa-002/u);
      const relatedFalloWithoutPdf = page.getByRole('complementary', { name: 'Fallo relacionado' });
      await expect(relatedFalloWithoutPdf.getByText('No disponible', { exact: true })).toBeVisible();
      await expect(relatedFalloWithoutPdf.getByText('Este fallo no tiene un PDF asociado.', { exact: true })).toBeVisible();
      await expect(relatedFalloWithoutPdf.getByRole('link', { name: 'Abrir PDF', exact: true })).toHaveCount(0);
      await expect(relatedFalloWithoutPdf.getByRole('link', { name: 'Abrir fallo completo', exact: true })).toHaveCount(0);
      await captureAndCheck(page, testInfo, { id: 'sumario-detail-without-pdf', route: '/consulta/sentencia/ux-qa-002' });
      await page.getByRole('link', { name: 'Volver a resultados', exact: true }).click();
      await expect(page).toHaveURL(/\/consulta\?/u);
      await expect(page.getByLabel('Buscar jurisprudencia')).toHaveValue('responsabilidad civil');
      await expect(page).toHaveURL(/sala=A(?:&|$)/u);

      if (viewport.width <= 600) await page.locator('[class*="mobileSearchActions"] summary').click();
      const helpButton = page.getByRole('button', { name: 'Consejos de búsqueda', exact: true });
      await expect(helpButton).toHaveAttribute('aria-expanded', 'false');
      await helpButton.click();
      const helpPanel = page.locator('#search-help-panel');
      await expect(helpButton).toHaveAttribute('aria-expanded', 'true');
      await expect(helpPanel).toBeVisible();
      await expect(helpPanel).not.toHaveAttribute('role', 'dialog');
      await captureAndCheck(page, testInfo, { id: 'search-help', route: '/consulta' });
      await helpPanel.getByRole('button', { name: 'Cerrar', exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(helpButton).toHaveAttribute('aria-expanded', 'false');
      await expect(helpPanel).toBeHidden();
      await expect(helpButton).toBeFocused();

      await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).first().click();
      await expect(page).toHaveURL(/\/consulta$/u);
      await expect(page.getByLabel('Buscar jurisprudencia')).toHaveValue('');
      await expect(page.getByRole('button', { name: 'Siguiente', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
      await expect(page.getByText(/página 2 de 2/u)).toBeVisible();
      await page.getByRole('button', { name: 'Anterior', exact: true }).click();
      await expect(page.getByText(/página 1 de 2/u)).toBeVisible();

      await page.locator('article[class*="resultCard"] details summary').first().click();
      const selectResult = page.getByRole('button', { name: 'Seleccionar para imprimir', exact: true }).first();
      await selectResult.focus();
      await page.keyboard.press('Space');
      const selectedResult = page.getByRole('button', { name: 'Quitar de impresión', exact: true }).first();
      await expect(selectedResult).toBeVisible();
      await selectedResult.focus();
      await page.keyboard.press('Space');

      const pdfResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith('/api/public/sentencias/ux-qa-001/pdf'),
      );
      await page.getByRole('link', { name: 'Ver fallo', exact: true }).first().click();
      await expect(page).toHaveURL(/\/fallos\/ux-qa-001(?:\?|$)/u);
      await expect(page).toHaveTitle(/Jurisprudencia Civil/u);
      const pdfResponse = await pdfResponsePromise;
      expect(pdfResponse.status()).toBe(200);
      expect(pdfResponse.headers()['content-type']).toContain('application/pdf');
      expect(await pdfResponse.request().headerValue('authorization')).toBeNull();
      await expect(page.getByRole('heading', { name: 'Pérez c/ Gutiérrez s/ daños', exact: true })).toBeVisible();
      await expect(page.getByText('No hay citas verificadas entre fallos publicados para mostrar.', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ocultar panel', exact: true })).toBeVisible();
      await expect(page.getByLabel('Página')).toBeVisible();
      await expect(page.getByLabel('Zoom')).toBeVisible();
      await expect(page.getByText('Documento de muestra.pdf')).toBeVisible();
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.getByRole('button', { name: 'Buscar dentro del fallo' }).click();
      const pdfSearch = page.getByLabel('Buscar en este fallo');
      await pdfSearch.fill('responsabilidad civil');
      await page.getByRole('button', { name: 'Buscar', exact: true }).last().click();
      await expect(page.getByRole('status').filter({ hasText: /1 de 1 · Página 1/u })).toBeVisible();
      await page.getByRole('button', { name: 'Copiar fragmento + cita' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Fragmento y cita copiados' })).toBeVisible();
      const passageCitation = await page.evaluate(() => navigator.clipboard.readText());
      expect(passageCitation).toBe('“responsabilidad civil” — Cámara Civil, Sala I, p. 1');
      await captureAndCheck(page, testInfo, {
        id: 'viewer', route: '/fallos/ux-qa-001', durationMs: Date.now() - started,
        pdfRenderStatus: 'DEFERRED_BROWSER_LIMITATION',
        notes: ['Viewer shell and local passage citation are mandatory; PDF.js/native embedded rendering is reported separately.'],
      });
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Pérez c/ Gutiérrez s/ daños', exact: true })).toBeVisible();

      if (viewport.width <= 430) {
        const controls = {
          page: await page.getByLabel('Página').evaluate((input) => {
            const box = input.parentElement?.getBoundingClientRect();
            return box ? { x: box.x, y: box.y, right: box.right, bottom: box.bottom } : null;
          }),
          zoom: await page.getByLabel('Zoom').evaluate((select) => {
            const box = select.parentElement?.getBoundingClientRect();
            return box ? { x: box.x, y: box.y, right: box.right, bottom: box.bottom } : null;
          }),
        };
        expect(controls.page).not.toBeNull();
        expect(controls.zoom).not.toBeNull();
        expect(Math.abs(controls.page.y - controls.zoom.y)).toBeLessThanOrEqual(2);
        expect(controls.page.right).toBeLessThanOrEqual(controls.zoom.x + 2);
        expect(controls.zoom.right).toBeLessThanOrEqual(viewport.width + 2);
      }

      await page.getByLabel('Zoom').selectOption('125');
      await expect(page.getByLabel('Zoom')).toHaveValue('125');
      await page.getByRole('button', { name: 'Ocultar panel', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Mostrar panel', exact: true })).toBeVisible();
      await captureAndCheck(page, testInfo, { id: 'viewer-panel-closed', route: '/fallos/ux-qa-001' });
      await page.getByRole('button', { name: 'Mostrar panel', exact: true }).click();
      await page.getByRole('link', { name: 'Volver a resultados', exact: true }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe('/consulta');
      await expect(page.getByLabel('Buscar jurisprudencia')).toBeVisible();

      const diagnostics = page.__uxQaDiagnostics;
      expect(diagnostics.pageErrors).toEqual([]);
      expect(diagnostics.networkErrors).toEqual([]);
      expect(diagnostics.fixtureMisses).toEqual([]);
      expect(diagnostics.console.filter((item) => item.type === 'error' && item.classification === 'APPLICATION_ERROR')).toEqual([]);
      expect(diagnostics.console.filter((item) => item.classification === 'REACT_WARNING')).toEqual([]);
    });
  }
});

test.describe('verified citations in the public judgment viewer @public @state', () => {
  test('shows loading and then verified citations without blocking the judgment', async ({ page }) => {
    let releaseResponse;
    const waitForRelease = new Promise((resolve) => {
      releaseResponse = resolve;
    });
    await page.route('**/api/public/sentencias/ux-qa-001/relaciones-verificadas', async (route) => {
      await waitForRelease;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{
            type: 'CITES',
            status: 'VERIFIED',
            rawCitation: 'Cámara Civil, Sala I, 3/2020',
            page: 4,
            judgment: {
              id: 42,
              slugPublico: null,
              caratula: 'Fallo sintético citado',
              numeroSentencia: '3/2020',
              expediente: 'CIV 3/2020',
              sala: 'I',
              fecha: null,
            },
          }],
        }),
      });
    });

    await page.goto('/fallos/ux-qa-001');
    await expect(page.getByRole('heading', { name: 'Pérez c/ Gutiérrez s/ daños', exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Cargando citas verificadas...' })).toBeVisible();
    releaseResponse();
    await expect(page.getByText('Este fallo cita a: Fallo sintético citado', { exact: true })).toBeVisible();
    await expect(page.getByText('No hay citas verificadas entre fallos publicados para mostrar.', { exact: true })).toHaveCount(0);
    expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  });

  test('shows a controlled error when the citation endpoint fails', async ({ page }) => {
    await page.route('**/api/public/sentencias/ux-qa-001/relaciones-verificadas', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'internal OpenSearch details' }),
      });
    });

    await page.goto('/fallos/ux-qa-001');
    await expect(page.getByRole('heading', { name: 'Pérez c/ Gutiérrez s/ daños', exact: true })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'No se pudieron cargar las citas verificadas.' })).toBeVisible();
    await expect(page.getByText('No hay citas verificadas entre fallos publicados para mostrar.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('internal OpenSearch details', { exact: true })).toHaveCount(0);
    expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  });
});

test.describe('Search user-facing states @public @state', () => {
  test('a delayed autocomplete response stays closed after its input blurs', async ({ page }) => {
    let releaseSuggestions;
    let requestIntercepted = false;
    const waitForRelease = new Promise((resolve) => {
      releaseSuggestions = resolve;
    });
    const suggestionResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/public/busqueda/sugerencias');
    });

    await page.route('**/api/public/busqueda/sugerencias**', async (route) => {
      requestIntercepted = true;
      await waitForRelease;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          data: [{ value: 'responsabilidad civil', tipo: 'tema', total: 4 }],
        }),
      });
    });

    try {
      await page.setViewportSize({ width: 430, height: 932 });
      await page.goto('/consulta');
      await page.getByLabel('Buscar jurisprudencia').fill('responsabilidad civil');
      await page.getByRole('button', { name: 'Más filtros', exact: true }).click();
      await expect(page.getByLabel('Frase exacta')).toBeVisible();
      await expect.poll(() => requestIntercepted).toBe(true);
      releaseSuggestions();
      const response = await suggestionResponse;
      expect(response.status()).toBe(200);
      await expect(
        page.getByRole('button', {
          name: 'responsabilidad civil tema · 4',
          exact: true,
        }),
      ).toHaveCount(0);
      await page.getByRole('button', { name: 'Buscar', exact: true }).click();
      await expect(page).toHaveURL(/q=responsabilidad(?:\+|%20)civil/u);
    } finally {
      releaseSuggestions();
    }
  });

  test('anonymous autocomplete selection stays public and never calls protected telemetry', async ({ page }) => {
    const eventRequests = [];
    const suggestionQueries = [];
    const suggestionsByQuery = [
      { match: 'acc', value: 'ACCIDENTE DE TRANSITO. DAÑOS. Incapacidad sobreviniente.' },
      { match: 'daños', value: 'Daños y perjuicios' },
      { match: 'niñez', value: 'Derechos de niños y niñas' },
      { match: 'lesión', value: 'Lesión corporal' },
    ];

    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
      window.__authStorageWasClean = localStorage.length === 0 && sessionStorage.length === 0;
      window.__authUnauthorizedCount = 0;
      window.addEventListener('auth:unauthorized', () => {
        window.__authUnauthorizedCount += 1;
      });
    });
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/estadisticas/eventos') || pathname.endsWith('/public/eventos')) {
        eventRequests.push(`${request.method()} ${pathname}`);
      }
    });
    await page.route('**/api/estadisticas/eventos', (route) => route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Unauthorized' }),
    }));
    await page.route('**/api/public/eventos', (route) => route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ data: { tracked: true } }),
    }));
    await page.route('**/api/public/busqueda/sugerencias**', async (route) => {
      const query = new URL(route.request().url()).searchParams.get('q')?.toLocaleLowerCase('es-AR') ?? '';
      suggestionQueries.push(query);
      const suggestion = suggestionsByQuery.find((item) => query.includes(item.match));
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          data: suggestion ? [{ value: suggestion.value, tipo: 'tema', total: 3 }] : [],
        }),
      });
    });

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/consulta');
      const input = page.getByLabel('Buscar jurisprudencia');
      await input.fill(viewport.width === 768 ? 'ACC' : 'acc');
      const suggestion = page.getByRole('button').filter({ hasText: /ACCIDENTE DE TRANSITO\. DAÑOS\./u }).first();
      await expect(suggestion).toBeVisible();
      await suggestion.click();

      await expect(page).toHaveURL((url) => url.pathname === '/consulta' && url.searchParams.get('q') === suggestionsByQuery[0].value);
      await expect(page.getByText('4 resultados', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Jurisprudencia', exact: true })).toBeVisible();
      await expect(page.getByText('Sesión expirada. Iniciá sesión nuevamente.', { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => ({
        token: localStorage.getItem('jurisprudencia_token'),
        user: localStorage.getItem('jurisprudencia_user'),
        startedClean: window.__authStorageWasClean,
        unauthorizedEvents: window.__authUnauthorizedCount,
      }))).toEqual({ token: null, user: null, startedClean: true, unauthorizedEvents: 0 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }

    expect(eventRequests.filter((request) => request.endsWith('/estadisticas/eventos'))).toEqual([]);
    expect(eventRequests.filter((request) => request.endsWith('/public/eventos'))).toHaveLength(3);
    expect(suggestionQueries.filter((query) => query === 'acc')).toHaveLength(3);
    expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
    expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
  });

  test('public autocomplete keyboard selection, Unicode, race, refresh and history stay in the public shell', async ({ page }) => {
    const suggestionQueries = [];
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.route('**/api/estadisticas/eventos', (route) => route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Unauthorized' }),
    }));
    await page.route('**/api/public/busqueda/sugerencias**', async (route) => {
      const query = new URL(route.request().url()).searchParams.get('q')?.toLocaleLowerCase('es-AR') ?? '';
      suggestionQueries.push(query);
      const match = [
        { term: 'acc', value: 'ACCIDENTE DE TRANSITO. DAÑOS. Incapacidad sobreviniente' },
        { term: 'daños', value: 'Daños y perjuicios' },
        { term: 'niñez', value: 'Derechos de niños y niñas' },
        { term: 'lesión', value: 'Lesión corporal' },
      ].find((item) => query.includes(item.term));
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ data: match ? [{ value: match.value, tipo: 'tema', total: 2 }] : [] }),
      });
    });

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/consulta');
    const input = page.getByLabel('Buscar jurisprudencia');
    await input.fill('daños');
    const danos = page.getByRole('button').filter({ hasText: 'Daños y perjuicios' }).first();
    await expect(danos).toBeVisible();
    await input.press('ArrowDown');
    await input.press('ArrowUp');
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(page).toHaveURL((url) => url.pathname === '/consulta' && url.searchParams.get('q') === 'Daños y perjuicios');
    await expect(page.getByText('4 resultados', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL((url) => url.pathname === '/consulta' && url.searchParams.get('q') === 'Daños y perjuicios');
    await expect(input).toHaveValue('Daños y perjuicios');
    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === '/consulta' && !url.searchParams.has('q'));
    await page.goForward();
    await expect(page).toHaveURL((url) => url.pathname === '/consulta' && url.searchParams.get('q') === 'Daños y perjuicios');

    await input.fill('niñez');
    const ninez = page.getByRole('button').filter({ hasText: 'Derechos de niños y niñas' }).first();
    await expect(ninez).toBeVisible();
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(page).toHaveURL((url) => url.pathname === '/consulta' && url.searchParams.get('q') === 'Derechos de niños y niñas');

    await input.fill('lesión');
    await expect(page.getByRole('button').filter({ hasText: 'Lesión corporal' }).first()).toBeVisible();
    await input.press('Escape');
    await expect(page.getByRole('button').filter({ hasText: 'Lesión corporal' })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/consulta');

    await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).first().click();
    await expect(page).toHaveURL((url) => url.pathname === '/consulta' && !url.searchParams.has('q'));
    await expect(input).toHaveValue('');
    await input.fill('lesión');
    await page.getByRole('button').filter({ hasText: 'Lesión corporal' }).first().click();
    await expect(page).toHaveURL((url) => url.pathname === '/consulta' && url.searchParams.get('q') === 'Lesión corporal');

    await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).first().click();
    await expect(page).toHaveURL((url) => url.pathname === '/consulta' && !url.searchParams.has('q'));
    suggestionQueries.length = 0;
    await input.fill('a');
    await input.fill('ac');
    await input.fill('acc');
    await expect.poll(() => suggestionQueries).toEqual(['acc']);
    const raceSuggestion = page.getByRole('button').filter({ hasText: /ACCIDENTE DE TRANSITO/iu }).first();
    await expect(raceSuggestion).toBeVisible();
    await raceSuggestion.click();
    await expect(page).toHaveURL((url) => url.pathname === '/consulta' && url.searchParams.get('q') === 'ACCIDENTE DE TRANSITO. DAÑOS. Incapacidad sobreviniente');

    await input.fill('sin coincidencias');
    await expect.poll(() => suggestionQueries.at(-1)).toBe('sin coincidencias');
    await expect(page.getByRole('button').filter({ hasText: /sin coincidencias/iu })).toHaveCount(0);
    await expect(page).toHaveURL((url) => url.pathname === '/consulta');
    await expect(page.getByText('Sesión expirada. Iniciá sesión nuevamente.', { exact: true })).toHaveCount(0);
    expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
    expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
  });

  test('loading and zero-results states remain clear and recoverable', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/consulta?q=UX_QA_LOADING');
    await expect(page.getByText('Buscando fallos…')).toBeVisible();
    await expect(page.getByText('4 resultados', { exact: true })).toBeVisible();

    const emptyResponse = await page.goto('/consulta?q=UX_QA_NO_RESULTS');
    expect(emptyResponse?.status()).toBe(200);
    await expect(page.getByText('No encontramos fallos con estos criterios.')).toBeVisible();
    await expect(page.getByText('Modificá la búsqueda o quitá los filtros para probar de nuevo.')).toBeVisible();
    await expect(page.getByRole('status').getByRole('button', { name: 'Limpiar filtros', exact: true })).toBeVisible();
    await captureAndCheck(page, testInfo, { id: 'search-no-results', route: '/consulta?q=UX_QA_NO_RESULTS' });
  });

  test('fail-closed 503 uses controlled copy and hides backend diagnostics', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const response = await page.goto('/consulta?q=UX_QA_SERVICE_UNAVAILABLE');
    expect(response?.status()).toBe(200);
    const serviceError = page.locator('[role="alert"]').filter({ hasText: 'No se pudo completar la consulta' });
    await expect(serviceError).toContainText('No se pudo completar la consulta');
    await expect(serviceError).toContainText('No pudimos completar la búsqueda. Intentá nuevamente.');
    await expect(page.getByText(/OpenSearchException|internal fixture diagnostic/u)).toHaveCount(0);
    await captureAndCheck(page, testInfo, { id: 'search-service-unavailable', route: '/consulta?q=UX_QA_SERVICE_UNAVAILABLE' });
  });

  test('manually requested extreme page shows a controlled error and clears loading', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const response = await page.goto('/consulta?page=999999');
    expect(response?.status()).toBe(200);
    const error = page.locator('[role="alert"]').filter({ hasText: 'No se pudo completar la consulta' });
    await expect(error).toContainText('No pudimos completar la búsqueda. Intentá nuevamente.');
    await expect(page.getByText('Buscando fallos…')).toHaveCount(0);
    await expect(page.getByText(/SEARCH_PAGE_WINDOW_EXCEEDED|OpenSearchException|internal fixture diagnostic/u)).toHaveCount(0);
    await captureAndCheck(page, testInfo, { id: 'search-extreme-page', route: '/consulta?page=999999' });
  });

  test('a rejected long query clears prior results and a new query recovers', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const searchResponses = [];
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname.endsWith('/api/public/busqueda')) {
        searchResponses.push({ query: url.searchParams.get('q') || '', status: response.status() });
      }
    });

    await page.goto('/consulta?q=UX_QA_QUERY_A');
    const input = page.getByLabel('Buscar jurisprudencia');
    await expect(input).toHaveAttribute('maxlength', '512');
    await expect(page.getByRole('heading', { name: 'Consulta A — resultado 1', exact: true })).toBeVisible();
    await expect(page.getByText('4 resultados', { exact: true })).toBeVisible();

    const tooLongQuery = 'x'.repeat(513);
    await page.evaluate((query) => {
      const url = new URL(window.location.href);
      url.searchParams.set('q', query);
      url.searchParams.delete('page');
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, tooLongQuery);

    const longQueryError = page.locator('[role="alert"]').filter({ hasText: 'No se pudo completar la consulta' });
    await expect(longQueryError).toContainText('La búsqueda es demasiado larga. Reducí el texto e intentá nuevamente.');
    await expect(page.getByRole('heading', { name: 'Consulta A — resultado 1', exact: true })).toHaveCount(0);
    await expect(page.getByText('4 resultados', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Buscando fallos…')).toHaveCount(0);

    await input.fill('UX_QA_QUERY_C');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Consulta C — resultado 1', exact: true })).toBeVisible();
    await expect(page.getByText('4 resultados', { exact: true })).toBeVisible();
    await expect(longQueryError).toHaveCount(0);

    expect(searchResponses).toEqual(expect.arrayContaining([
      { query: 'UX_QA_QUERY_A', status: 200 },
      { query: tooLongQuery, status: 400 },
      { query: 'UX_QA_QUERY_C', status: 200 },
    ]));
    expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
    expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
    expect(page.__uxQaDiagnostics.fixtureMisses).toEqual([]);
  });
});

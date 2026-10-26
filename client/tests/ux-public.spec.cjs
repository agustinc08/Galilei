'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');
const viewports = require('../ux-qa/viewports.cjs');
const { captureScenario, exerciseDialog, accessibleButtonNames } = require('../ux-qa/helpers.cjs');

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
      await expect(page.getByRole('heading', { name: '¿Qué querés consultar?' })).toBeVisible();
      await expect(page.getByRole('link', { name: /Jurisprudencia.*Buscar fallos publicados/u })).toHaveAttribute('href', '/consulta');
      await expect(page.getByRole('link', { name: /Mi Sala \/ Juzgado.*Documentos compartidos/u })).toHaveAttribute('href', '/spaces');
      await expect(page.getByRole('link', { name: /Mis documentos.*Tus archivos privados/u })).toHaveAttribute('href', '/personal');
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
});

test.describe('public Search and Viewer journey @public @responsive @search @viewer @accessibility', () => {
  for (const viewport of viewports) {
    test(`search, help, pagination and Viewer ${viewport.name}`, async ({ page }, testInfo) => {
      const started = Date.now();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const response = await page.goto('/consulta');
      expect(response?.status()).toBe(200);
      const searchInput = page.getByLabel('Buscar jurisprudencia');
      await expect(searchInput).toBeVisible();
      await expect(page.getByText('4 resultados', { exact: true })).toBeVisible();
      await expect(page.getByRole('main')).toBeVisible();
      expect(await accessibleButtonNames(page)).toEqual([]);
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
      await expect(page).toHaveURL(/sala=Sala(?:\+|%20)A/u);
      await captureAndCheck(page, testInfo, { id: 'search-filters', route: '/consulta' });

      const helpButton = page.getByRole('button', { name: 'Consejos de búsqueda', exact: true });
      const dialogResult = await exerciseDialog(page, helpButton, 'Ayuda de búsqueda', async () => {
        await captureAndCheck(page, testInfo, { id: 'search-help', route: '/consulta' });
      });
      expect(dialogResult).toEqual({ exists: true, role: 'dialog', ariaModal: 'true', focusEnters: true, escapeCloses: true, focusReturns: true });

      await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).first().click();
      await expect(page).toHaveURL(/\/consulta$/u);
      await expect(page.getByLabel('Buscar jurisprudencia')).toHaveValue('');
      await expect(page.getByRole('button', { name: 'Siguiente', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
      await expect(page.getByText(/página 2 de 2/u)).toBeVisible();
      await page.getByRole('button', { name: 'Anterior', exact: true }).click();
      await expect(page.getByText(/página 1 de 2/u)).toBeVisible();

      const selectResult = page.getByRole('button', { name: 'Seleccionar para imprimir', exact: true }).first();
      await selectResult.focus();
      await page.keyboard.press('Space');
      const selectedResult = page.getByRole('button', { name: 'Quitar de impresión', exact: true }).first();
      await expect(selectedResult).toBeVisible();
      await selectedResult.focus();
      await page.keyboard.press('Space');

      await page.getByRole('link', { name: 'Ver fallo', exact: true }).first().click();
      await expect(page).toHaveURL(/\/fallos\/ux-qa-001(?:\?|$)/u);
      await expect(page.getByRole('heading', { name: 'Pérez c/ Gutiérrez s/ daños', exact: true })).toBeVisible();
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

      if (viewport.width <= 430) {
        const controls = await page.evaluate(() => {
          const pageInput = document.querySelector('input[type="number"]');
          const zoom = document.querySelector('select[aria-label="Zoom"], label:has(select) select');
          if (!pageInput || !zoom) return null;
          const pageBox = pageInput.parentElement.getBoundingClientRect();
          const zoomBox = zoom.parentElement.getBoundingClientRect();
          return {
            page: { x: pageBox.x, y: pageBox.y, right: pageBox.right, bottom: pageBox.bottom },
            zoom: { x: zoomBox.x, y: zoomBox.y, right: zoomBox.right, bottom: zoomBox.bottom },
          };
        });
        expect(controls).not.toBeNull();
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
});

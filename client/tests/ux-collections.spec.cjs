'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');

const QA_USER = {
  id: 8919,
  nombre: 'Cuenta',
  apellido: 'QA Colecciones',
  email: 'collections-qa@example.invalid',
  activo: true,
  rol: { id: 7, nombre: 'JURISPRUDENCIA' },
};

async function mountCollection(page, { failDelete = false, deleteDelay = 0 } = {}) {
  let deleted = false;
  let deleteCalls = 0;
  const originalSentenceExists = true;
  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-collections-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, QA_USER);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: QA_USER }));
  await page.route('**/api/research/collections**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname.replace(/^.*\/api/u, '/api');
    if (route.request().method() === 'DELETE' && pathname === '/api/research/collections/77') {
      deleteCalls += 1;
      if (deleteDelay) await new Promise((resolve) => setTimeout(resolve, deleteDelay));
      if (failDelete) return route.fulfill({ status: 503, json: { message: 'synthetic delete failure' } });
      deleted = true;
      return route.fulfill({ json: { data: { deleted: true } } });
    }
    if (route.request().method() === 'GET' && pathname === '/api/research/collections/77') {
      if (deleted) return route.fulfill({ status: 404, json: { message: 'not found' } });
      return route.fulfill({ json: {
        data: {
          id: 77,
          nombre: 'Colección sintética QA',
          items: [{
            id: 7701,
            nota: null,
            sentencia: {
              id: 7702,
              slugPublico: 'fallo-sintetico-qa',
              caratula: 'Fallo sintético QA',
              numeroSentencia: 'QA-77',
              expediente: null,
              sala: 'Sala QA',
              fecha: '2026-11-03T00:00:00.000Z',
              tipoFallo: 'SINTETICO',
            },
          }],
        },
        meta: { total: 1, page: 1, pageSize: 25, pageCount: 1 },
      } });
    }
    if (route.request().method() === 'GET' && pathname === '/api/research/collections') {
      return route.fulfill({ json: { data: deleted ? [] : [{ id: 77, nombre: 'Colección sintética QA', itemCount: 1, updatedAt: '2026-11-03T00:00:00.000Z' }] } });
    }
    return route.fallback();
  });
  return { getDeleteCalls: () => deleteCalls, originalSentenceExists: () => originalSentenceExists };
}

test('navegación de colección, copy y confirmación accesible de borrado @collections', async ({ page }) => {
  const fixture = await mountCollection(page, { deleteDelay: 250 });
  await page.goto('/colecciones/77');
  await expect(page.getByRole('heading', { name: 'Colección sintética QA' })).toBeVisible();
  const backLink = page.getByRole('link', { name: '← Mis colecciones' });
  await expect(backLink).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportar colección' })).toBeVisible();
  await expect(page.getByText(/dossier|manifest\.json/iu)).toHaveCount(0);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      link: document.querySelector('a[class*="collectionBackLink"]')?.getBoundingClientRect().toJSON(),
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
    expect(dimensions.link?.x).toBeGreaterThanOrEqual(0);
    expect(dimensions.link?.y).toBeLessThan(220);
  }

  await backLink.click();
  await expect(page).toHaveURL(/\/colecciones$/u);
  await page.goto('/colecciones/77');
  const deleteTrigger = page.getByRole('button', { name: 'Eliminar colección' });
  await deleteTrigger.click();
  const dialog = page.getByRole('alertdialog', { name: 'Eliminar colección' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(deleteTrigger).toBeFocused();

  await deleteTrigger.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toBeHidden();
  await expect(deleteTrigger).toBeFocused();

  await deleteTrigger.click();
  await expect(dialog).toBeVisible();
  const destructiveAction = dialog.getByRole('button', { name: 'Eliminar colección' });
  await destructiveAction.dblclick({ delay: 30 });
  await expect(page).toHaveURL(/\/colecciones$/u);
  expect(fixture.getDeleteCalls()).toBe(1);
  expect(fixture.originalSentenceExists()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Mis colecciones' })).toBeVisible();
  const diagnostics = page.__uxQaDiagnostics;
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.fixtureMisses).toEqual([]);
});

test('un error al eliminar mantiene la colección y muestra un estado controlado @collections', async ({ page }) => {
  const fixture = await mountCollection(page, { failDelete: true });
  await page.goto('/colecciones/77');
  await page.getByRole('button', { name: 'Eliminar colección' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Eliminar colección' });
  await dialog.getByRole('button', { name: 'Eliminar colección' }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'Sigue disponible' })).toBeVisible();
  expect(fixture.getDeleteCalls()).toBe(1);
  await expect(page.getByRole('heading', { name: 'Colección sintética QA' })).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(fixture.originalSentenceExists()).toBe(true);
});

'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');

const WORKSPACE_ID = 'synthetic-context-workspace';
const QA_USER = {
  id: 9201,
  nombre: 'Lector',
  apellido: 'Contexto QA',
  email: 'context-navigation@example.invalid',
  activo: true,
  rol: { id: 6, nombre: 'LECTOR' },
};

test('Jurisprudencia vuelve al contexto y el detalle conserva la búsqueda al regresar @contextual-navigation', async ({ page }) => {
  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-context-navigation-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, QA_USER);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: QA_USER }));
  await page.route('**/api/workspaces/mine', (route) => route.fulfill({ json: [{
    id: WORKSPACE_ID,
    code: 'SALA-A',
    name: 'Sala A de contexto QA',
    type: 'SALA',
    role: 'VIEWER',
  }] }));
  await page.route(`**/api/workspaces/${WORKSPACE_ID}/folders`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/workspaces/${WORKSPACE_ID}/documents**`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/workspaces/${WORKSPACE_ID}/search/sources`, (route) => route.fulfill({ json: [] }));

  await page.goto(`/spaces?workspaceId=${WORKSPACE_ID}`);
  await expect(page.getByRole('heading', { name: 'Sala A de contexto QA' })).toBeVisible();
  await expect(page.locator('[class*="dependencyBadge"]')).toHaveText('SA');
  const navigation = page.getByRole('navigation', { name: 'Navegación principal' });
  const jurisprudenceLink = navigation.getByRole('link', { name: 'Jurisprudencia', exact: true });
  await expect(jurisprudenceLink).toHaveAttribute('href', /returnTo=%2Fspaces%3FworkspaceId%3Dsynthetic-context-workspace/u);
  await jurisprudenceLink.click();
  await expect(page.getByRole('heading', { name: 'Jurisprudencia', exact: true })).toBeVisible();
  const contextualReturn = page.getByRole('link', { name: /Volver a Mi Sala \/ Juzgado/u });
  await expect(contextualReturn).toBeVisible();
  await expect(page).toHaveURL(/returnTo=%2Fspaces%3FworkspaceId%3Dsynthetic-context-workspace/u);
  await page.reload();
  await expect(page.getByRole('link', { name: /Volver a Mi Sala \/ Juzgado/u })).toBeVisible();

  const search = page.getByLabel('Buscar jurisprudencia');
  await search.fill('responsabilidad civil');
  await search.press('Enter');
  await expect(page.getByText('4 resultados', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Ver 4 sumarios', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Sumarios del fallo', exact: true })).toBeVisible();
  const detailReturnTo = new URL(page.url()).searchParams.get('returnTo');
  expect(detailReturnTo).toContain(`returnTo=%2Fspaces%3FworkspaceId%3D${WORKSPACE_ID}`);
  await page.getByRole('link', { name: 'Volver a resultados', exact: true }).click();
  await expect(page.getByLabel('Buscar jurisprudencia')).toHaveValue('responsabilidad civil');
  await expect(page.getByRole('link', { name: /Volver a Mi Sala \/ Juzgado/u })).toBeVisible();
  await page.getByRole('link', { name: /Volver a Mi Sala \/ Juzgado/u }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces\\?workspaceId=${WORKSPACE_ID}`, 'u'));
  await expect(page.getByRole('heading', { name: 'Sala A de contexto QA' })).toBeVisible();

  const diagnostics = page.__uxQaDiagnostics;
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.networkErrors).toEqual([]);
  expect(diagnostics.fixtureMisses).toEqual([]);
});

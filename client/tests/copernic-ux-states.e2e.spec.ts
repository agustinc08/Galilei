import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getE2eArtifactPath, loadE2eCredentials } from './qa-credentials';

const credentials = loadE2eCredentials();
const screenshotRoot = getE2eArtifactPath('copernic-ux-states');

async function capture(page: Page, name: string) {
  mkdirSync(screenshotRoot, { recursive: true });
  await page.screenshot({ path: resolve(screenshotRoot, name), fullPage: false, animations: 'disabled' });
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.reader.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.reader.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
}

test('Galilei presenta entradas directas y separadas para cada destino', async ({ page }) => {
  await login(page);
  await page.goto('/galilei');

  const destinations = page.getByRole('navigation', { name: 'Elegir dónde consultar' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await capture(page, 'home-desktop-1366x768.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'home-mobile-390x844.png');
  await expect(destinations.getByRole('link', { name: /Jurisprudencia/u })).toHaveAttribute('href', '/consulta');
  await expect(destinations.getByRole('link', { name: /Mi Sala \/ Juzgado/u })).toHaveAttribute('href', '/spaces');
  await expect(destinations.getByRole('link', { name: /Mis documentos/u })).toHaveAttribute('href', '/personal');
  await expect(page.getByRole('link', { name: /Mi espacio|Workspace|Copernic/u })).toHaveCount(0);
});

test('un error al cargar dependencias muestra reintento y no el estado vacío', async ({ page }) => {
  await login(page);
  let attempts = 0;
  let recoveryEnabled = false;
  await page.route('**/api/workspaces/mine', async (route) => {
    attempts += 1;
    if (!recoveryEnabled) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic outage' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/spaces');
  await expect(page.getByRole('heading', { name: 'No pudimos cargar tus dependencias' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Todavía no tenés una dependencia asignada' })).toHaveCount(0);
  const failedAttempts = attempts;
  await page.setViewportSize({ width: 1366, height: 768 });
  await capture(page, 'dependency-load-error-1366x768.png');
  recoveryEnabled = true;
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByRole('heading', { name: 'Todavía no tenés una dependencia asignada' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'dependency-empty-390x844.png');
  expect(attempts).toBeGreaterThan(failedAttempts);
});

test('Mis documentos muestra carga antes del vacío y diferencia una búsqueda sin resultados', async ({ page }) => {
  await login(page);
  await page.route('**/api/workspaces/mine', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/personal/folders**', async (route) => {
    await new Promise((resolveRequest) => setTimeout(resolveRequest, 900));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/personal/documents**', async (route) => {
    await new Promise((resolveRequest) => setTimeout(resolveRequest, 900));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/personal/search**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ total: 0, results: [] }),
  }));
  await page.route('**/api/personal/search/names**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ total: 0, results: [] }),
  }));

  await page.goto('/personal');
  await expect(page.getByRole('status').filter({ hasText: 'Cargando documentos…' })).toBeVisible();
  await expect(page.getByText('Todavía no hay documentos en esta carpeta.')).toHaveCount(0);
  await expect(page.getByText('Todavía no hay carpetas acá.')).toHaveCount(0);
  await page.setViewportSize({ width: 1366, height: 768 });
  await capture(page, 'personal-loading-1366x768.png');
  await expect(page.getByText('Todavía no hay documentos en esta carpeta.')).toBeVisible({ timeout: 5_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'personal-empty-mobile-390x844.png');

  await page.getByLabel('Buscar en Mis documentos').fill('consulta sintética');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByText('No encontramos documentos con ese texto.')).toBeVisible();
  await expect(page.getByText('Todavía no hay documentos en esta carpeta.')).toHaveCount(0);
  await capture(page, 'personal-no-search-results-390x844.png');
});

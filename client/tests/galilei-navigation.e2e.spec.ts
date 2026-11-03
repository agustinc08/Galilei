import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { getE2eArtifactPath, loadE2eCredentials } from './qa-credentials';

const credentials = loadE2eCredentials();

test('the public landing page opens each destination or requests sign-in', async ({ page }) => {
  await page.goto('/');
  const destinations = page.getByRole('navigation', { name: 'Secciones de Galilei' });
  await expect(destinations.getByRole('link')).toHaveCount(3);

  await destinations.getByRole('link', { name: /Jurisprudencia/u }).click();
  await expect(page).toHaveURL(/\/consulta$/u);
  await expect(page.getByRole('heading', { name: 'Jurisprudencia', exact: true })).toBeVisible();

  await page.goto('/');
  await destinations.getByRole('link', { name: /Mi Sala \/ Juzgado/u }).click();
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/u);

  await page.goto('/');
  await destinations.getByRole('link', { name: /Mis documentos/u }).click();
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/u);

  await page.goto('/');
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/u);
});

test('Galilei keeps role-aware destinations visible across authenticated routes', async ({ page }) => {
  const screenshotDir = getE2eArtifactPath('galilei-navigation');
  mkdirSync(screenshotDir, { recursive: true });
  const responsiveViewports = [
    [390, 844], [768, 1024], [1366, 768], [1440, 900], [1536, 864], [1600, 900],
    [1920, 1080], [1920, 1200], [2560, 1440],
  ] as const;
  async function captureResponsive(routeName: string) {
    for (const [width, height] of responsiveViewports) {
      await page.setViewportSize({ width, height });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        'no horizontal overflow at ' + width + 'x' + height + ' on ' + routeName,
      ).toBe(true);
      if (width === 1366 && height === 768 || width === 1920 && height === 1080) {
        await page.screenshot({
          path: resolve(screenshotDir, routeName + '-' + width + '.png'),
          fullPage: false,
        });
      }
    }
  }

  const reader = credentials.accounts.reader;
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(reader.email);
  await page.getByLabel('Contraseña').fill(reader.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();

  await expect(page).toHaveURL(/\/galilei$/u);
  await expect(page.getByRole('heading', { name: '¿Qué querés consultar?' })).toBeVisible();
  await captureResponsive('galilei-home');

  const navigation = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(navigation.getByRole('link')).toHaveCount(4);
  await expect(navigation.getByRole('link', { name: /Jurisprudencia/u })).toBeVisible();
  await expect(navigation.getByRole('link', { name: /Jurisprudencia/u })).toHaveAttribute('href', '/consulta');
  await expect(navigation.getByRole('link', { name: /Mi Sala \/ Juzgado/u })).toBeVisible();
  await expect(navigation.getByRole('link', { name: /Mis documentos/u })).toBeVisible();
  await expect(navigation.getByRole('link', { name: /Mis colecciones/u })).toBeVisible();
  await expect(navigation.getByRole('link', { name: /Copernic|Workspace/u })).toHaveCount(0);

  await page.goto('/consulta?q=responsabilidad%20civil');
  await expect(navigation.getByRole('link', { name: /Jurisprudencia/u })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Jurisprudencia', exact: true })).toBeVisible();
  const search = page.getByLabel('Buscar jurisprudencia');
  await expect(search).toHaveValue('responsabilidad civil');
  await expect(page.getByText('Buscando fallos…')).toHaveCount(0, { timeout: 30_000 });
  const resultSummary = page.getByText(/\d[\d.,]* resultados/u).first();
  await expect(resultSummary).toBeVisible();
  const resultCountText = await resultSummary.textContent() ?? '';
  const resultCount = Number.parseInt(resultCountText.replace(/\D/gu, ''), 10);
  expect(Number.isFinite(resultCount), `parse result count from "${resultCountText}"`).toBe(true);
  if (resultCount === 0) {
    // Local DEV snapshots may have no published cases; assert the real empty state.
    await expect(page.getByRole('status')).toContainText('No encontramos fallos con estos criterios.');
  } else {
    const realResult = page.locator('article').first();
    await expect(realResult).toBeVisible();
    await expect(realResult.locator('h2 a')).toHaveAttribute(
      'href',
      /^\/consulta\/sentencia\/(?!undefined(?:\?|$))[^/?]+(?:\?.*)?$/u,
    );
  }
  await captureResponsive('jurisprudencia');

  await page.goto('/busqueda-avanzada?q=consulta-interna');
  await expect(page).toHaveURL(/\/consulta$/u);
  await expect(page.getByRole('heading', { name: 'Búsqueda avanzada' })).toHaveCount(0);
  await expect(page.getByLabel('Buscar jurisprudencia')).toBeVisible();

  await page.goto('/spaces');
  await expect(navigation.getByRole('link', { name: /Mi Sala \/ Juzgado/u })).toHaveAttribute('aria-current', 'page');
  await captureResponsive('mi-sala');

  await page.goto('/personal');
  await expect(navigation.getByRole('link', { name: /Mis documentos/u })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Mis documentos', exact: true })).toBeVisible();
  await captureResponsive('mis-documentos');

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.goto('/spaces');
  await expect(page).toHaveURL(/\/login$/u);
});

test('the technical dashboard exposes one quick link per destination', async ({ page }) => {
  const admin = credentials.accounts.admin;
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(admin.email);
  await page.getByLabel('Contraseña').fill(admin.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.waitForURL(/\/galilei$/u);

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Panel institucional' })).toBeVisible();
  const quickLinks = page.locator('a[class*="quickLinkCard"]');
  const destinations = await quickLinks.evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).pathname));
  expect(destinations.length).toBeGreaterThan(0);
  expect(new Set(destinations).size).toBe(destinations.length);
  await expect(page.getByRole('link', { name: 'Búsqueda avanzada' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Consulta pública' })).toHaveCount(1);
  await page.goto('/busqueda-avanzada');
  await expect(page).toHaveURL(/\/consulta$/u);
  await expect(page.getByRole('heading', { name: 'Búsqueda avanzada' })).toHaveCount(0);
});

test('Jurisprudencia retains advanced search and role navigation', async ({ page }) => {
  const jurisprudencia = credentials.accounts.jurisprudencia;
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(jurisprudencia.email);
  await page.getByLabel('Contraseña').fill(jurisprudencia.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.waitForURL(/\/galilei$/u);

  const navigation = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(navigation.getByRole('link', { name: /Jurisprudencia/u })).toHaveAttribute('href', '/busqueda-avanzada');
  await navigation.getByRole('link', { name: /Jurisprudencia/u }).click();
  await expect(page).toHaveURL(/\/busqueda-avanzada$/u);
  await expect(page.getByRole('heading', { name: 'Búsqueda avanzada' })).toBeVisible();
  await expect(page.getByLabel('Buscar jurisprudencia')).toBeVisible();

  for (const [width, height] of [[390, 844], [768, 1024], [1366, 768]]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `no horizontal overflow at ${width}x${height}`,
    ).toBe(true);
    await expect(page.getByRole('heading', { name: 'Búsqueda avanzada' })).toBeVisible();
  }
});

test('advanced search state and navigation do not survive a Jurisprudencia-to-Sala session change', async ({ page }) => {
  const jurisprudencia = credentials.accounts.jurisprudencia;
  const sala = credentials.accounts.reader;

  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(jurisprudencia.email);
  await page.getByLabel('Contraseña').fill(jurisprudencia.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.waitForURL(/\/galilei$/u);
  await page.goto('/busqueda-avanzada');
  await expect(page.getByRole('heading', { name: 'Búsqueda avanzada' })).toBeVisible();
  await page.evaluate(() => {
    window.history.replaceState(
      { ...(window.history.state ?? {}), __bjcAdvancedSearchFilters: { q: 'estado temporal' } },
      '',
      window.location.href,
    );
  });

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('Correo electrónico').fill(sala.email);
  await page.getByLabel('Contraseña').fill(sala.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.waitForURL(/\/galilei$/u);

  const navigation = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(navigation.getByRole('link', { name: /Jurisprudencia/u })).toHaveAttribute('href', '/consulta');
  expect(
    await page.evaluate(() => Boolean((window.history.state as Record<string, unknown> | null)?.__bjcAdvancedSearchFilters)),
  ).toBe(false);
  await page.goto('/busqueda-avanzada?q=estado-temporal');
  await expect(page).toHaveURL(/\/consulta$/u);
  await expect(page.getByRole('heading', { name: 'Búsqueda avanzada' })).toHaveCount(0);
  await expect(page.getByLabel('Buscar jurisprudencia')).toBeVisible();
});

test('unknown routes and role-restricted deep links show controlled states', async ({ page }) => {
  const reader = credentials.accounts.reader;
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(reader.email);
  await page.getByLabel('Contraseña').fill(reader.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.waitForURL(/\/galilei$/u);

  await page.goto('/ruta-inexistente-gpc');
  await expect(page.getByRole('heading', { name: 'Página no encontrada' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');

  await page.goto('/dashboard');
  await expect(page.getByRole('alert').getByText('No autorizado', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Panel institucional' })).toHaveCount(0);

  await page.addInitScript(() => {
    const marker = window as Window & { __advancedSearchHeadingSeen?: boolean };
    const check = () => {
      if (document.querySelector('h1')?.textContent?.trim() === 'Búsqueda avanzada') {
        marker.__advancedSearchHeadingSeen = true;
      }
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
    window.addEventListener('DOMContentLoaded', check);
  });
  await page.goto('/busqueda-avanzada?q=deep-link');
  await expect(page).toHaveURL(/\/consulta$/u);
  await expect(page.getByRole('heading', { name: 'Búsqueda avanzada' })).toHaveCount(0);
  expect(await page.evaluate(() => Boolean((window as Window & { __advancedSearchHeadingSeen?: boolean }).__advancedSearchHeadingSeen))).toBe(false);
});

test('missing corpus documents end their loading states with a privacy-safe message', async ({ page }) => {
  const admin = credentials.accounts.admin;
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(admin.email);
  await page.getByLabel('Contraseña').fill(admin.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.waitForURL(/\/galilei$/u);

  await page.goto('/corpus/gpc-missing-id');
  await expect(page.getByRole('alert')).toContainText('No encontramos este documento o no tenés acceso.');
  await expect(page.getByRole('status').filter({ hasText: 'Documento no disponible.' })).toBeVisible();
  await expect(page.getByText('Cargando panel de curaduría…')).toHaveCount(0);
  await expect(page.getByText('Cargando PDF…')).toHaveCount(0);

  let releaseDelayedResponses: (() => void) | undefined;
  const delayedResponses = new Promise<void>((resolveResponses) => {
    releaseDelayedResponses = resolveResponses;
  });
  await page.route('**/api/corpus/documents/gpc-delayed-missing-id**', async (route) => {
    await delayedResponses;
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not found' }) });
  });
  await page.goto('/corpus/gpc-delayed-missing-id');
  await expect(page.getByRole('status').filter({ hasText: 'Cargando PDF…' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  releaseDelayedResponses?.();
  await expect(page.getByRole('alert')).toContainText('No encontramos este documento o no tenés acceso.');
  await page.unroute('**/api/corpus/documents/gpc-delayed-missing-id**');
});

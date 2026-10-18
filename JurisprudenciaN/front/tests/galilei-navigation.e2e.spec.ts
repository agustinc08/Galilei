import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const credentials = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../_recovery-work/sprint10/acceptance/credentials.json'), 'utf8'),
) as { accounts: Record<string, { email: string; password: string }> };

test('Galilei keeps its three destinations visible across authenticated routes', async ({ page }) => {
  const screenshotDir = resolve(process.cwd(), '../../_recovery-work/integration-int1/screenshots');
  mkdirSync(screenshotDir, { recursive: true });
  const responsiveViewports = [
    [390, 844], [1366, 768], [1440, 900], [1536, 864], [1600, 900],
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

  const navigation = page.getByRole('navigation', { name: 'Secciones principales' });
  await expect(navigation.getByRole('link')).toHaveCount(3);
  await expect(navigation.getByRole('link', { name: /Jurisprudencia/u })).toBeVisible();
  await expect(navigation.getByRole('link', { name: /Mi Sala \/ Juzgado/u })).toBeVisible();
  await expect(navigation.getByRole('link', { name: /Mis documentos/u })).toBeVisible();
  await expect(navigation.getByRole('link', { name: /Copernic|Workspace/u })).toHaveCount(0);

  await page.goto('/consulta?q=responsabilidad%20civil');
  await expect(navigation.getByRole('link', { name: /Jurisprudencia/u })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Jurisprudencia', exact: true })).toBeVisible();
  const search = page.getByLabel('Buscar jurisprudencia');
  await expect(search).toHaveValue('responsabilidad civil');
  await expect(page.getByText('Buscando fallos…')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/\d[\d.,]* resultados/u).first()).toBeVisible();
  const realResult = page.locator('article').first();
  await expect(realResult).toBeVisible();
  await expect(realResult.locator('h2 a')).toHaveAttribute(
    'href',
    /^\/consulta\/sentencia\/(?!undefined(?:\?|$))[^/?]+(?:\?.*)?$/u,
  );
  await captureResponsive('jurisprudencia');

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

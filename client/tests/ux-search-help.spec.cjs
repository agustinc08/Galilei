'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');

test('la ayuda de Search muestra todos los consejos y se adapta al viewport @search-help', async ({ page }) => {
  const viewports = [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ];
  await page.setViewportSize(viewports[0]);
  await page.goto('/consulta');
  await expect(page.getByRole('heading', { name: 'Jurisprudencia' })).toBeVisible();

  const mobileActions = page.locator('[class*="mobileSearchActions"]');
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    if (await mobileActions.isVisible()) await mobileActions.locator('summary').click();
    const toggle = page.getByRole('button', { name: 'Consejos de búsqueda', exact: true });
    const help = page.locator('#search-help-panel');
    await page.getByLabel('Buscar jurisprudencia').focus();
    let toggleReachedByTab = false;
    for (let tabCount = 0; tabCount < 30; tabCount += 1) {
      await page.keyboard.press('Tab');
      if (await toggle.evaluate((element) => element === document.activeElement)) {
        toggleReachedByTab = true;
        break;
      }
    }
    expect(toggleReachedByTab).toBe(true);
    await expect(toggle).toBeFocused();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(help).toBeVisible();

    for (const title of [
      'Términos sin comillas',
      'Una palabra exacta',
      'Frase exacta',
      'Exclusión',
      'Operadores',
      'Campos',
      'Comodín %',
      'Tildes y ñ',
      'Filtros',
    ]) await expect(help.getByText(title, { exact: true })).toBeVisible();
    const adviceBlocks = help.locator('div[class*="listItem"]');
    await expect(adviceBlocks).toHaveCount(9);
    for (let index = 0; index < 9; index += 1) {
      await expect(adviceBlocks.nth(index)).toBeVisible();
      await expect(adviceBlocks.nth(index).locator('span')).toBeVisible();
    }
    await expect(adviceBlocks.filter({ hasText: 'Tildes y ñ' }).locator('span'))
      .toHaveText('Mayúsculas y minúsculas coinciden; las vocales con o sin tilde también. La ñ es distinta de la n.');
    await expect(help.locator('details')).toHaveCount(0);
    await expect(help.getByRole('button')).toHaveCount(0);
    await expect(help.getByText('Acentos y ñ', { exact: true })).toHaveCount(0);

    const columns = await help.locator('div[class*="searchHelpList"]').evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/u).length,
    );
    expect(columns).toBe(viewport.width <= 600 ? 1 : 2);
    const layout = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);

    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(help).toBeHidden();
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(help).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  }

  await page.getByLabel('Buscar jurisprudencia').fill('responsabilidad civil');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByText('4 resultados', { exact: true })).toBeVisible();
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.console.filter((message) => message.type === 'error')).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.fixtureMisses).toEqual([]);
});

'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');
const { inspectNavigationShell } = require('../ux-qa/navigation.cjs');

test('navigation helper checks active item, title, logout visibility, and sidebar overflow @public @accessibility', async ({ page }) => {
  await page.setContent(`
    <main>
      <nav aria-label="Navegación principal">
        <a href="/workspace" aria-current="page">Workspace</a>
      </nav>
      <h1>Workspace QA</h1>
      <button type="button">Cerrar sesión</button>
      <aside data-ux-qa-sidebar style="width: 240px; overflow: auto">Sidebar fixture</aside>
    </main>
  `);
  const result = await inspectNavigationShell(page, {
    navigationName: 'Navegación principal',
    title: 'Workspace QA',
    logoutLabel: 'Cerrar sesión',
    sidebarSelector: '[data-ux-qa-sidebar]',
  });
  expect(result).toEqual({
    navigationVisible: true,
    activeNavLabel: 'Workspace',
    ariaCurrent: 'page',
    headingVisible: true,
    logoutVisible: true,
    sidebar: { clientWidth: 240, scrollWidth: 240, overflows: false },
  });
});

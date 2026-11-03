'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');

const QA_USER = {
  id: 8921,
  nombre: 'Ana',
  apellido: 'QA Beta',
  email: 'profile-qa@example.invalid',
  activo: true,
  createdAt: '2026-10-01T12:00:00.000Z',
  ultimoAcceso: '2026-11-02T15:30:00.000Z',
  rol: { id: 7, nombre: 'JURISPRUDENCIA' },
};

test('el perfil resume identidad y permisos sin habilitar cambios administrativos @profile', async ({ page }) => {
  let passwordChangePayload;
  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-profile-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, QA_USER);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: QA_USER }));
  await page.route('**/api/workspaces/mine', (route) => route.fulfill({ json: [
    { id: 'synthetic-sala-a', code: 'SALA-A', name: 'Sala QA A', type: 'SALA', role: 'EDITOR' },
    { id: 'synthetic-juzgado-1', code: 'JUZGADO-1', name: 'Juzgado QA 1', type: 'JUZGADO', role: 'VIEWER' },
  ] }));
  await page.route('**/api/auth/change-password', async (route) => {
    passwordChangePayload = route.request().postDataJSON();
    await route.fulfill({ json: { data: { message: 'synthetic password updated' } } });
  });

  await page.goto('/perfil');
  await expect(page.getByRole('heading', { name: 'Mi perfil' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ana QA Beta', exact: true })).toBeVisible();
  await expect(page.getByText('profile-qa@example.invalid', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').locator('dl').getByText('Jurisprudencia', { exact: true })).toBeVisible();
  const salaMembership = page.getByRole('listitem').filter({ hasText: 'Sala QA A' });
  const juzgadoMembership = page.getByRole('listitem').filter({ hasText: 'Juzgado QA 1' });
  await expect(salaMembership).toContainText('Edición');
  await expect(juzgadoMembership).toContainText('Consulta');
  await expect(page.locator('[class*="dependencyBadge"]')).toHaveText(['SA', 'J1']);
  await expect(page.getByRole('button', { name: /rol|permiso|dependencia/iu })).toHaveCount(0);

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
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  }

  await page.getByLabel('Contraseña actual').fill('synthetic-current-password');
  await page.getByLabel('Nueva contraseña', { exact: true }).fill('synthetic-new-password-2026');
  await page.getByLabel('Repetir nueva contraseña', { exact: true }).fill('synthetic-new-password-2026');
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await expect(page.getByText('Contraseña actualizada correctamente.')).toBeVisible();
  expect(passwordChangePayload).toEqual({
    currentPassword: 'synthetic-current-password',
    newPassword: 'synthetic-new-password-2026',
  });
  const diagnostics = page.__uxQaDiagnostics;
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.networkErrors).toEqual([]);
  expect(diagnostics.fixtureMisses).toEqual([]);
});

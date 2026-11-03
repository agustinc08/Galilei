'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');

const WORKSPACE_ID = 'synthetic-member-workspace';
const QA_ADMIN = {
  id: 9101,
  nombre: 'Responsable',
  apellido: 'QA',
  email: 'workspace-admin@example.invalid',
  activo: true,
  rol: { id: 6, nombre: 'LECTOR' },
};
const QA_MEMBER = {
  userId: 9102,
  role: 'VIEWER',
  active: true,
  user: { nombre: 'Miembro', apellido: 'Sintético', email: 'workspace-member@example.invalid' },
};

test('Administración de dependencia agrega, cambia, quita y reactiva membresías @workspace-members', async ({ page }) => {
  let members = [
    { userId: QA_ADMIN.id, role: 'ADMIN', active: true, user: { nombre: QA_ADMIN.nombre, apellido: QA_ADMIN.apellido, email: QA_ADMIN.email } },
    QA_MEMBER,
  ];
  const writes = [];
  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-workspace-members-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, QA_ADMIN);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: QA_ADMIN }));
  await page.route('**/api/workspaces/mine', (route) => route.fulfill({ json: [{
    id: WORKSPACE_ID,
    code: 'SALA-A',
    name: 'Sala de QA para membresías',
    type: 'SALA',
    role: 'ADMIN',
  }] }));
  await page.route(`**/api/workspaces/${WORKSPACE_ID}/folders`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/workspaces/${WORKSPACE_ID}/documents**`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/workspaces/${WORKSPACE_ID}/activity`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/workspaces/${WORKSPACE_ID}/sources`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/workspaces/${WORKSPACE_ID}/membership-candidates**`, (route) => route.fulfill({ json: [{
    id: 9103,
    nombre: 'Nueva',
    apellido: 'Integrante QA',
    email: 'new-member@example.invalid',
  }] }));
  await page.route(`**/api/workspaces/${WORKSPACE_ID}/members`, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: members });
    const payload = route.request().postDataJSON();
    writes.push(payload);
    const userId = Number(payload.userId);
    const previous = members.find((member) => member.userId === userId);
    const candidate = userId === 9103
      ? { nombre: 'Nueva', apellido: 'Integrante QA', email: 'new-member@example.invalid' }
      : previous.user;
    const next = { userId, role: payload.role, active: payload.active ?? true, user: candidate };
    members = previous
      ? members.map((member) => member.userId === userId ? next : member)
      : [...members, next];
    return route.fulfill({ json: next });
  });

  await page.goto(`/spaces/manage?workspaceId=${WORKSPACE_ID}`);
  const memberHeading = page.getByRole('heading', { name: 'Miembros y permisos' });
  await expect(memberHeading).toBeVisible();
  await expect(page.locator('[class*="dependencyBadge"]')).toHaveText('SA');
  await expect(page.locator('[class*="memberIdentity"]').filter({ hasText: 'workspace-member@example.invalid' })).toBeVisible();

  await page.getByLabel('Buscar persona por nombre o correo').fill('new-member');
  await page.getByLabel('Rol para la nueva membresía').selectOption('VIEWER');
  await page.locator('form').filter({ has: page.getByLabel('Buscar persona por nombre o correo') })
    .getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByRole('button', { name: 'Agregar como Consulta' }).click();
  const newMemberRole = page.getByLabel('Permiso de new-member@example.invalid');
  await expect(newMemberRole).toHaveValue('VIEWER');
  await newMemberRole.selectOption('EDITOR');
  await page.getByRole('button', { name: 'Guardar permiso' }).click();
  await expect(newMemberRole).toHaveValue('EDITOR');

  const targetRow = page.locator('[class*="memberRow"]').filter({ hasText: 'new-member@example.invalid' });
  const removeTrigger = targetRow.getByRole('button', { name: 'Quitar de esta dependencia' });
  await removeTrigger.focus();
  await removeTrigger.click();
  const confirmation = page.getByRole('alertdialog', { name: 'Quitar de esta dependencia' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('Nueva Integrante QA');
  await expect(confirmation).toContainText('Sala de QA para membresías');
  await expect(confirmation).toContainText('Su cuenta seguirá existiendo en Galilei');
  await expect(confirmation.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(removeTrigger).toBeFocused();

  await removeTrigger.click();
  await confirmation.getByRole('button', { name: 'Quitar de esta dependencia', exact: true }).click();
  await expect(page.getByText('Acceso desactivado', { exact: false })).toBeVisible();
  await expect(page.locator('[class*="memberIdentity"]').filter({ hasText: 'new-member@example.invalid' })).toBeVisible();
  await page.getByRole('button', { name: 'Reactivar', exact: true }).click();
  await expect(newMemberRole).toHaveValue('EDITOR');
  await expect(page.getByText('Membresía guardada.', { exact: true })).toBeVisible();
  expect(writes.map(({ userId, role, active }) => ({ userId, role, active }))).toEqual([
    { userId: 9103, role: 'VIEWER', active: true },
    { userId: 9103, role: 'EDITOR', active: true },
    { userId: 9103, role: 'EDITOR', active: false },
    { userId: 9103, role: 'EDITOR', active: true },
  ]);
  const diagnostics = page.__uxQaDiagnostics;
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.networkErrors).toEqual([]);
  expect(diagnostics.fixtureMisses).toEqual([]);
});

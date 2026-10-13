import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const credentials = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../_recovery-work/sprint10/acceptance/credentials.json'), 'utf8'),
) as { accounts: Record<string, { email: string; password: string }> };
const pdf = readFileSync(resolve(process.cwd(), '../back/scripts/dev/fixtures/corpus/fallo-fixture.pdf'));
const runId = `${Date.now()}`;
const codeA = `S151UIE2E_A_${runId}`;
const codeB = `S151UIE2E_B_${runId}`;
const nameA = `Sala UAT privada A ${runId}`;
const nameB = `Juzgado UAT privado B ${runId}`;

async function login(page: Page, account: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(account.email);
  await page.getByLabel('Contraseña').fill(account.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
}

async function createSpace(page: Page, code: string, name: string, type: string) {
  await page.getByRole('button', { name: 'Crear espacio documental', exact: true }).click();
  await page.getByLabel('Código de dependencia').fill(code);
  await page.getByLabel('Nombre de dependencia').fill(name);
  await page.getByLabel('Tipo de dependencia').selectOption(type);
  await page.getByRole('button', { name: 'Crear espacio', exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function addMember(page: Page, email: string, role: string) {
  const lookup = page.getByLabel('Buscar persona por nombre o correo');
  const searchButton = lookup.locator('xpath=../..').getByRole('button', { name: 'Buscar' });
  await page.getByLabel('Rol para la nueva membresía').selectOption(role === 'Editor' ? 'EDITOR' : 'VIEWER');
  await lookup.fill(email);
  await expect(searchButton).toBeEnabled({ timeout: 10_000 });
  await searchButton.click();
  const addButton = page.getByRole('button', { name: `Agregar como ${role}` });
  await expect(addButton).toBeVisible();
  await addButton.click();
  await expect(page.getByLabel(`Permiso de ${email}`)).toBeVisible();
}

async function workspaceOptionValue(page: Page, name: string) {
  const option = page.getByLabel('Espacio documental').locator('option').filter({ hasText: name });
  const value = await option.getAttribute('value');
  expect(value).toBeTruthy();
  return value!;
}

test('perfiles sintéticos de DEV completan los flujos privados principales desde la interfaz', async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(10_000);
  const outputDir = resolve(process.cwd(), '../../_recovery-work/sprint151/ui');
  mkdirSync(outputDir, { recursive: true });
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon|websocket|404 \(Not Found\)/iu.test(message.text()))
      browserErrors.push(message.text());
  });

  // The seeded acceptance reader begins without any private membership.
  await login(page, credentials.accounts.reader);
  await page.goto('/spaces');
  await expect(page.getByRole('heading', { name: 'No tenés un espacio documental asignado' })).toBeVisible();
  await expect(page.getByText('Contactá al administrador de Galilei')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  // Galilei ADMIN creates the two synthetic workspaces and manages the first.
  await login(page, credentials.accounts.admin);
  await page.goto('/spaces');
  await expect(page.getByText('Administración global', { exact: true })).toBeVisible();
  await createSpace(page, codeA, nameA, 'SALA');

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: resolve(outputDir, 'workspace-1366x768.png'), fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: resolve(outputDir, 'workspace-1920x1080.png'), fullPage: true });

  await createSpace(page, codeB, nameB, 'JUZGADO');
  const workspaceSelect = page.getByLabel('Espacio documental');
  await expect(workspaceSelect).toBeVisible();
  const workspaceAId = await workspaceOptionValue(page, nameA);
  const workspaceBId = await workspaceOptionValue(page, nameB);
  await workspaceSelect.selectOption(workspaceAId);

  // Workspace administration adds and changes people by name/email, not by ID.
  await addMember(page, credentials.accounts.operator.email, 'Editor');
  const editorRole = page.getByLabel(`Permiso de ${credentials.accounts.operator.email}`);
  await expect(editorRole).toHaveValue('EDITOR');
  const editorActions = editorRole.locator('xpath=../..');
  await editorActions.getByRole('button', { name: 'Desactivar acceso' }).click();
  const memberConfirmation = page.getByRole('alertdialog');
  await expect(memberConfirmation).toBeVisible();
  await memberConfirmation.getByRole('button', { name: 'Desactivar', exact: true }).click();
  await expect(page.getByText('Acceso desactivado', { exact: false })).toBeVisible();
  await editorActions.getByRole('button', { name: 'Reactivar', exact: true }).click();
  await expect(editorRole).toHaveValue('EDITOR');
  await expect(page.getByRole('status')).toContainText('Membresía guardada.', { timeout: 10_000 });
  await addMember(page, credentials.accounts.reviewer.email, 'Editor');
  await expect(page.getByLabel(`Permiso de ${credentials.accounts.reviewer.email}`)).toHaveValue('EDITOR');

  // Folder creation, rename, breadcrumb and root/folder boundaries.
  const folderNameInput = page.getByLabel('Nombre de carpeta');
  await folderNameInput.fill('Sentencias');
  await page.getByRole('button', { name: 'Crear carpeta', exact: true }).click();
  await expect(page.getByRole('button', { name: /Renombrar Sentencias/ })).toBeVisible();
  await page.getByRole('button', { name: 'Renombrar Sentencias' }).click();
  await page.getByLabel('Nuevo nombre de carpeta').fill('Actuaciones 2026');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  const folderButton = page.getByRole('button', { name: /Actuaciones 2026/ }).first();
  await expect(folderButton).toBeVisible();
  await folderButton.click();
  await expect(page.getByRole('navigation', { name: 'Ruta de carpetas' })).toContainText('Actuaciones 2026');

  // Per-file status and continuation across one, five and twenty PDFs.
  const fileInput = page.getByLabel('Seleccionar archivos PDF');
  await fileInput.setInputFiles([{ name: 'sprint151-e2e-one.pdf', mimeType: 'application/pdf', buffer: pdf }]);
  await expect(page.getByRole('status').filter({ hasText: '1 archivo(s) procesado(s).' })).toBeVisible({ timeout: 60_000 });

  await fileInput.setInputFiles([
    { name: 'archivo-corrupto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-archivo-corrupto') },
    { name: 'sprint151-e2e-continue.pdf', mimeType: 'application/pdf', buffer: pdf },
  ]);
  await expect(page.getByText(/archivo-corrupto\.pdf.*Error/iu)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/sprint151-e2e-continue\.pdf.*Ya estaba en este espacio/iu)).toBeVisible();

  await fileInput.setInputFiles(Array.from({ length: 5 }, (_, index) => ({
    name: `sprint151-e2e-five-${index + 1}.pdf`, mimeType: 'application/pdf', buffer: pdf,
  })));
  await expect(page.getByRole('status').filter({ hasText: '5 archivo(s) procesado(s).' })).toBeVisible({ timeout: 60_000 });
  await fileInput.setInputFiles(Array.from({ length: 20 }, (_, index) => ({
    name: `sprint151-e2e-twenty-${index + 1}.pdf`, mimeType: 'application/pdf', buffer: pdf,
  })));
  await expect(page.getByRole('status').filter({ hasText: '20 archivo(s) procesado(s).' })).toBeVisible({ timeout: 120_000 });

  await page.getByLabel('Buscar documentos privados').fill('JORGE');
  await page.getByLabel('Buscar documentos privados').locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true }).click();
  const contentResults = page.locator('[aria-label="Resultados por contenido"]');
  await expect(contentResults.getByRole('link', { name: /sprint151-e2e-one\.pdf/iu })).toBeVisible({ timeout: 60_000 });
  const documentLink = contentResults.getByRole('link', { name: /sprint151-e2e-one\.pdf/iu });
  const documentPath = await documentLink.getAttribute('href');
  expect(documentPath).toBeTruthy();
  await documentLink.click();
  await expect(page.getByRole('link', { name: '← Volver al espacio' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar PDF' })).toBeVisible();
  await expect(page.locator('.react-pdf__Page')).toBeVisible({ timeout: 60_000 });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar PDF' }).click();
  expect((await download).suggestedFilename()).toBe('sprint151-e2e-one.pdf');
  await page.getByRole('link', { name: '← Volver al espacio' }).click();
  await expect(page.getByLabel('Buscar documentos privados')).toHaveValue('JORGE');
  await expect(page.locator('[aria-label="Resultados por contenido"]').getByRole('link', { name: /sprint151-e2e-one\.pdf/iu })).toBeVisible({ timeout: 60_000 });

  await page.getByLabel('Buscar documentos privados').fill('sprint151-e2e-one');
  await page.getByLabel('Buscar documentos privados').locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Coincidencias por nombre/iu })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Alcance de carpeta para la búsqueda').selectOption('CURRENT');
  await page.getByLabel('Buscar documentos privados').locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByText(/Buscando en:.*Actuaciones 2026/iu)).toBeVisible();
  await expect(page.getByLabel('Buscar documentos privados').locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true })).toBeEnabled({ timeout: 60_000 });

  // The admin sees and changes only workspace assignments; the shared search remains available.
  await workspaceSelect.selectOption(workspaceBId);
  await addMember(page, credentials.accounts.operator.email, 'Consulta');
  const operatorRoleB = page.getByLabel(`Permiso de ${credentials.accounts.operator.email}`);
  await expect(operatorRoleB).toHaveValue('VIEWER');
  await operatorRoleB.selectOption('EDITOR');
  const saveOperatorRole = operatorRoleB.locator('xpath=../..').getByRole('button', { name: 'Guardar permiso' });
  await expect(saveOperatorRole).toBeVisible({ timeout: 5_000 });
  await saveOperatorRole.click();
  await expect(operatorRoleB).toHaveValue('EDITOR');
  await expect(page.getByRole('status')).toContainText('Membresía guardada.', { timeout: 10_000 });
  await addMember(page, credentials.accounts.reader.email, 'Consulta');
  const viewerRoleB = page.getByLabel(`Permiso de ${credentials.accounts.reader.email}`);
  await expect(viewerRoleB).toHaveValue('VIEWER');
  const fileInputB = page.getByLabel('Seleccionar archivos PDF');
  await fileInputB.setInputFiles([{ name: 'sprint151-e2e-one.pdf', mimeType: 'application/pdf', buffer: pdf }]);
  await expect(page.getByRole('status').filter({ hasText: '1 archivo(s) procesado(s).' })).toBeVisible({ timeout: 60_000 });
  await expect(workspaceSelect).toHaveValue(workspaceBId);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  // A one-workspace editor opens directly into that space and has no membership controls.
  await login(page, credentials.accounts.reviewer);
  await page.goto('/spaces');
  await expect(page.getByRole('heading', { name: nameA })).toBeVisible();
  await expect(page.getByText('Tu espacio asignado se abrió automáticamente.')).toBeVisible();
  await expect(page.getByText('Tu rol: Editor')).toBeVisible();
  await expect(page.getByLabel('Seleccionar archivos PDF')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Miembros y permisos' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  // Viewer can search/open/download B, sees no editing actions and cannot open A by guessed URL.
  await login(page, credentials.accounts.reader);
  await page.goto('/spaces');
  await expect(page.getByRole('heading', { name: nameB })).toBeVisible();
  await expect(page.getByText('Tu rol: Consulta')).toBeVisible();
  await expect(page.getByLabel('Seleccionar archivos PDF')).toHaveCount(0);
  await expect(page.getByLabel('Nueva carpeta')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Miembros y permisos' })).toHaveCount(0);
  await page.getByLabel('Buscar documentos privados').fill('JORGE');
  await page.getByLabel('Buscar documentos privados').locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.locator('[aria-label="Resultados por contenido"]').getByRole('link', { name: /sprint151-e2e-one\.pdf/iu })).toBeVisible({ timeout: 60_000 });
  const hrefB = await page.locator('[aria-label="Resultados por contenido"]').getByRole('link', { name: /sprint151-e2e-one\.pdf/iu }).getAttribute('href');
  const documentIdB = hrefB?.match(/\/documents\/([^?]+)/u)?.[1];
  expect(documentIdB).toBeTruthy();
  await page.goto(`/spaces/${workspaceBId}/documents/${documentIdB}`);
  await expect(page.locator('.react-pdf__Page')).toBeVisible({ timeout: 60_000 });
  const viewerDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar PDF' }).click();
  expect((await viewerDownload).suggestedFilename()).toBe('sprint151-e2e-one.pdf');

  const documentIdA = documentPath?.match(/\/documents\/([^?]+)/u)?.[1];
  expect(documentIdA).toBeTruthy();
  const deniedWorkspaceResponses: number[] = [];
  page.on('response', (response) => {
    if (response.url().includes(`/api/workspaces/${workspaceAId}/documents/${documentIdA}`))
      deniedWorkspaceResponses.push(response.status());
  });
  await page.goto(`/spaces/${workspaceAId}/documents/${documentIdA}`);
  await expect(page.locator('p[role="alert"]')).toHaveText('El espacio o documento ya no está disponible para tu cuenta.', { timeout: 30_000 });
  await expect(page.locator('.react-pdf__Page')).toHaveCount(0);
  expect(deniedWorkspaceResponses).toHaveLength(2);
  expect(deniedWorkspaceResponses.every((status) => status === 404)).toBe(true);
  expect(browserErrors).toEqual([]);
});

test('usuario con dos espacios autorizados cambia de ámbito sin mezclar nombres', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  await login(page, credentials.accounts.operator);
  await page.goto('/spaces');
  const selector = page.getByLabel('Espacio documental');
  await expect(selector).toBeVisible();
  await expect(selector.locator('option').filter({ hasText: nameA })).toHaveCount(1);
  await expect(selector.locator('option').filter({ hasText: nameB })).toHaveCount(1);
  await selector.selectOption(await workspaceOptionValue(page, nameA));
  await expect(page.getByText(`Buscando en: ${nameA}`)).toBeVisible();
  await selector.selectOption(await workspaceOptionValue(page, nameB));
  await expect(page.getByText(`Buscando en: ${nameB}`)).toBeVisible();
  await expect(page.getByRole('heading', { name: nameB })).toBeVisible();
});

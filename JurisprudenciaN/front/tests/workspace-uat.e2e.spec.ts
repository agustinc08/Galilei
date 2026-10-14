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
  const createdResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/api/workspaces'),
  );
  await page.getByRole('button', { name: 'Crear espacio', exact: true }).click();
  const created = await (await createdResponse).json() as { id: string };
  await expect(page.getByText('Espacio creado. Ya figurás como administrador de esta dependencia.')).toBeVisible();
  return created.id;
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
  const outputDir = resolve(process.cwd(), '../../_recovery-work/sprint153/screenshots');
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
  await expect(page.getByRole('heading', { name: 'No tenés un espacio asignado' })).toBeVisible();
  await expect(page.getByText('Los documentos privados sólo aparecen dentro de un espacio al que tenés acceso.')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  // Galilei ADMIN creates the two synthetic workspaces and manages the first.
  await login(page, credentials.accounts.admin);
  await page.goto('/spaces/manage');
  await expect(page.getByText('Administración global', { exact: true })).toBeVisible();
  const workspaceAId = await createSpace(page, codeA, nameA, 'SALA');
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceAId)}`);
  await expect(page.getByRole('heading', { name: nameA })).toBeVisible();

  const workspaceBId = await createSpace(page, codeB, nameB, 'JUZGADO');
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceBId)}`);
  const workspaceSelect = page.getByLabel('Espacio documental');
  await expect(workspaceSelect).toBeVisible();
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
  const fileInput = page.getByLabel('Seleccionar archivos PDF o TXT');
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
  await expect(page.locator('[aria-label="Resultados por contenido y nombre"]').getByRole('button', { name: /Vista previa de sprint151-e2e-one\.pdf/iu })).toBeVisible({ timeout: 60_000 });

  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceAId)}`);
  await page.getByLabel('Buscar documentos privados').fill('sprint151-e2e-one');
  await page.getByLabel('Buscar documentos privados').locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Coincidencias por nombre/iu })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Alcance de carpeta para la búsqueda').selectOption('CURRENT');
  await page.getByLabel('Buscar documentos privados').locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByText(/Buscando en:.*Actuaciones 2026/iu)).toBeVisible();
  await expect(page.getByLabel('Buscar documentos privados').locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true })).toBeEnabled({ timeout: 60_000 });

  // Classic Copernic workspace: real manual-source filtering, persistent preview and keyboard navigation.
  await page.goto(`/spaces?workspaceId=${encodeURIComponent(workspaceAId)}`);
  await expect(page.getByRole('main', { name: 'Búsqueda y resultados' }).getByText(nameA, { exact: false }).first()).toBeVisible();
  const classicSearch = page.getByLabel('Buscar documentos privados');
  const performanceMs: Record<string, number> = {};
  await classicSearch.fill('JORGE');
  const searchStartedAt = Date.now();
  const searchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/api/workspaces/${workspaceAId}/search`)
      && url.searchParams.get('q') === 'JORGE';
  });
  await page.getByRole('search').getByRole('button', { name: 'Buscar', exact: true }).click();
  await searchResponse;
  performanceMs.searchRequest = Date.now() - searchStartedAt;
  const classicResults = page.locator('[aria-label="Resultados por contenido y nombre"]');
  const firstClassicResult = classicResults.getByRole('button', { name: /Vista previa de sprint151-e2e-one\.pdf/iu });
  const renderStartedAt = Date.now();
  await expect(firstClassicResult).toBeVisible({ timeout: 60_000 });
  performanceMs.firstResultRender = Date.now() - renderStartedAt;

  const manualSourceRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith(`/workspaces/${workspaceAId}/search`))
      manualSourceRequests.push(url.searchParams.get('sourceId') ?? '');
  });
  await page.getByRole('button', { name: /Carga manual/iu }).click();
  await expect.poll(() => manualSourceRequests.includes('__manual_upload__')).toBe(true);
  await expect(firstClassicResult).toBeVisible({ timeout: 60_000 });
  await expect(classicResults.locator('article').first()).toContainText('Fuente: Carga manual');
  const pdfFilterResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/api/workspaces/${workspaceAId}/search`)
      && url.searchParams.get('type') === 'PDF'
      && url.searchParams.get('sourceId') === '__manual_upload__';
  });
  await page.getByLabel('Filtrar por tipo').selectOption('PDF');
  const filteredSearchResponse = await pdfFilterResponse;
  expect(filteredSearchResponse.status()).toBe(200);
  const previewStartedAt = Date.now();
  await firstClassicResult.click();
  await expect(page.locator('.react-pdf__Page')).toBeVisible({ timeout: 60_000 });
  performanceMs.previewFirstPaint = Date.now() - previewStartedAt;
  await expect(page.getByText('Página 2 de 2')).toBeVisible();
  const pageChangeStartedAt = Date.now();
  await page.getByRole('button', { name: 'Página anterior' }).click();
  await expect(page.getByText('Página 1 de 2')).toBeVisible();
  performanceMs.pageStateChange = Date.now() - pageChangeStartedAt;
  await page.getByRole('button', { name: 'Página siguiente' }).click();
  await expect(page.getByText('Página 2 de 2')).toBeVisible();
  const matchIndicator = page.getByText(/Coincidencia \d+ de \d+/u).last();
  await expect(matchIndicator).toContainText(/Coincidencia \d+ de \d+/u);

  await page.keyboard.press('Escape');
  await expect(page.getByText('Seleccioná un resultado para ver una vista previa.')).toBeVisible();
  await classicSearch.focus();
  await page.keyboard.press('ArrowDown');
  await expect(firstClassicResult).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(firstClassicResult).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(page.locator('.react-pdf__Page')).toBeVisible({ timeout: 60_000 });
  const beforeF3 = await matchIndicator.textContent();
  const totalMatches = Number(beforeF3?.match(/de (\d+)/u)?.[1] ?? 0);
  const matchNavigationStartedAt = Date.now();
  await page.keyboard.press('F3');
  if (totalMatches > 1) await expect(matchIndicator).toContainText('Coincidencia 2 de');
  else await expect(matchIndicator).toContainText('Coincidencia 1 de 1');
  performanceMs.matchNavigation = Date.now() - matchNavigationStartedAt;
  await page.keyboard.press('Shift+F3');
  await expect(matchIndicator).toContainText('Coincidencia 1 de');

  await mkdirSync(outputDir, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.getByRole('heading', { name: 'Buscar documentos' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(outputDir, 'copernic-1366x768.png'), fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(outputDir, 'copernic-1920x1080.png'), fullPage: true });

  await page.getByRole('link', { name: 'Abrir completo', exact: true }).click();
  await expect(page.getByRole('link', { name: '← Volver al espacio' })).toBeVisible();
  await page.getByRole('link', { name: '← Volver al espacio' }).click();
  await expect(page).toHaveURL(/sourceId=__manual_upload__/u);
  await expect(page).toHaveURL(/type=PDF/u);
  await expect(page).toHaveURL(new RegExp(`selected=[^&]+`, 'u'));
  await expect(page.getByLabel('Buscar documentos privados')).toHaveValue('JORGE');
  await expect(page.locator('.react-pdf__Page')).toBeVisible({ timeout: 60_000 });

  // PHRASE is represented and highlighted as the exact adjacent text span.
  await classicSearch.fill('"JORGE PORCEL"');
  const phraseResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/api/workspaces/${workspaceAId}/search`)
      && url.searchParams.get('q') === '"JORGE PORCEL"'
      && url.searchParams.get('type') === 'PDF';
  });
  await page.getByRole('search').getByRole('button', { name: 'Buscar', exact: true }).click();
  expect((await phraseResponse).status()).toBe(200);
  await expect(firstClassicResult).toBeVisible({ timeout: 60_000 });
  await firstClassicResult.click();
  await expect(page.locator('.react-pdf__Page')).toBeVisible({ timeout: 60_000 });
  const phraseMarks = page.locator('.bjc-pdf-match-current');
  await expect(phraseMarks.first()).toBeVisible({ timeout: 30_000 });
  const phraseHighlight = (await phraseMarks.allTextContents()).join('').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('es');
  expect(phraseHighlight).toBe('jorge porcel');

  // The date and type constraints are sent to the API and survive URL state; this fixture's unknown date must not pass a date range.
  await page.getByLabel('Filtrar por fecha').selectOption('custom');
  await page.getByLabel('Fecha desde').fill('2025-01-01');
  const combinedFilterResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/api/workspaces/${workspaceAId}/search`)
      && url.searchParams.get('type') === 'PDF'
      && url.searchParams.get('dateFrom') === '2025-01-01'
      && url.searchParams.get('dateTo') === '2025-12-31'
      && url.searchParams.get('sourceId') === '__manual_upload__';
  });
  await page.getByLabel('Fecha hasta').fill('2025-12-31');
  const combinedResponse = await combinedFilterResponse;
  expect(combinedResponse.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'No hay resultados con estos filtros.' })).toBeVisible({ timeout: 30_000 });

  // The admin sees and changes only workspace assignments; the shared search remains available.
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceAId)}`);
  await expect(workspaceSelect).toBeVisible();
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
  const fileInputB = page.getByLabel('Seleccionar archivos PDF o TXT');
  await fileInputB.setInputFiles([{ name: 'sprint151-e2e-one.pdf', mimeType: 'application/pdf', buffer: pdf }]);
  await expect(page.getByRole('status').filter({ hasText: '1 archivo(s) procesado(s).' })).toBeVisible({ timeout: 60_000 });
  await expect(workspaceSelect).toHaveValue(workspaceBId);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  // A one-workspace editor opens directly into that space and has no membership controls.
  await login(page, credentials.accounts.reviewer);
  await page.goto('/spaces/manage');
  await expect(page.getByRole('heading', { name: nameA })).toBeVisible();
  await expect(page.getByText('Tu espacio asignado se abrió automáticamente.')).toBeVisible();
  await expect(page.getByText('Tu rol: Editor')).toBeVisible();
  await expect(page.getByLabel('Seleccionar archivos PDF o TXT')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Miembros y permisos' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  // Viewer can search/open/download B, sees no editing actions and cannot open A by guessed URL.
  await login(page, credentials.accounts.reader);
  await page.goto('/spaces/manage');
  await expect(page.getByRole('heading', { name: nameB })).toBeVisible();
  await expect(page.getByText('Tu rol: Consulta')).toBeVisible();
  await expect(page.getByLabel('Seleccionar archivos PDF o TXT')).toHaveCount(0);
  await expect(page.getByLabel('Nueva carpeta')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Miembros y permisos' })).toHaveCount(0);
  await page.getByLabel('Buscar documentos privados').fill('JORGE');
  await page.getByLabel('Buscar documentos privados').locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true }).click();
  const readerContentResults = page.locator('[aria-label="Resultados por contenido"]');
  const readerDocumentLink = readerContentResults.getByRole('link', { name: /sprint151-e2e-one\.pdf/iu });
  await expect(readerDocumentLink).toBeVisible({ timeout: 60_000 });
  const readerDocumentHref = await readerDocumentLink.getAttribute('href');
  const documentIdB = readerDocumentHref?.match(/\/documents\/([^?]+)/u)?.[1];
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
  const expectedNotFoundErrors: string[] = browserErrors.filter(
    (error) => error === 'Failed to load resource: net::ERR_FILE_NOT_FOUND',
  );
  expect(expectedNotFoundErrors.length).toBeLessThanOrEqual(deniedWorkspaceResponses.length);
  expect(browserErrors.filter((error) => !expectedNotFoundErrors.includes(error))).toEqual([]);
  console.log(`SPRINT153_PERFORMANCE_MS=${JSON.stringify(performanceMs)}`);
});

test('usuario con dos espacios autorizados cambia de ámbito sin mezclar nombres', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  await login(page, credentials.accounts.operator);
  await page.goto('/spaces/manage');
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

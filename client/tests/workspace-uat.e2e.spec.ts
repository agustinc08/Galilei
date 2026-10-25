import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';
import { getE2eArtifactPath, loadE2eCredentials } from './qa-credentials';

test.describe.configure({ mode: 'serial' });

const credentials = loadE2eCredentials();
const apiBase = `http://127.0.0.1:${process.env.BJC_PLAYWRIGHT_BACKEND_PORT ?? '4001'}/api`;
const pdf = readFileSync(resolve(process.cwd(), '../server/scripts/dev/fixtures/corpus/fallo-fixture.pdf'));
const ocrPdf = readFileSync(resolve(process.cwd(), '../server/src/corpus/fixtures/sprint154a1-ten-pages.pdf'));
const legacyDoc = readFileSync(resolve(process.cwd(), '../server/src/corpus/fixtures/sprint154a1-golden.doc'));
const runId = `${Date.now()}`;
const artifactDir = getE2eArtifactPath('workspace-uat');
const formatMarker = `sprint154aui${runId}`;
const ocrMarker = 'OCRTESTTOKENXYZ';
const rtf = Buffer.from(`{\\rtf1\\ansi ${formatMarker} responsabilidad civil y daño moral}`, 'ascii');
const codeA = `S151UIE2E_A_${runId}`;
const codeB = `S151UIE2E_B_${runId}`;
const nameA = `Sala UAT privada A ${runId}`;
const nameB = `Juzgado UAT privado B ${runId}`;
const workspaceManifestPath = resolve(artifactDir, 'workspace-uat-created.json');
const frontendPerformancePath = resolve(artifactDir, 'frontend-performance.json');
const responsiveMatrixPath = resolve(artifactDir, 'responsive-matrix.json');
const sprint156ScreenshotDir = resolve(artifactDir, 'screenshots');
const createdWorkspaces: Array<{ id: string; code: string }> = [];

async function deactivatePreviousWorkspaceFixtures() {
  const api = await playwrightRequest.newContext();
  try {
    const loginResponse = await api.post(`${apiBase}/auth/login`, {
      data: credentials.accounts.admin,
    });
    expect(loginResponse.ok(), 'QA admin authentication failed before workspace fixture cleanup').toBeTruthy();
    const token = (await loginResponse.json()).accessToken as string;
    const headers = { Authorization: `Bearer ${token}` };
    const workspacesResponse = await api.get(`${apiBase}/workspaces/admin/list`, { headers });
    expect(workspacesResponse.ok(), 'Could not list QA workspaces before fixture cleanup').toBeTruthy();
    const workspaces = await workspacesResponse.json() as Array<{ id: string; code: string; active: boolean }>;
    const fixtures = workspaces.filter((workspace) => /^S151UIE2E_[AB]_[0-9]+$/u.test(workspace.code));
    for (const workspace of fixtures) {
      if (!workspace.active) continue;
      const response = await api.patch(`${apiBase}/workspaces/admin/${workspace.id}/active`, {
        headers,
        data: { active: false },
      });
      expect(response.ok(), `Could not deactivate an isolated prior QA workspace (${workspace.code})`).toBeTruthy();
    }
  } finally {
    await api.dispose();
  }
}

test.beforeAll(async () => {
  await deactivatePreviousWorkspaceFixtures();
});

test.afterAll(async () => {
  await deactivatePreviousWorkspaceFixtures();
});

function saveWorkspaceManifest() {
  mkdirSync(dirname(workspaceManifestPath), { recursive: true });
  writeFileSync(workspaceManifestPath, JSON.stringify({ runId, workspaces: createdWorkspaces }, null, 2));
}

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
  const option = page.getByLabel('Dependencia', { exact: true }).locator('option').filter({ hasText: name });
  const value = await option.getAttribute('value');
  expect(value).toBeTruthy();
  return value!;
}

test('perfiles sintéticos de DEV completan los flujos privados principales desde la interfaz', async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(10_000);
  mkdirSync(sprint156ScreenshotDir, { recursive: true });
  const outputDir = sprint156ScreenshotDir;
  mkdirSync(outputDir, { recursive: true });
  const browserErrors: string[] = [];
  const viewerErrors: string[] = [];
  const viewerNetwork: Array<Record<string, string | number | boolean | null>> = [];
  let captureViewerDiagnostics = false;
  page.on('pageerror', (error) => {
    browserErrors.push(error.message);
    if (captureViewerDiagnostics) viewerErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon|websocket|404 \(Not Found\)/iu.test(message.text())) {
      browserErrors.push(message.text());
      if (captureViewerDiagnostics) viewerErrors.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
    if (!captureViewerDiagnostics) return;
    const url = request.url();
    if (/\/file(?:\?|$)|pdfjs|worker|\.mjs(?:\?|$)|\.wasm(?:\?|$)/iu.test(url)) {
      viewerNetwork.push({
        kind: 'request-failed',
        method: request.method(),
        url: (() => { try { return new URL(url).pathname; } catch { return url.split('?')[0]; } })(),
        error: request.failure()?.errorText ?? null,
      });
    }
  });
  page.on('response', (response) => {
    if (!captureViewerDiagnostics) return;
    const url = response.url();
    if (!/\/file(?:\?|$)|pdfjs|worker|\.mjs(?:\?|$)|\.wasm(?:\?|$)/iu.test(url)) return;
    void response.allHeaders().then((headers) => {
      viewerNetwork.push({
        kind: 'response',
        method: response.request().method(),
        url: (() => { try { return new URL(url).pathname; } catch { return url.split('?')[0]; } })(),
        status: response.status(),
        contentType: headers['content-type'] ?? null,
        contentLength: headers['content-length'] ?? null,
        contentRange: headers['content-range'] ?? null,
        acceptRanges: headers['accept-ranges'] ?? null,
      });
    });
  });

  // The seeded acceptance reader begins without any private membership.
  await login(page, credentials.accounts.workspaceCleanReader);
  await page.goto('/spaces');
  await expect(page.getByRole('heading', { name: 'Todavía no tenés una dependencia asignada' })).toBeVisible();
  await expect(page.getByText('Cuando te den acceso, acá vas a encontrar los documentos de tu Sala o Juzgado.')).toBeVisible();
  await page.screenshot({ path: resolve(outputDir, 'empty-state.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  // Galilei ADMIN creates the two synthetic workspaces and manages the first.
  await login(page, credentials.accounts.admin);
  await page.goto('/spaces/manage');
  await expect(page.getByText('Administración global', { exact: true })).toBeVisible();
  const workspaceAId = await createSpace(page, codeA, nameA, 'SALA');
  createdWorkspaces.push({ id: workspaceAId, code: codeA });
  saveWorkspaceManifest();
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceAId)}`);
  await expect(page.getByRole('heading', { name: nameA, exact: true })).toBeVisible();

  const workspaceBId = await createSpace(page, codeB, nameB, 'JUZGADO');
  createdWorkspaces.push({ id: workspaceBId, code: codeB });
  saveWorkspaceManifest();
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceBId)}`);
  const workspaceSelect = page.getByLabel('Dependencia', { exact: true });
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
  await addMember(page, credentials.accounts.workspaceSingleEditor.email, 'Editor');
  await expect(page.getByLabel(`Permiso de ${credentials.accounts.workspaceSingleEditor.email}`)).toHaveValue('EDITOR');

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
  await folderNameInput.fill('Modelos');
  await page.getByRole('button', { name: 'Crear subcarpeta', exact: true }).click();
  await expect(page.getByRole('button', { name: /Renombrar Modelos/ })).toBeVisible();

  // Per-file status and continuation across one, five and twenty documents.
  const fileInput = page.getByLabel('Seleccionar documentos PDF, TXT, RTF, DOC, DOCX u ODT');
  await expect(page.getByRole('heading', { name: 'Subir documentos' })).toBeVisible();
  await expect(page.getByText(/DOC legado se procesa localmente/u)).toBeVisible();
  await page.screenshot({ path: resolve(outputDir, 'upload-access.png'), fullPage: true });
  await fileInput.setInputFiles([{ name: 'sprint151-e2e-one.pdf', mimeType: 'application/pdf', buffer: pdf }]);
  await expect(page.getByRole('status').filter({ hasText: '1 archivo(s) procesado(s).' })).toBeVisible({ timeout: 60_000 });

  await fileInput.setInputFiles([
    { name: 'archivo-corrupto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-archivo-corrupto') },
    { name: 'sprint151-e2e-continue.pdf', mimeType: 'application/pdf', buffer: pdf },
  ]);
  await expect(page.getByText(/archivo-corrupto\.pdf.*Error/iu)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/sprint151-e2e-continue\.pdf.*Ya estaba cargado/iu)).toBeVisible();

  await fileInput.setInputFiles(Array.from({ length: 5 }, (_, index) => ({
    name: `sprint151-e2e-five-${index + 1}.pdf`, mimeType: 'application/pdf', buffer: pdf,
  })));
  await expect(page.getByRole('status').filter({ hasText: '5 archivo(s) procesado(s).' })).toBeVisible({ timeout: 60_000 });
  await fileInput.setInputFiles(Array.from({ length: 20 }, (_, index) => ({
    name: `sprint151-e2e-twenty-${index + 1}.pdf`, mimeType: 'application/pdf', buffer: pdf,
  })));
  await expect(page.getByRole('status').filter({ hasText: '20 archivo(s) procesado(s).' })).toBeVisible({ timeout: 120_000 });
  await fileInput.setInputFiles([
    { name: 'sprint154a-e2e-note.rtf', mimeType: 'application/rtf', buffer: rtf },
  ]);
  await expect(page.getByRole('status').filter({ hasText: '1 archivo(s) procesado(s).' })).toBeVisible({ timeout: 60_000 });
  const uploadedRtf = page.locator('article').filter({ hasText: 'sprint154a-e2e-note.rtf' });
  await expect(uploadedRtf).toContainText('Listo para buscar');
  await fileInput.setInputFiles([
    { name: 'sprint154a1-e2e-legacy.doc', mimeType: 'application/msword', buffer: legacyDoc },
  ]);
  await expect(page.getByRole('status').filter({ hasText: '1 archivo(s) procesado(s).' })).toBeVisible({ timeout: 120_000 });
  const uploadedDoc = page.locator('article').filter({ hasText: 'sprint154a1-e2e-legacy.doc' });
  await expect(uploadedDoc).toContainText('Listo para buscar');
  await fileInput.setInputFiles([
    { name: 'sprint154a1-e2e-ocr-ten-pages.pdf', mimeType: 'application/pdf', buffer: ocrPdf },
  ]);
  await expect(page.getByRole('status').filter({ hasText: '1 archivo(s) procesado(s).' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('article').filter({ hasText: 'sprint154a1-e2e-ocr-ten-pages.pdf' })).toContainText('Procesando documento…');
  await page.screenshot({ path: resolve(outputDir, 'processing.png'), fullPage: true });
  const authToken = await page.evaluate(() => localStorage.getItem('jurisprudencia_token'));
  if (!authToken) throw new Error('EXPECTED_AUTH_TOKEN');
  const healthDuringOcr = await page.request.get(`${apiBase}/health`);
  expect(healthDuringOcr.ok()).toBe(true);
  const searchDuringOcr = await page.request.get(`${apiBase}/workspaces/${workspaceAId}/search`, {
    headers: { Authorization: `Bearer ${authToken}` },
    params: { q: ocrMarker, page: '1', pageSize: '20' },
  });
  expect(searchDuringOcr.ok()).toBe(true);
  const searchBeforeOcrFinishes = await searchDuringOcr.json() as { total?: number };
  expect(searchBeforeOcrFinishes.total ?? 0).toBe(0);
  let ocrIndexed = false;
  for (let attempt = 0; attempt < 90 && !ocrIndexed; attempt += 1) {
    const response = await page.request.get(`${apiBase}/workspaces/${workspaceAId}/search`, {
      headers: { Authorization: `Bearer ${authToken}` },
      params: { q: ocrMarker, page: '1', pageSize: '20' },
    });
    expect(response.ok()).toBe(true);
    const body = await response.json() as { total?: number };
    ocrIndexed = (body.total ?? 0) > 0;
    if (!ocrIndexed) await page.waitForTimeout(1_000);
  }
  expect(ocrIndexed).toBe(true);

  await page.getByLabel('Buscar documentos de la dependencia').fill('JORGE');
  await page.getByLabel('Buscar documentos de la dependencia').locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true }).click();
  const contentResults = page.locator('[aria-label="Resultados por contenido"]');
  await expect(contentResults.getByRole('link', { name: /sprint151-e2e-one\.pdf/iu })).toBeVisible({ timeout: 60_000 });
  const documentLink = contentResults.getByRole('link', { name: /sprint151-e2e-one\.pdf/iu });
  const documentPath = await documentLink.getAttribute('href');
  expect(documentPath).toBeTruthy();
  captureViewerDiagnostics = true;
  await documentLink.click();
  await expect(page.getByRole('link', { name: '← Volver a los documentos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar PDF' })).toBeVisible();
  try {
    await expect(page.locator('.react-pdf__Page')).toBeVisible({ timeout: 60_000 });
  } catch (error) {
    const dom = await page.evaluate(() => {
      const root = document.querySelector('[class*="pdfDocument"]');
      return {
        url: location.pathname,
        pageClassCount: document.querySelectorAll('.react-pdf__Page').length,
        canvasCount: root?.querySelectorAll('canvas').length ?? 0,
        textLayerCount: root?.querySelectorAll('.react-pdf__Page__textContent').length ?? 0,
        text: root?.textContent?.trim().slice(0, 500) ?? null,
        canvasSizes: [...(root?.querySelectorAll('canvas') ?? [])].map((canvas) => ({ width: canvas.width, height: canvas.height })),
        workerScripts: [...document.scripts].map((script) => script.src).filter((src) => /pdfjs|worker/iu.test(src)),
        visibleText: [...document.querySelectorAll('p,[role="alert"],[role="status"]')]
          .filter((element) => (element as HTMLElement).offsetParent !== null)
          .map((element) => element.textContent?.trim()).filter(Boolean),
      };
    });
    console.log(`WORKSPACE_UAT_VIEWER_DIAGNOSTICS=${JSON.stringify({ dom, network: viewerNetwork, errors: viewerErrors })}`);
    await page.screenshot({ path: resolve(outputDir, 'workspace-viewer-failure.png'), fullPage: true });
    throw error;
  }
  captureViewerDiagnostics = false;
  const renderedCanvas = page.locator('.react-pdf__Page canvas');
  await expect(renderedCanvas).toBeVisible();
  const renderedContent = await renderedCanvas.evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0 || canvas.height === 0) {
      return { width: canvas instanceof HTMLCanvasElement ? canvas.width : 0, height: canvas instanceof HTMLCanvasElement ? canvas.height : 0, nonWhiteSamples: 0 };
    }
    const sample = document.createElement('canvas');
    sample.width = 64;
    sample.height = 64;
    const context = sample.getContext('2d');
    if (!context) return { width: canvas.width, height: canvas.height, nonWhiteSamples: 0 };
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let nonWhiteSamples = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245) nonWhiteSamples += 1;
    }
    return { width: canvas.width, height: canvas.height, nonWhiteSamples };
  });
  expect(renderedContent.width).toBeGreaterThan(0);
  expect(renderedContent.height).toBeGreaterThan(0);
  expect(renderedContent.nonWhiteSamples).toBeGreaterThan(0);
  const readerLogin = await page.request.post(`${apiBase}/auth/login`, { data: credentials.accounts.workspaceCleanReader });
  expect(readerLogin.ok()).toBe(true);
  const unauthorizedViewerToken = (await readerLogin.json() as { accessToken?: string }).accessToken;
  expect(unauthorizedViewerToken).toBeTruthy();
  const viewerDocumentId = new URL(documentPath!, 'http://127.0.0.1').pathname.split('/').at(-1) ?? '';
  const viewerTransferMatrix = await page.evaluate(async ({ workspaceId, documentId, readerToken, apiBaseUrl }) => {
    const token = localStorage.getItem('jurisprudencia_token');
    if (!token) throw new Error('EXPECTED_AUTH_TOKEN_FOR_VIEWER_MATRIX');
    const filePath = `${apiBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/documents/${encodeURIComponent(documentId)}/file`;
    const authorization = { Authorization: `Bearer ${token}` };
    const full = await fetch(filePath, { headers: authorization });
    const fullBytes = new Uint8Array(await full.arrayBuffer());
    const range = await fetch(filePath, { headers: { ...authorization, Range: 'bytes=0-4' } });
    const rangeBytes = new Uint8Array(await range.arrayBuffer());
    const unauthorized = await fetch(filePath, { headers: { Authorization: `Bearer ${readerToken}` } });
    const unauthorizedRange = await fetch(filePath, { headers: { Authorization: `Bearer ${readerToken}`, Range: 'bytes=0-4' } });
    const missing = await fetch(`${filePath.replace(encodeURIComponent(documentId), 'cm00000000000000000000000')}`, { headers: authorization });
    const missingBody = await missing.text();
    return {
      full: {
        status: full.status,
        contentType: full.headers.get('content-type'),
        bytes: fullBytes.byteLength,
        pdfSignature: new TextDecoder().decode(fullBytes.subarray(0, 5)) === '%PDF-',
      },
      range: {
        status: range.status,
        contentType: range.headers.get('content-type'),
        acceptRanges: range.headers.get('accept-ranges'),
        contentRange: range.headers.get('content-range'),
        contentLength: range.headers.get('content-length'),
        bytes: rangeBytes.byteLength,
        pdfSignature: new TextDecoder().decode(rangeBytes.subarray(0, 5)) === '%PDF-',
      },
      unauthorized: unauthorized.status,
      unauthorizedRange: unauthorizedRange.status,
      missing: missing.status,
      missingLeaksPath: /[A-Z]:\\|pgdata|127\.0\.0\.1/iu.test(missingBody),
    };
  }, {
    workspaceId: workspaceAId,
    documentId: viewerDocumentId,
    readerToken: unauthorizedViewerToken!,
    apiBaseUrl: apiBase,
  });
  const anonymousFileResponse = await page.request.get(`${apiBase}/workspaces/${workspaceAId}/documents/${viewerDocumentId}/file`);
  expect(viewerTransferMatrix.full.status).toBe(200);
  expect(viewerTransferMatrix.full.contentType).toContain('application/pdf');
  expect(viewerTransferMatrix.full.bytes).toBeGreaterThan(5);
  expect(viewerTransferMatrix.full.pdfSignature).toBe(true);
  expect(viewerTransferMatrix.range.status).toBe(206);
  expect(viewerTransferMatrix.range.acceptRanges).toBe('bytes');
  expect(viewerTransferMatrix.range.contentRange).toMatch(/^bytes 0-4\//u);
  expect(viewerTransferMatrix.range.contentLength).toBe('5');
  expect(viewerTransferMatrix.range.bytes).toBe(5);
  expect(viewerTransferMatrix.range.pdfSignature).toBe(true);
  expect(anonymousFileResponse.status()).toBe(401);
  expect(viewerTransferMatrix.unauthorized).toBe(404);
  expect(viewerTransferMatrix.unauthorizedRange).toBe(404);
  expect(viewerTransferMatrix.missing).toBe(404);
  expect(viewerTransferMatrix.missingLeaksPath).toBe(false);
  console.log(`WORKSPACE_UAT_VIEWER_PASS=${JSON.stringify({ network: viewerNetwork, renderedContent, transferMatrix: viewerTransferMatrix })}`);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar PDF' }).click();
  expect((await download).suggestedFilename()).toBe('sprint151-e2e-one.pdf');
  await page.getByRole('link', { name: '← Volver a los documentos' }).click();
  await expect(page.getByLabel('Buscar documentos de la dependencia')).toHaveValue('JORGE');
  await expect(page.locator('[aria-label="Resultados por contenido y nombre"]').getByRole('button', { name: /Vista previa de sprint151-e2e-one\.pdf/iu })).toBeVisible({ timeout: 60_000 });

  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceAId)}`);
  await page.getByLabel('Buscar documentos de la dependencia').fill('sprint151-e2e-one');
  await page.getByLabel('Buscar documentos de la dependencia').locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Coincidencias por nombre/iu })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Alcance de carpeta para la búsqueda').selectOption('CURRENT');
  await page.getByLabel('Buscar documentos de la dependencia').locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByText(/Buscando en:.*Actuaciones 2026/iu)).toBeVisible();
  await expect(page.getByLabel('Buscar documentos de la dependencia').locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true })).toBeEnabled({ timeout: 60_000 });

  // Classic Copernic workspace: real manual-source filtering, persistent preview and keyboard navigation.
  const frontendPerformanceMs: Record<string, number> = {};
  const initialAreaStartedAt = Date.now();
  await page.goto(`/spaces?workspaceId=${encodeURIComponent(workspaceAId)}`);
  await expect(page.getByRole('main', { name: 'Búsqueda y resultados' }).getByText(nameA, { exact: false }).first()).toBeVisible();
  frontendPerformanceMs.privateAreaReady = Date.now() - initialAreaStartedAt;
  const classicSearch = page.getByLabel('Buscar documentos de la dependencia');
  const classicSearchButton = classicSearch.locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true });
  const ocrUiSearchEvents: Array<Record<string, string | number>> = [];
  const ocrSearchPath = `/api/workspaces/${workspaceAId}/search`;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === ocrSearchPath && url.searchParams.get('q') === ocrMarker) {
      ocrUiSearchEvents.push({ kind: 'request', method: request.method(), url: `${url.pathname}${url.search}` });
    }
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname === ocrSearchPath && url.searchParams.get('q') === ocrMarker) {
      ocrUiSearchEvents.push({ kind: 'response', status: response.status(), url: `${url.pathname}${url.search}` });
    }
  });
  await classicSearch.fill(ocrMarker);
  const ocrResult = page.locator('[aria-label="Resultados por contenido y nombre"]').getByRole('button', { name: /Vista previa de sprint154a1-e2e-ocr-ten-pages\.pdf/iu });
  const ocrSearchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/api/workspaces/${workspaceAId}/search`) && url.searchParams.get('q') === ocrMarker;
  }, { timeout: 60_000 });
  await classicSearchButton.click();
  try {
    expect((await ocrSearchResponse).ok()).toBe(true);
  } catch (error) {
    const uiState = await page.evaluate(() => ({
      url: location.pathname + location.search,
      searchButtonDisabled: [...document.querySelectorAll('form[role="search"] button[type="submit"]')].map((button) => (button as HTMLButtonElement).disabled),
      visibleStatus: [...document.querySelectorAll('[role="status"],[role="alert"]')].map((element) => element.textContent?.trim()).filter(Boolean),
    }));
    console.log(`WORKSPACE_UAT_OCR_SEARCH_DIAGNOSTICS=${JSON.stringify({ events: ocrUiSearchEvents, uiState, errors: browserErrors })}`);
    throw error;
  }
  await expect(ocrResult).toBeVisible({ timeout: 30_000 });
  const folderTree = page.getByRole('tree', { name: `Carpetas de ${nameA}` });
  await expect(folderTree).toBeVisible();
  const parentFolder = folderTree.getByRole('treeitem', { name: /Actuaciones 2026/iu });
  await expect(parentFolder).toHaveAttribute('aria-level', '1');
  await page.getByRole('button', { name: 'Contraer Actuaciones 2026' }).click();
  await expect(folderTree.getByRole('treeitem', { name: /Modelos/iu })).toHaveCount(0);
  await page.getByRole('button', { name: 'Expandir Actuaciones 2026' }).click();
  await expect(folderTree.getByRole('treeitem', { name: /Modelos/iu })).toHaveAttribute('aria-level', '2');
  await ocrResult.click();
  await expect(page.locator('.react-pdf__Page')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Texto reconocido automáticamente\. La navegación está disponible; el resaltado visual no está disponible para texto reconocido\./u)).toBeVisible();
  await expect(page.locator('.bjc-pdf-match-current, .bjc-pdf-match')).toHaveCount(0);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: resolve(outputDir, 'viewer-ocr-context.png'), fullPage: true });
  const ocrMatchIndicator = page.locator('span[aria-live="polite"]').filter({ hasText: /Coincidencia \d+ de \d+/u });
  await expect(ocrMatchIndicator).toContainText('Coincidencia 1 de 10');
  await page.getByText(/Texto reconocido automáticamente\. La navegación/u).click();
  await page.keyboard.press('F3');
  await expect(ocrMatchIndicator).toContainText('Coincidencia 2 de 10');
  await expect(page.getByText('Página 2 de 10')).toBeVisible();
  await page.keyboard.press('Shift+F3');
  await expect(ocrMatchIndicator).toContainText('Coincidencia 1 de 10');
  await expect(page.getByText('Página 1 de 10')).toBeVisible();
  await expect(page.locator('.bjc-pdf-match-current, .bjc-pdf-match')).toHaveCount(0);
  await classicSearch.fill('JORGE');
  const searchResponseWithTimeout = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/api/workspaces/${workspaceAId}/search`)
      && url.searchParams.get('q') === 'JORGE';
  }, { timeout: 60_000 });
  await page.getByRole('search').getByRole('button', { name: 'Buscar', exact: true }).click();
  expect((await searchResponseWithTimeout).ok()).toBe(true);
  const classicResults = page.locator('[aria-label="Resultados por contenido y nombre"]');
  const firstClassicResult = classicResults.getByRole('button', { name: /Vista previa de sprint151-e2e-one\.pdf/iu });
  const renderStartedAt = Date.now();
  await expect(firstClassicResult).toBeVisible({ timeout: 60_000 });
  frontendPerformanceMs.resultRenderAfterResponse = Date.now() - renderStartedAt;

  const manualSourceRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith(`/workspaces/${workspaceAId}/search`))
      manualSourceRequests.push(url.searchParams.get('sourceId') ?? '');
  });
  await page.getByRole('button', { name: /Documentos cargados/iu }).click();
  await expect.poll(() => manualSourceRequests.includes('__manual_upload__')).toBe(true);
  expect(await page.locator('body').innerText()).not.toContain('Carga manual');
  await expect(firstClassicResult).toBeVisible({ timeout: 60_000 });
  await expect(firstClassicResult).toContainText('Carpeta compartida: Documentos cargados');
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
  frontendPerformanceMs.previewReadyAfterSelection = Date.now() - previewStartedAt;
  await expect(page.getByText('Página 2 de 2')).toBeVisible();
  const pageChangeStartedAt = Date.now();
  await page.getByRole('button', { name: 'Página anterior' }).click();
  await expect(page.getByText('Página 1 de 2')).toBeVisible();
  frontendPerformanceMs.previewPageChange = Date.now() - pageChangeStartedAt;
  await page.getByRole('button', { name: 'Página siguiente' }).click();
  await expect(page.getByText('Página 2 de 2')).toBeVisible();
  const matchIndicator = page.getByText(/Coincidencia \d+ de \d+/u).last();
  await expect(matchIndicator).toContainText(/Coincidencia \d+ de \d+/u);

  await page.keyboard.press('Escape');
  await expect(page.getByText('Seleccioná un documento para verlo acá.')).toBeVisible();
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
  frontendPerformanceMs.matchNavigation = Date.now() - matchNavigationStartedAt;
  await page.keyboard.press('Shift+F3');
  await expect(matchIndicator).toContainText('Coincidencia 1 de');

  const panelInteractionStartedAt = Date.now();
  await page.getByRole('button', { name: 'Colapsar panel izquierdo' }).click();
  await expect(page.getByRole('button', { name: 'Expandir panel izquierdo' })).toBeVisible();
  frontendPerformanceMs.folderPanelCollapse = Date.now() - panelInteractionStartedAt;
  await page.getByRole('button', { name: 'Expandir panel izquierdo' }).click();
  await expect(page.getByRole('button', { name: 'Colapsar panel izquierdo' })).toBeVisible();

  await mkdirSync(outputDir, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.getByRole('heading', { name: nameA, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(outputDir, 'three-pane-1366.png'), fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(outputDir, 'three-pane-1920.png'), fullPage: true });
  const viewportMatrix: Array<Record<string, number | string | boolean>> = [];
  for (const [width, height] of [[1366, 768], [1440, 900], [1536, 864], [1600, 900], [1920, 1080], [1920, 1200], [2560, 1440]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const panelWidth = (selector: string) => Math.round(document.querySelector(selector)?.getBoundingClientRect().width ?? 0);
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        pageScrollWidth: document.documentElement.scrollWidth,
        leftPanelWidth: panelWidth('[class*="leftPanel"]'),
        resultPanelWidth: panelWidth('[class*="centerPanel"]'),
        previewPanelWidth: panelWidth('[class*="previewPanel"]'),
      };
    });
    expect(layout.pageScrollWidth).toBeLessThanOrEqual(width);
    expect(layout.leftPanelWidth).toBeGreaterThan(0);
    expect(layout.resultPanelWidth).toBeGreaterThan(0);
    expect(layout.previewPanelWidth).toBeGreaterThan(0);
    viewportMatrix.push({ ...layout, horizontalOverflow: layout.pageScrollWidth - width });
  }
  writeFileSync(responsiveMatrixPath, JSON.stringify({ viewports: viewportMatrix }, null, 2));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await folderTree.getByRole('treeitem', { name: /Actuaciones 2026/iu }).click();
  await expect(page).toHaveURL(/folderId=/u);
  await page.screenshot({ path: resolve(outputDir, 'shared-folder.png'), fullPage: true });
  await page.getByRole('complementary', { name: `Carpetas de ${nameA}` })
    .getByRole('button', { name: /Documentos cargados/u }).click();
  await firstClassicResult.click();
  await expect(page.locator('.react-pdf__Page')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('link', { name: 'Abrir completo', exact: true }).click();
  await expect(page.getByRole('link', { name: '← Volver a los documentos' })).toBeVisible();
  await page.getByRole('link', { name: '← Volver a los documentos' }).click();
  await expect(page).toHaveURL(/sourceId=__manual_upload__/u);
  await expect(page).toHaveURL(/type=PDF/u);
  await expect(page).toHaveURL(new RegExp(`selected=[^&]+`, 'u'));
  await expect(page.getByLabel('Buscar documentos de la dependencia')).toHaveValue('JORGE');
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
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: resolve(outputDir, 'viewer-native-highlight.png'), fullPage: true });
  const phraseHighlight = (await phraseMarks.allTextContents()).join('').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('es');
  expect(phraseHighlight).toBe('jorge porcel');

  // RTF uses the generic textual preview, exact extracted-text highlight and protected original download.
  await classicSearch.fill(formatMarker);
  const rtfSearchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/api/workspaces/${workspaceAId}/search`)
      && url.searchParams.get('q') === formatMarker
      && url.searchParams.get('type') === 'RTF';
  });
  await page.getByLabel('Filtrar por tipo').selectOption('RTF');
  await page.getByRole('search').getByRole('button', { name: 'Buscar', exact: true }).click();
  expect((await rtfSearchResponse).status()).toBe(200);
  const rtfResult = classicResults.getByRole('button', { name: /Vista previa de sprint154a-e2e-note\.rtf/iu });
  await expect(rtfResult).toBeVisible({ timeout: 60_000 });
  await rtfResult.click();
  const rtfPreview = page.locator('pre[aria-label="Vista previa del texto extraído"]');
  await expect(rtfPreview).toContainText(formatMarker);
  await expect(rtfPreview.locator('mark').first()).toContainText(formatMarker);
  await page.screenshot({ path: resolve(outputDir, 'viewer-text-preview.png'), fullPage: true });
  const rtfMatchIndicator = page.getByText(/Coincidencia \d+ de \d+/u).last();
  await page.keyboard.press('F3');
  await expect(rtfMatchIndicator).toContainText('Coincidencia 1 de 1');
  await page.keyboard.press('Shift+F3');
  await expect(rtfMatchIndicator).toContainText('Coincidencia 1 de 1');
  await page.getByRole('link', { name: 'Abrir completo', exact: true }).click();
  await expect(page.locator('pre[aria-label="Texto extraído del documento"]')).toContainText(formatMarker);
  const rtfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar RTF' }).click();
  expect((await rtfDownload).suggestedFilename()).toBe('sprint154a-e2e-note.rtf');
  await page.getByRole('link', { name: '← Volver a los documentos' }).click();
  await expect(page).toHaveURL(/type=RTF/u);

  // Legacy OLE DOC is searchable, previewable and downloadable without Word automation.
  const docQueries = ['12345/2026', '12345', '2026'];
  const legacyDocFilename = 'sprint154a1-e2e-legacy.doc';
  let docQuery = '';
  await expect.poll(async () => {
    for (const query of docQueries) {
      const response = await page.request.get(
        `${apiBase}/workspaces/${workspaceAId}/search`,
        {
          headers: { Authorization: `Bearer ${authToken}` },
          params: { q: query, page: '1', pageSize: '20', type: 'DOC' },
        },
      );
      if (!response.ok()) continue;
      const body = await response.json() as {
        results?: Array<{ metadata?: { filename?: string | null } }>;
      };
      if (body.results?.some((result) => result.metadata?.filename === legacyDocFilename)) {
        docQuery = query;
        return 1;
      }
    }
    return 0;
  }, { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] }).toBeGreaterThan(0);
  await classicSearch.fill(docQuery);
  const docSearchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/api/workspaces/${workspaceAId}/search`)
      && url.searchParams.get('q') === docQuery
      && url.searchParams.get('type') === 'DOC';
  });
  await page.getByLabel('Filtrar por tipo').selectOption('DOC');
  await page.getByRole('search').getByRole('button', { name: 'Buscar', exact: true }).click();
  expect((await docSearchResponse).status()).toBe(200);
  const docResult = classicResults.getByRole('button', { name: `Vista previa de ${legacyDocFilename}` });
  await expect(docResult).toBeVisible({ timeout: 60_000 });
  await docResult.click();
  const docPreview = page.locator('pre[aria-label="Vista previa del texto extraído"]');
  await expect(docPreview).toContainText(docQuery);
  await expect(docPreview.locator('mark').first()).toContainText(docQuery);
  const docMatchIndicator = page.getByText(/Coincidencia \d+ de \d+/u).last();
  await page.keyboard.press('F3');
  await expect(docMatchIndicator).toContainText(/Coincidencia \d+ de \d+/u);
  await page.keyboard.press('Shift+F3');
  await expect(docMatchIndicator).toContainText(/Coincidencia \d+ de \d+/u);
  await page.getByRole('link', { name: 'Abrir completo', exact: true }).click();
  await expect(page.locator('pre[aria-label="Texto extraído del documento"]')).toContainText(docQuery);
  const docDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar DOC' }).click();
  expect((await docDownload).suggestedFilename()).toBe('sprint154a1-e2e-legacy.doc');
  await page.getByRole('link', { name: '← Volver a los documentos' }).click();
  await expect(page).toHaveURL(/type=DOC/u);

  // The date and type constraints are sent to the API and survive URL state; this fixture's unknown date must not pass a date range.
  await classicSearch.fill('JORGE');
  const restorePdfFilterResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/api/workspaces/${workspaceAId}/search`)
      && url.searchParams.get('q') === 'JORGE'
      && url.searchParams.get('type') === 'PDF';
  });
  await page.getByLabel('Filtrar por tipo').selectOption('PDF');
  await page.getByRole('search').getByRole('button', { name: 'Buscar', exact: true }).click();
  expect((await restorePdfFilterResponse).status()).toBe(200);
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
  await expect(page.getByRole('heading', { name: 'No encontramos documentos con estos filtros.' })).toBeVisible({ timeout: 30_000 });

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
  await addMember(page, credentials.accounts.workspaceCleanReader.email, 'Consulta');
  const viewerRoleB = page.getByLabel(`Permiso de ${credentials.accounts.workspaceCleanReader.email}`);
  await expect(viewerRoleB).toHaveValue('VIEWER');
  const fileInputB = page.getByLabel('Seleccionar documentos PDF, TXT, RTF, DOC, DOCX u ODT');
  await fileInputB.setInputFiles([{ name: 'sprint151-e2e-one.pdf', mimeType: 'application/pdf', buffer: pdf }]);
  await expect(page.getByRole('status').filter({ hasText: '1 archivo(s) procesado(s).' })).toBeVisible({ timeout: 60_000 });
  await expect(workspaceSelect).toHaveValue(workspaceBId);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  // Use an account not assigned to the separate ACL E2E workspace; a one-workspace editor opens directly into A.
  await login(page, credentials.accounts.workspaceSingleEditor);
  await page.goto('/spaces');
  await expect(page.getByRole('heading', { name: nameA, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '¿Dónde querés trabajar?', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Cambiar dependencia')).toHaveCount(0);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: resolve(outputDir, 'single-workspace-1366.png'), fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: resolve(outputDir, 'single-workspace-1920.png'), fullPage: true });
  await page.goto('/spaces/manage');
  await expect(page.getByRole('heading', { name: nameA, exact: true })).toBeVisible();
  await expect(page.getByText('Tu dependencia se abrió automáticamente.')).toBeVisible();
  await expect(page.getByText('Tu acceso: Editor')).toBeVisible();
  await expect(page.getByLabel('Seleccionar documentos PDF, TXT, RTF, DOC, DOCX u ODT')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Miembros y permisos' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  // Viewer can search/open/download B, sees no editing actions and cannot open A by guessed URL.
  await login(page, credentials.accounts.workspaceCleanReader);
  await page.goto('/spaces/manage');
  await expect(page.getByRole('heading', { name: nameB, exact: true })).toBeVisible();
  await expect(page.getByText('Tu acceso: Consulta')).toBeVisible();
  await expect(page.getByLabel('Seleccionar documentos PDF, TXT, RTF, DOC, DOCX u ODT')).toHaveCount(0);
  await expect(page.getByLabel('Nueva carpeta')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Miembros y permisos' })).toHaveCount(0);
  const readerToken = await page.evaluate(() => localStorage.getItem('jurisprudencia_token'));
  expect(readerToken).toBeTruthy();
  await expect.poll(async () => {
    const response = await page.request.get(`${apiBase}/workspaces/${workspaceBId}/search`, {
      headers: { Authorization: `Bearer ${readerToken}` },
      params: { q: 'JORGE', page: '1', pageSize: '20' },
    });
    if (!response.ok()) return false;
    const body = await response.json() as {
      results?: Array<{ metadata?: { filename?: string | null } }>;
    };
    return body.results?.some((result) => result.metadata?.filename === 'sprint151-e2e-one.pdf') ?? false;
  }, { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] }).toBe(true);
  await page.getByLabel('Buscar documentos de la dependencia').fill('JORGE');
  await page.getByLabel('Buscar documentos de la dependencia').locator('xpath=..').getByRole('button', { name: 'Buscar', exact: true }).click();
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
  const deniedWorkspaceResponses: Array<{ pathname: string; status: number }> = [];
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    const documentPath = `/api/workspaces/${workspaceAId}/documents/${documentIdA}`;
    if (pathname === documentPath || pathname === `${documentPath}/file`)
      deniedWorkspaceResponses.push({ pathname, status: response.status() });
  });
  await page.goto(`/spaces/${workspaceAId}/documents/${documentIdA}`);
  await expect(page.locator('p[role="alert"]')).toHaveText('No encontramos este documento o no tenés acceso.', { timeout: 30_000 });
  await expect(page.locator('.react-pdf__Page')).toHaveCount(0);
  await expect(page.getByLabel('Buscar en el documento')).toHaveCount(0);
  await expect(page.getByText('Cargando documento…')).toHaveCount(0);
  await page.screenshot({ path: resolve(outputDir, 'permission-denied.png'), fullPage: true });
  const deniedMetadataPath = `/api/workspaces/${workspaceAId}/documents/${documentIdA}`;
  const deniedFilePath = `${deniedMetadataPath}/file`;
  expect(deniedWorkspaceResponses.length).toBeGreaterThanOrEqual(2);
  expect(deniedWorkspaceResponses.some((response) => response.pathname === deniedMetadataPath && response.status === 404)).toBe(true);
  expect(deniedWorkspaceResponses.some((response) => response.pathname === deniedFilePath && response.status === 404)).toBe(true);
  expect(deniedWorkspaceResponses.every((response) => response.status === 404)).toBe(true);
  const expectedNotFoundErrors: string[] = browserErrors.filter(
    (error) => error === 'Failed to load resource: net::ERR_FILE_NOT_FOUND',
  );
  expect(expectedNotFoundErrors.length).toBeLessThanOrEqual(deniedWorkspaceResponses.length);
  expect(browserErrors.filter((error) => !expectedNotFoundErrors.includes(error))).toEqual([]);
  writeFileSync(frontendPerformancePath, JSON.stringify({
    method: 'Browser-visible timing from navigation/action start to ready UI; Search request timings are excluded.',
    measurementsMs: frontendPerformanceMs,
    limitations: ['privateAreaReady includes membership and folder API responses', 'previewReadyAfterSelection includes document metadata/file/match requests', 'resultRenderAfterResponse starts after Search response so excludes Search network time'],
  }, null, 2));
  saveWorkspaceManifest();
});

test('usuario con dos espacios autorizados cambia de ámbito sin mezclar nombres', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  await login(page, credentials.accounts.operator);
  await page.goto('/spaces');
  await expect(page.getByRole('heading', { name: '¿Dónde querés trabajar?', exact: true })).toBeVisible();
  const choice = page.getByLabel('Elegir dependencia');
  await expect(choice.locator('option').filter({ hasText: nameA })).toHaveCount(1);
  await expect(choice.locator('option').filter({ hasText: nameB })).toHaveCount(1);
  const chooserText = await page.locator('body').innerText();
  expect(chooserText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu);
  await page.screenshot({ path: resolve(sprint156ScreenshotDir, 'multi-workspace-selector.png'), fullPage: true });
  const choiceAValue = await choice.locator('option').filter({ hasText: nameA }).getAttribute('value');
  expect(choiceAValue).toBeTruthy();
  await choice.selectOption(choiceAValue!);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: nameA, exact: true })).toBeVisible();
  await expect(page.getByRole('main', { name: 'Búsqueda y resultados' })).toContainText(nameA);
  await page.reload();
  await expect(page.getByRole('heading', { name: nameA, exact: true })).toBeVisible();

  await page.goto('/spaces/manage');
  const selector = page.getByLabel('Dependencia', { exact: true });
  await expect(selector).toBeVisible();
  await expect(selector.locator('option').filter({ hasText: nameA })).toHaveCount(1);
  await expect(selector.locator('option').filter({ hasText: nameB })).toHaveCount(1);
  await selector.selectOption(await workspaceOptionValue(page, nameA));
  await expect(page.getByText(`Buscando en: ${nameA}`)).toBeVisible();
  await selector.selectOption(await workspaceOptionValue(page, nameB));
  await expect(page.getByText(`Buscando en: ${nameB}`)).toBeVisible();
  await expect(page.getByRole('heading', { name: nameB, exact: true })).toBeVisible();
});

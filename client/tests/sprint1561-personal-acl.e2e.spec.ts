import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const credentials = JSON.parse(
  readFileSync(resolve(process.cwd(), '../_recovery-work/sprint10/acceptance/credentials.json'), 'utf8'),
) as { accounts: Record<string, { email: string; password: string }> };
const syntheticUsers = JSON.parse(
  readFileSync(resolve(process.cwd(), '../_recovery-work/sprint1561/e2e-users.json'), 'utf8'),
) as { runId: string; users: Array<{ id: number; nombre: string; email: string }> };
const backendPort = process.env.BJC_PLAYWRIGHT_BACKEND_PORT ?? '4001';
const apiBase = `http://127.0.0.1:${backendPort}/api`;
const runId = syntheticUsers.runId;
const nameA = `Sala E2E ${runId}`;
const nameB = `Juzgado E2E ${runId}`;
const codeA = `S1561E2E_A_${runId}`;
const codeB = `S1561E2E_B_${runId}`;
const uxRunRoot = resolve(process.cwd(), '../_recovery-work/ux-reconcile1/runs/authenticated');
const screenshots = resolve(uxRunRoot, 'screenshots');
const responsiveManifestPath = resolve(uxRunRoot, 'responsive-results.json');
const manifestPath = resolve(process.cwd(), '../_recovery-work/sprint1561/e2e-manifest.json');
const fixturePdf = readFileSync(resolve(process.cwd(), '../server/scripts/dev/fixtures/corpus/fallo-fixture.pdf'));

type E2EManifest = { workspaceIds: string[]; workspaceCodes: string[]; documentIds: string[]; folderIds: string[]; userIds: number[]; personalOwnerId?: number; personalFilenames?: string[] };

test('Sprint 15.6.1 personal, shared and restricted documents stay isolated through UI and routes', async ({ page, request }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(12_000);
  mkdirSync(screenshots, { recursive: true });
  mkdirSync(uxRunRoot, { recursive: true });
  const manifest: E2EManifest = {
    workspaceIds: [],
    workspaceCodes: [codeA, codeB],
    documentIds: [],
    folderIds: [],
    userIds: syntheticUsers.users.map((user) => user.id),
    personalFilenames: [],
  };
  const saveManifest = () => {
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  };

  const adminLogin = await request.post(`${apiBase}/auth/login`, { data: credentials.accounts.admin });
  expect(adminLogin.ok()).toBeTruthy();
  const adminToken = (await adminLogin.json()).accessToken as string;
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  async function createWorkspace(code: string, name: string, type: string) {
    const response = await request.post(`${apiBase}/workspaces`, {
      headers: adminHeaders,
      data: { code, name, type },
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json() as { id: string };
    manifest.workspaceIds.push(result.id);
    saveManifest();
    return result.id;
  }

  async function addByEmail(workspaceId: string, email: string, role: 'EDITOR' | 'VIEWER') {
    const candidatesResponse = await request.get(`${apiBase}/workspaces/${workspaceId}/membership-candidates`, {
      headers: adminHeaders,
      params: { q: email },
    });
    expect(candidatesResponse.ok()).toBeTruthy();
    const candidates = await candidatesResponse.json() as Array<{ id: number; email: string }>;
    const candidate = candidates.find((item) => item.email.toLowerCase() === email.toLowerCase());
    expect(candidate, `active account candidate ${email}`).toBeTruthy();
    const response = await request.post(`${apiBase}/workspaces/${workspaceId}/members`, {
      headers: adminHeaders,
      data: { userId: candidate!.id, role },
    });
    expect(response.ok()).toBeTruthy();
    return candidate!.id;
  }

  async function addSyntheticMember(workspaceId: string, userId: number) {
    const response = await request.post(`${apiBase}/workspaces/${workspaceId}/members`, {
      headers: adminHeaders,
      data: { userId, role: 'VIEWER' },
    });
    expect(response.ok()).toBeTruthy();
  }

  async function createFolder(workspaceId: string, data: Record<string, unknown>) {
    const response = await request.post(`${apiBase}/workspaces/${workspaceId}/folders`, {
      headers: adminHeaders,
      data,
    });
    expect(response.ok()).toBeTruthy();
    const folder = await response.json() as { id: string };
    manifest.folderIds.push(folder.id);
    saveManifest();
    return folder.id;
  }

  async function uploadText(workspaceId: string, folderId: string, name: string, content: string) {
    const response = await request.post(`${apiBase}/workspaces/${workspaceId}/documents/upload`, {
      headers: adminHeaders,
      params: { folderId },
      multipart: { files: { name, mimeType: 'text/plain', buffer: Buffer.from(content, 'utf8') } },
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json() as { results: Array<{ documentId: string; status: string }> };
    expect(result.results[0]?.status).toBe('INDEXED');
    manifest.documentIds.push(result.results[0].documentId);
    saveManifest();
    return result.results[0].documentId;
  }

  const workspaceA = await createWorkspace(codeA, nameA, 'SALA');
  const workspaceB = await createWorkspace(codeB, nameB, 'JUZGADO');
  const operatorId = await addByEmail(workspaceA, credentials.accounts.operator.email, 'EDITOR');
  manifest.personalOwnerId = operatorId;
  saveManifest();
  await addByEmail(workspaceA, credentials.accounts.reviewer.email, 'VIEWER');
  await addByEmail(workspaceB, credentials.accounts.operator.email, 'VIEWER');
  for (const person of syntheticUsers.users) await addSyntheticMember(workspaceA, person.id);

  const sharedFolder = await createFolder(workspaceA, { name: `Compartida ${runId}`, visibilityScope: 'DEPENDENCY_SHARED' });
  await createFolder(workspaceA, { name: `Vacía ${runId}`, visibilityScope: 'DEPENDENCY_SHARED' });
  const restrictedFolder = await createFolder(workspaceA, {
    name: `Restringida ${runId}`,
    visibilityScope: 'RESTRICTED',
    userIds: [operatorId, ...syntheticUsers.users.map((person) => person.id)],
  });
  await createFolder(workspaceA, {
    name: `Restringida sin personas ${runId}`,
    visibilityScope: 'RESTRICTED',
    userIds: [],
  });
  const sharedToken = `SPRINT1561SHARED${runId}`;
  const restrictedToken = `SPRINT1561RESTRICTED${runId}`;
  const sharedName = `shared-${runId}.txt`;
  const restrictedName = `restricted-${runId}.txt`;
  const sharedDocumentId = await uploadText(workspaceA, sharedFolder, sharedName, `${sharedToken} acceso de dependencia`);
  const restrictedDocumentId = await uploadText(workspaceA, restrictedFolder, restrictedName, `${restrictedToken} acceso seleccionado`);
  const operatorLogin = await request.post(`${apiBase}/auth/login`, { data: credentials.accounts.operator });
  expect(operatorLogin.ok()).toBeTruthy();
  const operatorToken = (await operatorLogin.json()).accessToken as string;
  const operatorHeaders = { Authorization: `Bearer ${operatorToken}` };
  const reviewerLogin = await request.post(`${apiBase}/auth/login`, { data: credentials.accounts.reviewer });
  expect(reviewerLogin.ok()).toBeTruthy();
  const reviewerToken = (await reviewerLogin.json()).accessToken as string;
  const reviewerHeaders = { Authorization: `Bearer ${reviewerToken}` };
  const sharedNonMemberLogin = await request.post(`${apiBase}/auth/login`, { data: credentials.accounts.reader });
  expect(sharedNonMemberLogin.ok()).toBeTruthy();
  const sharedNonMemberToken = (await sharedNonMemberLogin.json()).accessToken as string;
  const sharedNonMemberHeaders = { Authorization: `Bearer ${sharedNonMemberToken}` };

  await expect.poll(async () => {
    const response = await request.get(`${apiBase}/workspaces/${workspaceA}/search`, {
      headers: operatorHeaders,
      params: { q: restrictedToken },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).results.map((item: { sourceId: string }) => item.sourceId);
  }, { timeout: 15_000 }).toContain(restrictedDocumentId);
  const restrictedSearchDenied = await request.get(`${apiBase}/workspaces/${workspaceA}/search`, {
    headers: reviewerHeaders,
    params: { q: restrictedToken },
  });
  expect(restrictedSearchDenied.ok()).toBeTruthy();
  expect((await restrictedSearchDenied.json()).total).toBe(0);
  await expect.poll(async () => {
    const response = await request.get(`${apiBase}/workspaces/${workspaceA}/search`, {
      headers: reviewerHeaders,
      params: { q: sharedToken },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).results.map((item: { sourceId: string }) => item.sourceId);
  }, { timeout: 15_000 }).toContain(sharedDocumentId);
  const authorizedMetadata = await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${restrictedDocumentId}`, { headers: operatorHeaders });
  expect(authorizedMetadata.ok()).toBeTruthy();
  expect((await authorizedMetadata.json()).file.href).toBe(`/api/workspaces/${workspaceA}/documents/${restrictedDocumentId}/file`);
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${restrictedDocumentId}/file`, { headers: operatorHeaders })).ok()).toBeTruthy();
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${sharedDocumentId}/file`, { headers: reviewerHeaders })).ok()).toBeTruthy();

  for (const suffix of ['', '/matches?q=' + encodeURIComponent(restrictedToken), '/file']) {
    const response = await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${restrictedDocumentId}${suffix}`, {
      headers: reviewerHeaders,
    });
    expect(response.status()).toBe(404);
  }
  const personalSearchLeak = await request.get(`${apiBase}/personal/search`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    params: { q: restrictedToken },
  });
  expect(personalSearchLeak.ok()).toBeTruthy();
  expect((await personalSearchLeak.json()).total).toBe(0);
  expect((await request.get(`${apiBase}/workspaces/${workspaceB}/documents/${restrictedDocumentId}`, { headers: operatorHeaders })).status()).toBe(404);

  // The UI proves that adding a member searches all active users, while the ACL
  // candidate endpoint remains limited to active members of this dependency.
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.admin.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.admin.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceA)}`);
  await expect(page.getByRole('heading', { name: nameA, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mi Sala / Juzgado' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Documentos privados de tus dependencias');
  await expect(page.locator('body')).toContainText('La visibilidad depende de las autorizaciones de cada carpeta.');
  const restrictedFolderButton = page.getByRole('button', { name: new RegExp(`Restringida ${runId}`) }).first();
  await expect(restrictedFolderButton).toBeVisible();
  await expect(restrictedFolderButton).toContainText('creador y administradores también acceden');
  await restrictedFolderButton.click();
  const restrictedContentsCard = page.getByRole('heading', { name: new RegExp(`Restringida ${runId}`) }).locator('xpath=ancestor::section[1]');
  await expect(restrictedContentsCard).toContainText(restrictedName);
  await restrictedContentsCard.screenshot({ path: resolve(screenshots, 'restricted-folder.png') });
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceA)}`);
  const accessDialogTrigger = page.getByRole('button', { name: new RegExp(`Administrar quién puede ver Restringida ${runId}`) });
  await accessDialogTrigger.click();
  const accessDialog = page.getByRole('dialog', { name: 'Personas autorizadas' });
  await expect(accessDialog).toBeVisible();
  expect(await accessDialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  await expect(page.getByLabel('Buscar integrantes')).toBeFocused();
  await expect(accessDialog.locator('input[type="checkbox"]')).toHaveCount(syntheticUsers.users.length + 1);
  for (const [width, height] of [[1366, 768], [390, 844], [430, 932]] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), `restricted dialog page overflow at ${width}x${height}`).toBe(true);
    const accessRect = await accessDialog.evaluate((element) => ({ width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right }));
    expect(accessRect.right).toBeLessThanOrEqual(width + 2);
    await accessDialog.screenshot({ path: resolve(screenshots, `restricted-user-selector__${width}x${height}.png`) });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.keyboard.press('Escape');
  await expect(accessDialog).toBeHidden();
  await expect(accessDialogTrigger).toBeFocused();

  const emptyAccessTrigger = page.getByRole('button', { name: new RegExp(`Administrar quién puede ver Restringida sin personas ${runId}`) });
  await emptyAccessTrigger.click();
  const emptyAccessDialog = page.getByRole('dialog', { name: 'Personas autorizadas' });
  await expect(emptyAccessDialog.getByText('Buscá integrantes activos por nombre o correo para agregarlos o quitarlos.')).toBeVisible();
  await emptyAccessDialog.getByLabel('Buscar integrantes').fill(`zqx-not-found-${runId}`);
  await emptyAccessDialog.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(emptyAccessDialog.getByText('No encontramos otros integrantes activos con ese nombre o correo.')).toBeVisible();
  await emptyAccessDialog.screenshot({ path: resolve(screenshots, 'restricted-no-matches.png') });
  await emptyAccessDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.reviewer.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.reviewer.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceA)}`);
  await page.getByRole('button', { name: new RegExp(`Vacía ${runId}`) }).click();
  await expect(page.getByText('Esta carpeta está vacía.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Podés subir archivos o mover documentos acá/u)).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.admin.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.admin.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceA)}`);

  // ACL changes propagate through the outbox; Search must reflect revocation
  // after projection sync. Viewer and file authorization checks remain live.
  await page.getByRole('button', { name: new RegExp(`Administrar quién puede ver Restringida ${runId}`) }).click();
  const revokeDialog = page.getByRole('dialog', { name: 'Personas autorizadas' });
  // Search resolves the selected person by account identity without exposing IDs.
  await expect(revokeDialog.getByText('Personas seleccionadas: ' + (syntheticUsers.users.length + 1))).toBeVisible();
  const searchInput = revokeDialog.getByLabel('Buscar integrantes');
  await searchInput.fill(credentials.accounts.operator.email);
  await revokeDialog.getByRole('button', { name: 'Buscar', exact: true }).click();
  const operatorPersonLabel = revokeDialog.locator('label').filter({ hasText: credentials.accounts.operator.email }).first();
  await expect(operatorPersonLabel).toBeVisible();
  await operatorPersonLabel.locator('input').uncheck();
  await revokeDialog.getByRole('button', { name: 'Guardar acceso' }).click();
  await expect(page.getByRole('status')).toContainText('lista de personas autorizadas quedó actualizada.');
  await expect.poll(async () => {
    const response = await request.get(apiBase + '/workspaces/' + workspaceA + '/search', {
      headers: operatorHeaders,
      params: { q: restrictedToken },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).total;
  }, { timeout: 15_000 }).toBe(0);
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${restrictedDocumentId}`, { headers: operatorHeaders })).status()).toBe(404);
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${restrictedDocumentId}/file`, { headers: operatorHeaders })).status()).toBe(404);
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${restrictedDocumentId}/matches`, { headers: operatorHeaders, params: { q: restrictedToken } })).status()).toBe(404);

  await page.getByRole('button', { name: new RegExp(`Administrar quién puede ver Restringida ${runId}`) }).click();
  const restoreDialog = page.getByRole('dialog', { name: 'Personas autorizadas' });
  await restoreDialog.getByLabel('Buscar integrantes').fill(credentials.accounts.operator.email);
  await restoreDialog.getByRole('button', { name: 'Buscar', exact: true }).click();
  const operatorCandidate = restoreDialog.locator('label').filter({ hasText: credentials.accounts.operator.email }).first();
  await expect(operatorCandidate).toBeVisible();
  await operatorCandidate.locator('input').check();
  await restoreDialog.getByRole('button', { name: 'Guardar acceso' }).click();
  await expect.poll(async () => {
    const response = await request.get(apiBase + '/workspaces/' + workspaceA + '/search', {
      headers: operatorHeaders,
      params: { q: restrictedToken },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).total;
  }, { timeout: 15_000 }).toBeGreaterThan(0);

  // A one-dependency reader enters directly, sees shared documents, and does
  // not learn the name of a restricted folder for which they have no grant.
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.reviewer.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.reviewer.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceA)}`);
  await expect(page.getByRole('heading', { name: 'Mi Sala / Juzgado' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Dependencia' })).toHaveCount(0);
  await expect(page.getByText('Tu dependencia se abrió automáticamente.')).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`Compartida ${runId}`) }).first().click();
  await expect(page.getByText(sharedName, { exact: false })).toBeVisible();
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceA)}`);
  await expect(page.getByRole('button', { name: new RegExp(`Restringida ${runId}`) })).toBeHidden();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.reader.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.reader.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceA)}`);
  await expect(page.getByRole('heading', { name: 'Todavía no tenés una dependencia asignada' })).toBeVisible();
  await expect(page.getByText(sharedName, { exact: false })).toHaveCount(0);
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/search`, { headers: sharedNonMemberHeaders, params: { q: sharedToken } })).status()).toBe(404);
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${sharedDocumentId}`, { headers: sharedNonMemberHeaders })).status()).toBe(404);
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${sharedDocumentId}/file`, { headers: sharedNonMemberHeaders })).status()).toBe(404);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.admin.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.admin.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();

  // Move broadening and narrowing both require an explicit UI confirmation.
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceA)}`);
  await page.getByRole('button', { name: new RegExp(`Restringida ${runId}`) }).first().click();
  const restrictedArticle = page.locator('article').filter({ hasText: restrictedName });
  await restrictedArticle.getByLabel(new RegExp(`Mover ${restrictedName} a carpeta`)).selectOption(sharedFolder);
  const broadenWarning = page.getByRole('alertdialog');
  await restrictedArticle.getByRole('button', { name: 'Mover', exact: true }).click();
  await expect(broadenWarning).toContainText('todos los integrantes autorizados');
  await broadenWarning.screenshot({ path: resolve(screenshots, 'access-change-warning.png') });
  await broadenWarning.getByRole('button', { name: 'Mover documento' }).click();
  await expect.poll(async () => {
    const response = await request.get(`${apiBase}/workspaces/${workspaceA}/search`, { headers: reviewerHeaders, params: { q: restrictedToken } });
    return (await response.json()).total;
  }).toBeGreaterThan(0);

  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceA)}`);
  await page.getByRole('button', { name: new RegExp(`Compartida ${runId}`) }).first().click();
  const sharedArticle = page.locator('article').filter({ hasText: restrictedName });
  await expect(sharedArticle).toBeVisible();
  await sharedArticle.getByLabel(new RegExp(`Mover ${restrictedName} a carpeta`)).selectOption(restrictedFolder);
  const narrowWarning = page.getByRole('alertdialog');
  await sharedArticle.getByRole('button', { name: 'Mover', exact: true }).click();
  await expect(narrowWarning).toContainText('sólo podrán verlo las personas autorizadas');
  await narrowWarning.getByRole('button', { name: 'Mover documento' }).click();
  await expect.poll(async () => {
    const response = await request.get(`${apiBase}/workspaces/${workspaceA}/search`, { headers: reviewerHeaders, params: { q: restrictedToken } });
    return (await response.json()).total;
  }).toBe(0);
  await expect.poll(async () => {
    const response = await request.get(`${apiBase}/workspaces/${workspaceA}/search`, { headers: operatorHeaders, params: { q: restrictedToken } });
    return (await response.json()).total;
  }).toBeGreaterThan(0);

  // The shared folder remains searchable to the dependency; capture the shared UX.
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceA)}`);
  await page.getByRole('button', { name: new RegExp(`Compartida ${runId}`) }).first().click();
  const sharedContentsCard = page.getByRole('heading', { name: new RegExp(`Compartida ${runId}`) }).locator('xpath=ancestor::section[1]');
  await expect(sharedContentsCard).toContainText(sharedName);
  const uploadSection = page.getByRole('heading', { name: 'Subir documentos' }).locator('xpath=ancestor::section[1]');
  await uploadSection.screenshot({ path: resolve(screenshots, 'upload-shared.png') });
  await sharedContentsCard.screenshot({ path: resolve(screenshots, 'shared-documents.png') });
  await expect(uploadSection).toContainText(`Compartido con las personas autorizadas de ${nameA}`);
  const uiUploadName = `ui-upload-${runId}.txt`;
  const uiUploadContent = Buffer.from(`COPERNIC FIX ${runId} archivo sintético para validar duplicados`, 'utf8');
  const uiUploadInput = page.getByLabel('Seleccionar documentos PDF, TXT, RTF, DOC, DOCX u ODT');
  const uploadResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`/api/workspaces/${workspaceA}/documents/upload`),
  );
  await uiUploadInput.setInputFiles({ name: uiUploadName, mimeType: 'text/plain', buffer: uiUploadContent });
  const firstUploadPayload = await (await uploadResponse).json() as { results: Array<{ documentId: string; status: string; duplicate: boolean }> };
  expect(firstUploadPayload.results[0]?.status).toBe('INDEXED');
  expect(firstUploadPayload.results[0]?.duplicate).toBe(false);
  manifest.documentIds.push(firstUploadPayload.results[0].documentId);
  saveManifest();
  await expect(page.getByText(uiUploadName, { exact: true }).first()).toBeVisible();

  const duplicateUploadResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`/api/workspaces/${workspaceA}/documents/upload`),
  );
  await uiUploadInput.setInputFiles({ name: uiUploadName, mimeType: 'text/plain', buffer: uiUploadContent });
  const duplicateUploadPayload = await (await duplicateUploadResponse).json() as { results: Array<{ documentId: string; status: string; duplicate: boolean }> };
  expect(duplicateUploadPayload.results[0]?.duplicate).toBe(true);
  await expect(page.getByText(/1 archivo\(s\) procesado\(s\)\. 1 ya existían en este espacio\./u)).toBeVisible();
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceA)}`);
  await page.getByRole('button', { name: new RegExp(`Restringida ${runId}`) }).first().click();
  await expect(page.getByRole('heading', { name: new RegExp(`Restringida ${runId}`) }).locator('xpath=ancestor::section[1]')).toContainText(restrictedName);
  await page.getByRole('heading', { name: 'Subir documentos' }).locator('xpath=ancestor::section[1]')
    .screenshot({ path: resolve(screenshots, 'upload-restricted.png') });

  // A workspace manager can move an eligible shared upload into their own
  // personal scope only after acknowledging that access becomes private.
  await page.goto(`/spaces/manage?workspaceId=${encodeURIComponent(workspaceA)}`);
  await page.getByRole('button', { name: new RegExp(`Compartida ${runId}`) }).first().click();
  const sharedDocumentArticle = page.locator('article').filter({ hasText: sharedName });
  await sharedDocumentArticle.getByRole('button', { name: 'Hacer personal' }).click();
  const personalMoveWarning = page.getByRole('alertdialog');
  await expect(personalMoveWarning).toContainText('Después de moverlo, sólo vos podrás verlo.');
  await personalMoveWarning.screenshot({ path: resolve(screenshots, 'access-change-warning-private.png') });
  await personalMoveWarning.getByRole('button', { name: 'Mover a Mis documentos' }).click();
  await expect.poll(async () => {
    const response = await request.get(`${apiBase}/workspaces/${workspaceA}/search`, { headers: reviewerHeaders, params: { q: sharedToken } });
    return (await response.json()).total;
  }).toBe(0);
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${sharedDocumentId}`, { headers: reviewerHeaders })).status()).toBe(404);
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${sharedDocumentId}/matches`, { headers: reviewerHeaders, params: { q: sharedToken } })).status()).toBe(404);
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${sharedDocumentId}/file`, { headers: reviewerHeaders })).status()).toBe(404);
  await expect.poll(async () => {
    const response = await request.get(apiBase + '/personal/search', {
      headers: adminHeaders,
      params: { q: sharedToken },
    });
    return (await response.json()).total;
  }, { timeout: 15_000 }).toBeGreaterThan(0);
  expect((await request.get(`${apiBase}/personal/documents/${sharedDocumentId}`, { headers: adminHeaders })).ok()).toBeTruthy();
  expect((await request.get(`${apiBase}/personal/documents/${sharedDocumentId}/file`, { headers: adminHeaders })).ok()).toBeTruthy();
  await expect.poll(async () => {
    const response = await request.get(apiBase + '/personal/search', {
      headers: operatorHeaders,
      params: { q: sharedToken },
    });
    return (await response.json()).total;
  }, { timeout: 15_000 }).toBe(0);

  // Personal documents remain global to the person while moving between two
  // dependencies and never enter the dependency or general search scopes.
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.operator.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.operator.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await page.goto(`/spaces?workspaceId=${encodeURIComponent(workspaceA)}`);
  await expect(page.getByText(nameA, { exact: false }).first()).toBeVisible();
  await page.goto(`/spaces?workspaceId=${encodeURIComponent(workspaceB)}`);
  await expect(page.getByText(nameB, { exact: false }).first()).toBeVisible();
  await page.goto('/personal');
  await expect(page.getByRole('heading', { name: 'Mis documentos' })).toBeVisible();
  await expect(page.getByText('Sólo vos podés verlos.')).toBeVisible();
  const personalToken = `SPRINT1561PERSONAL${runId}`;
  const personalName = `personal-${runId}.txt`;
  manifest.personalFilenames = [personalName];
  saveManifest();
  const personalBuffer = Buffer.from(`${personalToken} documento personal de prueba`, 'utf8');
  const pageFileInput = page.getByLabel('Elegí uno o más documentos');
  await expect(pageFileInput).toHaveAttribute('type', 'file');
  await pageFileInput.setInputFiles({ name: personalName, mimeType: 'text/plain', buffer: personalBuffer });
  await page.getByRole('heading', { name: 'Subir documento' }).locator('xpath=ancestor::section[1]')
    .screenshot({ path: resolve(screenshots, 'upload-private.png') });
  await page.getByRole('button', { name: 'Guardar en Mis documentos' }).click();
  await expect(page.getByRole('status')).toContainText('1 archivo(s) guardado(s)', { timeout: 30_000 });
  const personalPdfName = `personal-viewer-${runId}.pdf`;
  manifest.personalFilenames.push(personalPdfName);
  saveManifest();
  await pageFileInput.setInputFiles({ name: personalPdfName, mimeType: 'application/pdf', buffer: fixturePdf });
  await page.getByRole('button', { name: 'Guardar en Mis documentos' }).click();
  await expect(page.getByRole('status')).toContainText('1 archivo(s) guardado(s)', { timeout: 30_000 });
  const personalListResponse = await request.get(`${apiBase}/personal/documents`, { headers: operatorHeaders, params: { folderId: 'ROOT' } });
  expect(personalListResponse.ok()).toBeTruthy();
  const personalList = await personalListResponse.json() as Array<{ documentId: string; document: { file: { filename: string } | null } }>;
  const personalResult = personalList.find((item) => item.document.file?.filename === personalName);
  const personalPdfResult = personalList.find((item) => item.document.file?.filename === personalPdfName);
  expect(personalResult).toBeTruthy();
  expect(personalPdfResult).toBeTruthy();
  manifest.documentIds.push(personalResult!.documentId, personalPdfResult!.documentId);
  saveManifest();
  await expect.poll(async () => {
    const response = await request.get(apiBase + '/personal/search', {
      headers: operatorHeaders,
      params: { q: personalToken },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).total;
  }, { timeout: 15_000 }).toBeGreaterThan(0);
  expect((await request.get(`${apiBase}/personal/documents/${personalResult!.documentId}/matches`, { headers: operatorHeaders, params: { q: personalToken } })).ok()).toBeTruthy();
  const ownerPersonalFile = await request.get(`${apiBase}/personal/documents/${personalResult!.documentId}/file`, { headers: operatorHeaders });
  expect(ownerPersonalFile.ok()).toBeTruthy();
  expect(ownerPersonalFile.headers()['cache-control']).toContain('private, no-store');
  expect((await request.get(`${apiBase}/personal/documents/${personalResult!.documentId}`, { headers: operatorHeaders })).ok()).toBeTruthy();
  expect((await request.get(`${apiBase}/personal/search`, { headers: adminHeaders, params: { q: personalToken } }).then((response) => response.json())).total).toBe(0);
  expect((await request.get(`${apiBase}/personal/documents/${personalResult!.documentId}/file`, { headers: adminHeaders })).status()).toBe(404);
  expect((await request.get(`${apiBase}/personal/documents/${personalResult!.documentId}/matches`, { headers: adminHeaders, params: { q: personalToken } })).status()).toBe(404);
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/search`, { headers: operatorHeaders, params: { q: personalToken } }).then((response) => response.json())).total).toBe(0);

  const pdfRow = page.getByRole('listitem').filter({ hasText: personalPdfName });
  await pdfRow.getByRole('button', { name: 'Vista previa' }).click();
  await expect(page.locator('iframe[title^="Vista previa de"]')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Buscar en Mis documentos').fill(personalToken);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Resultados/ })).toBeVisible();
  await expect(page.getByText(personalName, { exact: false })).toBeVisible();
  const textRow = page.getByRole('listitem').filter({ hasText: personalName });
  const download = page.waitForEvent('download');
  await textRow.getByRole('button', { name: 'Descargar' }).click();
  expect((await download).suggestedFilename()).toBe(personalName);

  await textRow.getByRole('button', { name: 'Compartir con una dependencia' }).click();
  const shareWarning = page.getByRole('alertdialog', { name: 'Confirmar cambio de acceso' });
  await shareWarning.getByLabel('Compartir con').selectOption(workspaceA);
  await expect(shareWarning).toContainText(`los integrantes autorizados de ${nameA} podrán encontrarlo, verlo y descargarlo.`);
  await shareWarning.screenshot({ path: resolve(screenshots, 'access-change-warning.png') });
  await shareWarning.getByRole('button', { name: 'Compartir documento' }).click();
  await expect(page.getByRole('status')).toContainText(`El documento ahora está compartido con ${nameA}.`);
  await expect.poll(async () => {
    const response = await request.get(apiBase + '/personal/search', {
      headers: operatorHeaders,
      params: { q: personalToken },
    });
    return (await response.json()).total;
  }, { timeout: 15_000 }).toBe(0);
  await expect.poll(async () => {
    const response = await request.get(apiBase + '/workspaces/' + workspaceA + '/search', {
      headers: reviewerHeaders,
      params: { q: personalToken },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).results.map((item: { sourceId: string }) => item.sourceId);
  }, { timeout: 15_000 }).toContain(personalResult!.documentId);
  expect((await request.get(`${apiBase}/personal/documents/${personalResult!.documentId}`, { headers: operatorHeaders })).status()).toBe(404);
  expect((await request.get(`${apiBase}/personal/documents/${personalResult!.documentId}/file`, { headers: operatorHeaders })).status()).toBe(404);
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${personalResult!.documentId}`, { headers: reviewerHeaders })).ok()).toBeTruthy();
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${personalResult!.documentId}/matches`, { headers: reviewerHeaders, params: { q: personalToken } })).ok()).toBeTruthy();
  expect((await request.get(`${apiBase}/workspaces/${workspaceA}/documents/${personalResult!.documentId}/file`, { headers: reviewerHeaders })).ok()).toBeTruthy();

  const viewports = [
    [1366, 768], [1440, 900], [1536, 864], [1600, 900],
    [1920, 1080], [1920, 1200], [2560, 1440], [390, 844], [430, 932],
  ] as const;
  const responsiveResults: Array<Record<string, unknown>> = [];
  const browserDiagnostics = {
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
    httpFailures: [] as Array<{ url: string; status: number }>,
    requestFailures: [] as Array<{ url: string; error: string }>,
    expectedNavigationAborts: [] as Array<{ url: string; classification: string }>,
  };
  const onConsole = (message: import('@playwright/test').ConsoleMessage) => {
    if (message.type() === 'error') browserDiagnostics.consoleErrors.push(message.text());
  };
  const onPageError = (error: Error) => browserDiagnostics.pageErrors.push(error.message);
  const onResponse = (response: import('@playwright/test').Response) => {
    if (response.status() >= 400) browserDiagnostics.httpFailures.push({ url: response.url(), status: response.status() });
  };
  const onRequestFailed = (request: import('@playwright/test').Request) => {
    const error = request.failure()?.errorText ?? 'request failed';
    if (error === 'net::ERR_ABORTED' && new URL(request.url()).searchParams.has('_rsc')) {
      browserDiagnostics.expectedNavigationAborts.push({ url: request.url(), classification: 'NEXT_RSC_PREFETCH_CANCELLED_DURING_NAVIGATION' });
      return;
    }
    browserDiagnostics.requestFailures.push({ url: request.url(), error });
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  async function certifyResponsiveRoute(routeId: string, route: string, waitForReady: () => Promise<void>) {
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      const response = await page.goto(route);
      expect(response?.status(), `${routeId} HTTP status at ${width}x${height}`).toBe(200);
      await page.waitForLoadState('networkidle');
      await waitForReady();
      const layout = await page.evaluate(() => {
        const root = document.documentElement;
        const body = document.body;
        const verticalScroll = Array.from(document.querySelectorAll('*')).filter((element) => {
          if (element === root || element === body) return false;
          const style = getComputedStyle(element);
          if (!/(auto|scroll)/u.test(style.overflowY) || element.scrollHeight <= element.clientHeight + 2) return false;
          const classes = typeof element.className === 'string' ? element.className : '';
          return !/(sidebar|sidePanel|viewerFrameWrap|scrollArea|resultsScroll)/iu.test(classes)
            && !element.hasAttribute('data-ux-qa-allow-scroll');
        }).slice(0, 20).map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }));
        return {
          viewport: { width: innerWidth, height: innerHeight },
          clientWidth: root.clientWidth,
          scrollWidth: root.scrollWidth,
          bodyScrollHeight: body.scrollHeight,
          documentScrollHeight: root.scrollHeight,
          verticalScroll,
          mainCount: document.querySelectorAll('main').length,
          navCount: document.querySelectorAll('nav').length,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        };
      });
      expect(layout.scrollWidth, `${routeId} horizontal overflow at ${width}x${height}`).toBeLessThanOrEqual(layout.clientWidth + 2);
      expect(layout.verticalScroll, `${routeId} unexpected nested vertical scroll at ${width}x${height}`).toEqual([]);
      expect(layout.reducedMotion, `${routeId} reduced motion at ${width}x${height}`).toBe(true);
      expect(await page.locator('button').evaluateAll((buttons) => buttons
        .filter((button) => !(button.getAttribute('aria-label') || button.textContent || '').trim()).length), `${routeId} unnamed buttons`).toBe(0);
      const screenshotPath = resolve(screenshots, `${routeId}__${width}x${height}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled' });
      responsiveResults.push({ routeId, route, httpStatus: response?.status(), ...layout, screenshot: screenshotPath });
      writeFileSync(responsiveManifestPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), routes: responsiveResults }, null, 2)}\n`, 'utf8');
    }
  }

  await certifyResponsiveRoute('personal-owner', '/personal', async () => {
    await expect(page.getByRole('heading', { name: 'Mis documentos' })).toBeVisible();
    await expect(page.getByText('Sólo vos podés verlos.')).toBeVisible();
    await expect(page.getByText(personalPdfName, { exact: false })).toBeVisible();
  });
  await certifyResponsiveRoute('galilei', '/galilei', async () => {
    await expect(page.getByRole('heading', { name: '¿Qué querés consultar?' })).toBeVisible();
  });
  await certifyResponsiveRoute('spaces-manage-multi-dependency', `/spaces/manage?workspaceId=${encodeURIComponent(workspaceA)}`, async () => {
    await expect(page.getByRole('heading', { name: 'Mi Sala / Juzgado' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Dependencia' })).toBeVisible();
    const dependencySelector = page.getByRole('combobox', { name: 'Dependencia' });
    await expect(dependencySelector.getByRole('option', { name: nameA })).toBeAttached();
    await expect(dependencySelector.getByRole('option', { name: nameB })).toBeAttached();
  });
  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  page.off('response', onResponse);
  page.off('requestfailed', onRequestFailed);
  expect(browserDiagnostics.consoleErrors, 'authenticated responsive console errors').toEqual([]);
  expect(browserDiagnostics.pageErrors, 'authenticated responsive page errors').toEqual([]);
  expect(browserDiagnostics.httpFailures, 'authenticated responsive HTTP errors').toEqual([]);
  expect(browserDiagnostics.requestFailures, 'authenticated responsive network failures').toEqual([]);
  writeFileSync(resolve(uxRunRoot, 'browser-health.json'), `${JSON.stringify(browserDiagnostics, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(uxRunRoot, 'responsive-results.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), routes: responsiveResults }, null, 2)}\n`, 'utf8');
});

'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');
const { captureScenario, collectLayout } = require('../ux-qa/helpers.cjs');

function userFor(role) {
  return {
    id: 8902,
    nombre: 'Cuenta',
    apellido: 'Sintética',
    email: `${role.toLowerCase()}-sidebar-qa@example.invalid`,
    activo: true,
    rol: { id: role === 'ADMIN' ? 1 : 6, nombre: role },
  };
}

test('sidebar agrupa navegación por rol y reserva gestión según permisos @sidebar', async ({ page }, testInfo) => {
  let currentUser = userFor('LECTOR');
  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-sidebar-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, currentUser);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: currentUser }));
  await page.goto('/galilei');
  const mainNavigation = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(mainNavigation).toBeVisible();
  await expect(mainNavigation.getByText('TRABAJO', { exact: true })).toBeVisible();
  await expect(mainNavigation.getByRole('link', { name: /Jurisprudencia/u })).toBeVisible();
  await expect(mainNavigation.getByRole('link', { name: /Mi Sala \/ Juzgado/u })).toBeVisible();
  await expect(mainNavigation.getByRole('link', { name: /Mis documentos/u })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'CUENTA' })).toHaveCount(0);
  await expect(page.getByText('CUENTA', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Gestión' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Panel técnico', exact: true })).toHaveCount(0);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await collectLayout(page);
    expect(layout.horizontalOverflow.passes, `reader sidebar overflow at ${viewport.width}x${viewport.height}`).toBe(true);
    await captureScenario(page, testInfo, { id: `sidebar-reader-${viewport.width}x${viewport.height}`, route: '/galilei' });
  }

  currentUser = userFor('ADMIN');
  await page.evaluate((user) => localStorage.setItem('jurisprudencia_user', JSON.stringify(user)), currentUser);
  await page.reload();
  const management = page.getByRole('navigation', { name: 'Gestión' });
  await expect(management).toBeVisible();
  await expect(management.getByRole('link', { name: 'Panel técnico', exact: true })).toBeVisible();
  await expect(management.getByRole('link', { name: 'Registros', exact: true })).toBeVisible();
  await expect(management.getByRole('link', { name: 'Revisión de OCR', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1366, height: 768 });
  await captureScenario(page, testInfo, { id: 'sidebar-admin-1366x768', route: '/galilei' });

  currentUser = userFor('JURISPRUDENCIA');
  await page.evaluate((user) => localStorage.setItem('jurisprudencia_user', JSON.stringify(user)), currentUser);
  await page.reload();
  const editorialManagement = page.getByRole('navigation', { name: 'Gestión' });
  await expect(editorialManagement.getByRole('link', { name: 'Ingreso de jurisprudencia', exact: true })).toBeVisible();
  await expect(editorialManagement.getByRole('link', { name: 'Revisión de OCR', exact: true })).toBeVisible();
  await expect(editorialManagement.getByRole('link', { name: 'Panel técnico', exact: true })).toHaveCount(0);
  const diagnostics = page.__uxQaDiagnostics;
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.networkErrors).toEqual([]);
  expect(diagnostics.fixtureMisses).toEqual([]);
});

test('perfiles de Sala y Juzgado conservan navegación de trabajo sin herramientas administrativas @sidebar', async ({ page }) => {
  const reader = userFor('LECTOR');
  let currentWorkspace = { id: 'synthetic-sala-editor', type: 'SALA', role: 'EDITOR' };

  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-workspace-role-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, reader);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: reader }));
  await page.route('**/api/workspaces/mine', (route) => route.fulfill({ json: [{
    id: currentWorkspace.id,
    name: `${currentWorkspace.type === 'SALA' ? 'Sala' : 'Juzgado'} de QA`,
    code: `QA-${currentWorkspace.type}`,
    type: currentWorkspace.type,
    role: currentWorkspace.role,
  }] }));
  await page.route('**/api/workspaces/*/folders', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/workspaces/*/search/sources', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/workspaces/*/documents**', (route) => route.fulfill({ json: {
    page: 1,
    pageSize: 20,
    total: 1,
    results: [{
      createdAt: '2026-10-28T12:00:00.000Z',
      folder: null,
      document: {
        id: `synthetic-${currentWorkspace.id}-document`,
        title: 'Documento de QA',
        status: 'INDEXED',
        documentType: 'PDF',
        file: { filename: 'documento-qa.pdf', mimeType: 'application/pdf' },
      },
    }],
  } }));

  for (const scenario of [
    { id: 'sala-editor', type: 'SALA', role: 'EDITOR' },
    { id: 'sala-reader', type: 'SALA', role: 'VIEWER' },
    { id: 'juzgado-editor', type: 'JUZGADO', role: 'EDITOR' },
    { id: 'juzgado-reader', type: 'JUZGADO', role: 'VIEWER' },
  ]) {
    currentWorkspace = { id: `synthetic-${scenario.id}`, type: scenario.type, role: scenario.role };
    await page.goto(`/spaces?workspaceId=${currentWorkspace.id}`);

    const mainNavigation = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(mainNavigation.getByRole('link', { name: /Mi Sala \/ Juzgado/u })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Gestión' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Panel técnico', exact: true })).toHaveCount(0);
    await expect(page.getByText('CUENTA', { exact: true })).toBeVisible();
  }

  const diagnostics = page.__uxQaDiagnostics;
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.networkErrors).toEqual([]);
  expect(diagnostics.fixtureMisses).toEqual([]);
});

test('un workspace lista sus documentos al entrar sin consulta y pagina resultados accesibles @workspace-list', async ({ page }, testInfo) => {
  const reader = userFor('LECTOR');
  const workspaceId = 'synthetic-sala-workspace';
  const listRequests = [];
  let releaseFirstPage;
  const firstPageGate = new Promise((resolve) => { releaseFirstPage = resolve; });
  const allRows = Array.from({ length: 22 }, (_, index) => ({
    createdAt: `2026-10-${String(28 - Math.floor(index / 6)).padStart(2, '0')}T12:00:00.000Z`,
    folder: null,
    document: {
      id: `synthetic-workspace-document-${String(index + 1).padStart(2, '0')}`,
      title: `Documento de prueba ${String(index + 1).padStart(2, '0')}`,
      status: 'INDEXED',
      file: { filename: `fallo-${String(index + 1).padStart(2, '0')}.pdf`, mimeType: 'application/pdf' },
    },
  }));

  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-workspace-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, reader);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: reader }));
  await page.route('**/api/workspaces/mine', (route) => route.fulfill({ json: [{
    id: workspaceId,
    name: 'Sala QA de documentos',
    code: 'SALA-QA',
    type: 'SALA',
    role: 'VIEWER',
  }] }));
  await page.route(`**/api/workspaces/${workspaceId}/folders`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/workspaces/${workspaceId}/search/sources`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/workspaces/${workspaceId}/documents**`, async (route) => {
    const url = new URL(route.request().url());
    listRequests.push(url);
    const requestedPage = Number(url.searchParams.get('page') || 1);
    if (requestedPage === 1) await firstPageGate;
    const pageSize = Number(url.searchParams.get('pageSize') || 20);
    const results = allRows.slice((requestedPage - 1) * pageSize, requestedPage * pageSize);
    await route.fulfill({ json: { page: requestedPage, pageSize, total: allRows.length, results } });
  });

  try {
    await page.goto(`/spaces?workspaceId=${workspaceId}`);
    await expect.poll(() => listRequests.length).toBe(1);
    await expect(page.getByText('Cargando documentos…', { exact: true })).toBeVisible();
    await expect(page.getByText('Todavía no hay documentos.', { exact: true })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has('q')).toBe(false);
    releaseFirstPage();
    await expect(page.getByRole('button', { name: 'Vista previa de fallo-01.pdf' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Vista previa de fallo-20.pdf' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Vista previa de fallo-21.pdf' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Siguiente', exact: true })).toBeEnabled();
    expect(listRequests[0].searchParams.get('q')).toBeNull();
    expect(listRequests[0].searchParams.get('pageSize')).toBe('20');

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      const layout = await collectLayout(page);
      expect(layout.horizontalOverflow.passes, `workspace list overflow at ${viewport.width}x${viewport.height}`).toBe(true);
      await captureScenario(page, testInfo, { id: `workspace-list-${viewport.width}x${viewport.height}`, route: '/spaces' });
    }

    await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Vista previa de fallo-21.pdf' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Vista previa de fallo-22.pdf' })).toBeVisible();
    expect(listRequests).toHaveLength(2);
    expect(listRequests[1].searchParams.get('q')).toBeNull();
    expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  } finally {
    releaseFirstPage();
  }
  const diagnostics = page.__uxQaDiagnostics;
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.networkErrors).toEqual([]);
  expect(diagnostics.fixtureMisses).toEqual([]);
});

test('la lista inicial acepta el arreglo simple que devuelve Office instalado @workspace-list', async ({ page }, testInfo) => {
  const reader = userFor('LECTOR');
  const workspaceId = 'synthetic-office-legacy-workspace';
  const rows = Array.from({ length: 20 }, (_, index) => ({
    createdAt: `2026-10-28T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
    folder: null,
    document: {
      id: `synthetic-office-document-${String(index + 1).padStart(2, '0')}`,
      title: `Documento compartido ${String(index + 1).padStart(2, '0')}`,
      status: 'INDEXED',
      file: { filename: `fallo-office-${String(index + 1).padStart(2, '0')}.pdf`, mimeType: 'application/pdf' },
    },
  }));

  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-office-list-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, reader);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: reader }));
  await page.route('**/api/workspaces/mine', (route) => route.fulfill({ json: [{
    id: workspaceId,
    name: 'Sala QA Office',
    code: 'SALA-QA-OFFICE',
    type: 'SALA',
    role: 'VIEWER',
  }] }));
  await page.route(`**/api/workspaces/${workspaceId}/folders`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/workspaces/${workspaceId}/search/sources`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/workspaces/${workspaceId}/documents**`, (route) => route.fulfill({ json: rows }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/spaces?workspaceId=${workspaceId}`);
  await expect(page.getByText('20 documentos en esta página', { exact: true })).toBeVisible();
  await expect(page.getByText(/20 accesibles en Documentos compartidos/u)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vista previa de fallo-office-01.pdf' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vista previa de fallo-office-20.pdf' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Siguiente', exact: true })).toHaveCount(0);
  const layout = await collectLayout(page);
  expect(layout.horizontalOverflow.passes).toBe(true);
  await captureScenario(page, testInfo, { id: 'workspace-list-legacy-array-390x844', route: '/spaces' });
  const diagnostics = page.__uxQaDiagnostics;
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.networkErrors).toEqual([]);
  expect(diagnostics.fixtureMisses).toEqual([]);
});

test('el selector de dependencia presenta una elección clara y entra al workspace elegido @workspace-chooser @responsive', async ({ page }, testInfo) => {
  const reader = userFor('LECTOR');
  const juzgadoName = 'Juzgado Nacional de Primera Instancia en lo Civil N.º 42';
  const workspaces = [
    { id: 'synthetic-sala-chooser', name: 'Sala de Cámara Civil', code: 'SALA-CIVIL', type: 'SALA', role: 'VIEWER' },
    { id: 'synthetic-juzgado-chooser', name: juzgadoName, code: 'JUZGADO-4', type: 'JUZGADO', role: 'VIEWER' },
  ];
  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-workspace-chooser-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, reader);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: reader }));
  await page.route('**/api/workspaces/mine', (route) => route.fulfill({ json: workspaces }));
  await page.route('**/api/workspaces/*/folders', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/workspaces/*/search/sources', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/workspaces/*/documents**', (route) => route.fulfill({ json: {
    page: 1,
    pageSize: 20,
    total: 1,
    results: [{
      createdAt: '2026-10-28T12:00:00.000Z',
      folder: null,
      document: {
        id: 'synthetic-selected-workspace-document',
        title: 'Documento de dependencia seleccionada',
        status: 'INDEXED',
        documentType: 'PDF',
        file: { filename: 'documento-dependencia.pdf', mimeType: 'application/pdf' },
      },
    }],
  } }));

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/spaces');
  const chooser = page.locator('[class*="workspaceChooser"]');
  await expect(chooser.getByRole('heading', { name: '¿Dónde querés trabajar?' })).toBeVisible();
  await expect(chooser.getByRole('combobox', { name: 'Elegir dependencia' })).toBeVisible();
  const desktopBounds = await chooser.boundingBox();
  const shellBounds = await page.locator('[class*="shell"]').first().boundingBox();
  expect(desktopBounds).not.toBeNull();
  expect(shellBounds).not.toBeNull();
  expect(Math.abs((desktopBounds.x + desktopBounds.width / 2) - (shellBounds.x + shellBounds.width / 2))).toBeLessThan(2);
  await expect(chooser.getByRole('button', { name: 'Entrar' })).toBeDisabled();
  await captureScenario(page, testInfo, { id: 'workspace-chooser-desktop', route: '/spaces' });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await collectLayout(page);
  expect(mobileLayout.horizontalOverflow.passes).toBe(true);
  const mobileChooserBounds = await chooser.boundingBox();
  expect(mobileChooserBounds).not.toBeNull();
  expect(mobileChooserBounds.width).toBeLessThanOrEqual(390);
  await captureScenario(page, testInfo, { id: 'workspace-chooser-mobile', route: '/spaces' });

  await chooser.getByRole('combobox', { name: 'Elegir dependencia' }).selectOption('synthetic-juzgado-chooser');
  await expect(chooser.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  await chooser.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/workspaceId=synthetic-juzgado-chooser/u);
  await expect(page.getByRole('heading', { name: juzgadoName })).toBeVisible();
  const mobileProductTitle = page.getByRole('heading', { name: juzgadoName, exact: true });
  await expect(mobileProductTitle).toBeVisible();
  expect(await mobileProductTitle.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('normal');
  await expect(page.getByRole('button', { name: 'Vista previa de documento-dependencia.pdf' })).toBeVisible();
  await captureScenario(page, testInfo, { id: 'copernic-mobile-product-title', route: '/spaces' });

  const diagnostics = page.__uxQaDiagnostics;
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.networkErrors).toEqual([]);
  expect(diagnostics.fixtureMisses).toEqual([]);
});

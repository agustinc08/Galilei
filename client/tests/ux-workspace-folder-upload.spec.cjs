'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function folder(id, name, parentId = null) {
  return {
    id,
    name,
    parentId,
    visibilityScope: parentId ? 'INHERIT' : 'DEPENDENCY_SHARED',
    effectiveVisibilityScope: 'DEPENDENCY_SHARED',
    visibilityLabel: 'Compartida con la dependencia',
    canManageAccess: true,
    _count: { documents: 0, children: 0 },
  };
}

async function mountWorkspace(page, { role, type }) {
  const workspaceId = `workspace-folder-upload-${type.toLowerCase()}-${role.toLowerCase()}`;
  const workspace = {
    id: workspaceId,
    code: `QA-FOLDER-${type}`,
    name: type === 'SALA' ? 'Sala QA' : 'Juzgado QA',
    type,
    role,
  };
  const user = {
    id: 8913,
    nombre: 'Cuenta',
    apellido: 'QA Workspace',
    email: 'workspace-folder-upload@example.invalid',
    activo: true,
    rol: { id: 13, nombre: 'JURISPRUDENCIA', descripcion: null },
  };
  const folders = [folder('root-cases', 'Expedientes 2026')];
  const createdFolders = [];
  const uploads = [];
  const uploadedDocs = [];
  const publicCalls = [];
  const summaries = [];
  const uploadImportIds = [];
  const attempts = new Map();
  let activeUploads = 0;
  let maxActiveUploads = 0;

  await page.addInitScript((storedUser) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-workspace-folder-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(storedUser));
  }, user);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/public/')) {
      publicCalls.push({ method, pathname });
      return json(route, {});
    }
    if (pathname === '/api/auth/me') return json(route, user);
    if (pathname === '/api/workspaces/mine') return json(route, [workspace]);
    if (pathname === '/api/workspaces/admin/list') return json(route, []);
    if (pathname === `/api/workspaces/${workspaceId}/folders` && method === 'GET') {
      return json(route, folders);
    }
    if (pathname === `/api/workspaces/${workspaceId}/folders` && method === 'POST') {
      const body = request.postDataJSON();
      const created = folder(`created-${createdFolders.length + 1}`, body.name, body.parentId ?? null);
      folders.push(created);
      createdFolders.push({ ...body, id: created.id });
      return json(route, created);
    }
    if (pathname === `/api/workspaces/${workspaceId}/folder-uploads/summary` && method === 'POST') {
      summaries.push(request.postDataJSON());
      return json(route, { recorded: true });
    }
    if (pathname === `/api/workspaces/${workspaceId}/documents` && method === 'GET') {
      return json(route, []);
    }
    if (pathname === `/api/workspaces/${workspaceId}/documents/upload` && method === 'POST') {
      const raw = request.postDataBuffer()?.toString('latin1') ?? '';
      const filename = raw.match(/filename="([^"]+)"/iu)?.[1] ?? 'unknown';
      const importId = raw.match(/name="folderImportId"\r\n\r\n([^\r]+)/u)?.[1];
      if (importId) uploadImportIds.push(importId);
      uploads.push({ filename, folderId: new URL(request.url()).searchParams.get('folderId') });
      const count = (attempts.get(filename) ?? 0) + 1;
      attempts.set(filename, count);
      activeUploads += 1;
      maxActiveUploads = Math.max(maxActiveUploads, activeUploads);
      await new Promise((resolve) => setTimeout(resolve, 35));
      activeUploads -= 1;
      if (filename === 'falla.pdf' && count === 1) {
        return json(route, { results: [{ status: 'ERROR', duplicate: false, message: 'PDF inválido: falla.pdf' }] });
      }
      if (filename === 'repetido.pdf') {
        return json(route, { results: [{ status: 'INDEXED', duplicate: true }] });
      }
      const documentId = `document-${uploadedDocs.length + 1}`;
      uploadedDocs.push({ documentId, filename, folderId: new URL(request.url()).searchParams.get('folderId') });
      return json(route, { results: [{ documentId, status: 'INDEXED', duplicate: false }] });
    }
    if (pathname === `/api/workspaces/${workspaceId}/search`) {
      const query = new URL(request.url()).searchParams.get('q')?.toLowerCase() ?? '';
      const matches = uploadedDocs.filter((document) => document.filename.toLowerCase().includes(query));
      return json(route, {
        page: 1,
        pageSize: 20,
        total: matches.length,
        totalExact: true,
        hasMore: false,
        results: matches.map((document) => ({
          id: document.documentId,
          sourceId: document.documentId,
          title: document.filename,
          date: null,
          snippet: 'Contenido sintético privado de prueba.',
          metadata: { filename: document.filename, folderId: document.folderId, status: 'INDEXED' },
        })),
      });
    }
    if (pathname === `/api/workspaces/${workspaceId}/search/names`) {
      const query = new URL(request.url()).searchParams.get('q')?.toLowerCase() ?? '';
      const matches = uploadedDocs.filter((document) => document.filename.toLowerCase().includes(query));
      return json(route, {
        total: matches.length,
        totalExact: true,
        results: matches.map((document) => ({
          documentId: document.documentId,
          title: document.filename,
          filename: document.filename,
          status: 'INDEXED',
          uploadedAt: '2026-11-03T12:00:00.000Z',
          matchedIn: ['FILENAME'],
          folder: { id: document.folderId, name: folders.find((item) => item.id === document.folderId)?.name ?? '' },
        })),
      });
    }
    if (/\/(members|activity|sources)$/.test(pathname)) return json(route, []);
    return json(route, {});
  });

  await page.goto(`/spaces/manage?workspaceId=${workspaceId}`);
  await expect(page.getByRole('heading', { name: 'Carpetas y documentos' })).toBeVisible();
  return { workspaceId, createdFolders, uploads, attempts, folders, uploadedDocs, publicCalls, summaries, uploadImportIds, getMaxActive: () => maxActiveUploads };
}

async function selectSyntheticFolder(page, files) {
  await page.locator('input[webkitdirectory]').evaluate((input, entries) => {
    const transfer = new DataTransfer();
    for (const entry of entries) {
      const selected = new File([entry.content], entry.name, { type: entry.mimeType });
      Object.defineProperty(selected, 'webkitRelativePath', { value: entry.path });
      transfer.items.add(selected);
    }
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, files);
}

test('Sala Editor imports a folder tree, handles partial failure, and retries only the failed file @folder-upload @workspace', async ({ page }) => {
  const state = await mountWorkspace(page, { role: 'EDITOR', type: 'SALA' });
  const files = [
    { name: 'demanda.pdf', path: 'Expedientes 2026/Expediente 1234/demanda.pdf', content: '%PDF synthetic', mimeType: 'application/pdf' },
    { name: 'repetido.pdf', path: 'Expedientes 2026/Expediente 1234/prueba/repetido.pdf', content: '%PDF duplicate', mimeType: 'application/pdf' },
    { name: 'falla.pdf', path: 'Expedientes 2026/Expediente 5678/falla.pdf', content: '%PDF retry', mimeType: 'application/pdf' },
  ];

  const input = page.locator('input[webkitdirectory]');
  await expect(input).toBeEnabled();
  await selectSyntheticFolder(page, files);
  await expect(page.getByText(/Carpeta: Expedientes 2026/u)).toBeVisible();
  await expect(page.getByText(/4 carpetas · 3 archivos admitidos/u)).toBeVisible();
  expect(state.createdFolders).toEqual([]);
  expect(state.uploads).toEqual([]);

  await page.getByRole('button', { name: 'Subir carpeta' }).click();
  await expect(page.getByRole('button', { name: 'Reintentar sólo fallidos' })).toBeVisible();
  await expect(page.getByText(/2 archivo\(s\) incorporado\(s\); 1 duplicado\(s\) omitido\(s\); 1 con error/u)).toBeVisible();

  expect(state.createdFolders.map((entry) => entry.name).sort()).toEqual([
    'Expediente 1234',
    'Expediente 5678',
    'prueba',
  ]);
  expect(state.createdFolders.find((entry) => entry.name === 'prueba')?.parentId)
    .toBe(state.createdFolders.find((entry) => entry.name === 'Expediente 1234')?.id);
  const folderImportId = state.createdFolders[0].folderImportId;
  expect(state.createdFolders.every((entry) => entry.folderImportId === folderImportId)).toBe(true);
  expect(state.uploadImportIds.every((id) => id === folderImportId)).toBe(true);
  expect(state.uploads.map((entry) => entry.filename).sort()).toEqual([
    'demanda.pdf',
    'falla.pdf',
    'repetido.pdf',
  ]);
  expect(state.uploads.every((entry) => Boolean(entry.folderId))).toBe(true);
  expect(state.getMaxActive()).toBeLessThanOrEqual(3);

  await page.getByRole('button', { name: 'Reintentar sólo fallidos' }).click();
  await expect(page.getByText(/3 archivo\(s\) incorporado\(s\); 1 duplicado\(s\) omitido\(s\); 0 con error/u)).toBeVisible();
  expect(state.uploads.filter((entry) => entry.filename === 'falla.pdf')).toHaveLength(2);
  expect(state.uploads.filter((entry) => entry.filename === 'demanda.pdf')).toHaveLength(1);
  expect(state.uploads.filter((entry) => entry.filename === 'repetido.pdf')).toHaveLength(1);
  expect(state.summaries[0]).toMatchObject({
    folderImportId,
    totalFiles: 3,
    attemptedFiles: 3,
    addedFiles: 1,
    duplicateFiles: 1,
    failedFiles: 1,
    notSentFiles: 0,
    rootFolderNames: ['Expedientes 2026'],
  });
  await page.getByLabel('Buscar documentos de la dependencia').fill('demanda');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Coincidencias por nombre (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'demanda.pdf' }).first()).toBeVisible();
  expect(state.summaries).toHaveLength(2);
  expect(state.summaries[1]).toMatchObject({ folderImportId, totalFiles: 3, attemptedFiles: 1, addedFiles: 1, failedFiles: 0 });
  expect(state.publicCalls).toEqual([]);
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
});

test('Juzgado Editor can confirm a folder upload without bypassing membership-based permissions @folder-upload @workspace', async ({ page }) => {
  await mountWorkspace(page, { role: 'EDITOR', type: 'JUZGADO' });
  await expect(page.getByText('Seleccionar carpeta', { exact: true })).toBeVisible();
});

test('synthetic volume cases keep depth and limit folder uploads to three concurrent files @folder-upload @workspace', async ({ page }) => {
  const state = await mountWorkspace(page, { role: 'EDITOR', type: 'JUZGADO' });

  for (const [fileCount, rootCount, depth] of [[20, 3, 3], [100, 10, 6]]) {
    const fileEntries = Array.from({ length: fileCount }, (_, index) => {
      const root = `Lote ${fileCount} legajo ${index % rootCount + 1}`;
      const folders = [root, ...Array.from({ length: depth - 1 }, (_, level) => `Nivel ${level + 2}`)];
      const name = `sintetico-${fileCount}-${index + 1}.txt`;
      return {
        name,
        path: `${folders.join('/')}/${name}`,
        content: `BETA013 synthetic ${fileCount} ${index + 1}`,
        mimeType: 'text/plain',
      };
    });
    await selectSyntheticFolder(page, fileEntries);
    await expect(page.getByText(new RegExp(`${rootCount} carpetas raíz`, 'u'))).toBeVisible();
    await expect(page.getByText(new RegExp(`${fileCount} archivos admitidos`, 'u'))).toBeVisible();
    await page.getByRole('button', { name: 'Subir carpeta' }).click();
    await expect(page.getByText(new RegExp(`${fileCount} archivo\\(s\\) incorporado\\(s\\); 0 duplicado\\(s\\) omitido\\(s\\); 0 con error`, 'u'))).toBeVisible({ timeout: 30_000 });
    expect(state.uploads.length).toBe(fileCount === 20 ? 20 : 120);
    expect(state.getMaxActive()).toBeLessThanOrEqual(3);
    expect(state.createdFolders.length).toBe(fileCount === 20 ? 9 : 69);
  }
  expect(state.summaries).toHaveLength(2);
  expect(state.summaries.map((summary) => summary.totalFiles)).toEqual([20, 100]);
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
  expect(state.publicCalls).toEqual([]);
});

test('Juzgado Viewer cannot see or start folder uploads @folder-upload @workspace', async ({ page }) => {
  const state = await mountWorkspace(page, { role: 'VIEWER', type: 'JUZGADO' });
  await expect(page.getByText('Seleccionar carpeta', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Carga documental', { exact: true })).toHaveCount(0);
  expect(state.createdFolders).toEqual([]);
  expect(state.uploads).toEqual([]);
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
});

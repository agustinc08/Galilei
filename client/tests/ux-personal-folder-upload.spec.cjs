'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');
const path = require('node:path');
const { captureScenario, collectLayout } = require('../ux-qa/helpers.cjs');
const { ensureFolderUploadFixture } = require('../ux-qa/folder-upload-fixture.cjs');

const QA_USER = {
  id: 8901,
  nombre: 'QA',
  apellido: 'Sintético',
  email: 'folder-upload-qa@example.invalid',
  activo: true,
  rol: { id: 1, nombre: 'ADMIN' },
};

test('sube una carpeta con estructura, omite formatos ajenos y aísla un archivo inválido @folder-upload', async ({ page }, testInfo) => {
  const folders = [];
  const documentsByFolder = new Map();
  const folderCounts = new Map();
  const uploadedNames = [];
  let nextFolderId = 1;
  let nextDocumentId = 1;

  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-folder-upload-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, QA_USER);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: QA_USER }));
  await page.route('**/api/workspaces/mine', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/personal/folders**', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      const folder = {
        id: `synthetic-folder-${nextFolderId++}`,
        parentId: body.parentId ?? null,
        name: body.name,
      };
      folders.push(folder);
      folderCounts.set(folder.id, 0);
      return route.fulfill({ json: folder });
    }
    return route.fulfill({ json: folders.map((folder) => ({
      ...folder,
      visibilityLabel: 'Sólo vos',
      _count: { documents: folderCounts.get(folder.id) ?? 0, children: folders.filter((child) => child.parentId === folder.id).length },
    })) });
  });
  await page.route(/\/api\/personal\/documents\/folder-upload(?:\?|$)/u, async (route) => {
    const body = route.request().postDataBuffer()?.toString('utf8') ?? '';
    const names = [...body.matchAll(/filename="([^"]+)"/giu)].map((match) => match[1]);
    uploadedNames.push(...names);
    const folderId = new URL(route.request().url()).searchParams.get('folderId');
    const rows = names.map((name) => {
      if (name === 'ilegible.pdf') {
        return { documentId: '', status: 'ERROR', message: 'PDF inválido: ilegible.pdf' };
      }
      const documentId = `synthetic-document-${nextDocumentId++}`;
      const current = documentsByFolder.get(folderId) ?? [];
      current.push({
        documentId,
        createdAt: '2026-10-28T12:00:00.000Z',
        folder: { id: folderId, name: folders.find((folder) => folder.id === folderId)?.name ?? '' },
        document: {
          title: name.replace(/\.(pdf|docx?)$/iu, ''),
          status: 'INDEXED',
          file: { filename: name, mimeType: name.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : name.endsWith('.doc') ? 'application/msword' : 'application/pdf', sizeBytes: 512 },
          extraction: { status: 'TEXT_EXTRACTED', pageCount: 1 },
        },
      });
      documentsByFolder.set(folderId, current);
      folderCounts.set(folderId, (folderCounts.get(folderId) ?? 0) + 1);
      return { documentId, status: 'INDEXED', duplicate: false };
    });
    return route.fulfill({ json: { destination: 'Mis documentos', access: 'Sólo vos', results: rows } });
  });
  await page.route(/\/api\/personal\/documents\?/u, async (route) => {
    const folderId = new URL(route.request().url()).searchParams.get('folderId');
    return route.fulfill({ json: documentsByFolder.get(folderId) ?? [] });
  });

  await page.goto('/personal');
  await expect(page.getByRole('heading', { name: 'Mis documentos', exact: true })).toBeVisible();
  const input = page.locator('#personal-folder-upload');
  await expect(input).toBeEnabled();
  const fixtureDirectory = ensureFolderUploadFixture(
    process.env.UX_QA_REPORT_DIR || path.resolve(process.cwd(), '../_local-setup/ux-functional-qa/folder-upload'),
  );
  await input.setInputFiles(fixtureDirectory);

  await expect(page.getByRole('status').filter({ hasText: '5 documento(s) listos; 3 omitidos y 0 con error previo.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Incorporar documentos válidos' })).toBeEnabled();
  await page.getByRole('button', { name: 'Incorporar documentos válidos' }).click();
  await expect(page.getByRole('status').filter({ hasText: '4 documento(s) incorporado(s); 0 ya estaban guardados; 3 omitidos; 1 con error.' })).toBeVisible();
  expect(uploadedNames).toContain('ilegible.pdf');
  expect(uploadedNames).toContain('informe.docx');
  expect(uploadedNames).toContain('contrato.doc');
  expect(uploadedNames).toContain('accion.pdf');
  expect(uploadedNames).toContain('Acción reparadora por daño emergente con documentación complementaria y anexos.pdf');
  expect(uploadedNames).not.toContain('foto.png');
  expect(uploadedNames).not.toContain('~$temporal.docx');
  expect(uploadedNames).not.toContain('comprimido.zip');

  const folderButton = page.getByRole('button', { name: /Contratos ñ 2026/iu });
  await expect(folderButton).toBeVisible();
  await expect(folderButton).toContainText('4');
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await collectLayout(page);
    expect(layout.horizontalOverflow.passes, `horizontal overflow at ${viewport.width}x${viewport.height}`).toBe(true);
    await captureScenario(page, testInfo, { id: `folder-upload-${viewport.width}x${viewport.height}`, route: '/personal' });
  }

  await folderButton.click();
  await expect(page.getByText('accion.pdf', { exact: true })).toBeVisible();
  await expect(page.getByText('informe.docx', { exact: true })).toBeVisible();
  await expect(page.getByText('contrato.doc', { exact: true })).toBeVisible();
  await expect(page.getByText('Acción reparadora por daño emergente con documentación complementaria y anexos', { exact: true })).toBeVisible();
  await expect(page.getByText('ilegible.pdf', { exact: true })).toHaveCount(0);
  const diagnostics = page.__uxQaDiagnostics;
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.networkErrors).toEqual([]);
  expect(diagnostics.fixtureMisses).toEqual([]);
});

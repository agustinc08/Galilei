'use strict';

const { expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('../ux-qa/fixtures-playwright.cjs');

const fixtures = {
  text: fs.readFileSync(path.resolve(__dirname, '../../server/src/corpus/fixtures/sprint154a1-ten-pages.pdf')),
  scan: fs.readFileSync(path.resolve(__dirname, '../../server/src/corpus/fixtures/sprint154a1-image-only.pdf')),
};

const workspaceId = 'workspace-preview-qa';
const documents = [
  {
    id: 'synthetic-ten-page-pdf',
    filename: 'texto-diez-paginas.pdf',
    title: 'PDF textual de diez páginas',
    status: 'INDEXED',
    extractionStatus: 'TEXT_EXTRACTED',
    pageCount: 10,
    fixture: 'text',
  },
  {
    id: 'synthetic-scanned-pdf',
    filename: 'documento-escaneado.pdf',
    title: 'PDF escaneado',
    status: 'OCR_REQUIRED',
    extractionStatus: 'OCR_REQUIRED',
    pageCount: 1,
    fixture: 'scan',
  },
];

function json(route, body) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mountPreview(page) {
  const user = {
    id: 8942,
    nombre: 'Cuenta',
    apellido: 'Preview QA',
    email: 'workspace-preview@example.invalid',
    activo: true,
    rol: { id: 13, nombre: 'JURISPRUDENCIA', descripcion: null },
  };
  const publicCalls = [];
  await page.addInitScript((storedUser) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-workspace-preview-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(storedUser));
  }, user);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/public/')) {
      publicCalls.push(pathname);
      return json(route, {});
    }
    if (pathname === '/api/auth/me') return json(route, user);
    if (pathname === '/api/workspaces/mine') return json(route, [{
      id: workspaceId,
      name: 'Sala Preview QA',
      code: 'SALA-PREVIEW-QA',
      type: 'SALA',
      role: 'EDITOR',
    }]);
    if (pathname === `/api/workspaces/${workspaceId}/folders` || pathname === `/api/workspaces/${workspaceId}/search/sources`) return json(route, []);
    if (pathname === `/api/workspaces/${workspaceId}/documents` && request.method() === 'GET') {
      return json(route, {
        page: 1,
        pageSize: 20,
        total: documents.length,
        results: documents.map((document) => ({
          createdAt: '2026-11-03T12:00:00.000Z',
          folder: null,
          document: {
            id: document.id,
            title: document.title,
            status: document.status,
            file: { filename: document.filename, mimeType: 'application/pdf', pageCount: document.pageCount },
          },
        })),
      });
    }
    const match = pathname.match(new RegExp(`^/api/workspaces/${workspaceId}/documents/([^/]+)(?:/(file|matches|ocr))?$`, 'u'));
    if (match) {
      const document = documents.find((item) => item.id === match[1]);
      if (!document) return json(route, { message: 'not found' });
      if (match[2] === 'file') {
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: fixtures[document.fixture] });
      }
      if (match[2] === 'matches') return json(route, { total: 0, returned: 0, exactTotalKnown: true, truncated: false, matches: [] });
      if (match[2] === 'ocr') return json(route, { state: 'PENDING', canRetry: false });
      return json(route, {
        id: document.id,
        title: document.title,
        status: document.status,
        file: { filename: document.filename, mimeType: 'application/pdf', pageCount: document.pageCount },
        extraction: { status: document.extractionStatus, pageCount: document.pageCount },
        workspaceOcr: {
          state: document.status === 'OCR_REQUIRED' ? 'NEEDS_OCR' : 'NOT_REQUIRED',
          canStart: document.status === 'OCR_REQUIRED',
          canRetry: false,
        },
      });
    }
    return json(route, {});
  });
  await page.goto(`/spaces?workspaceId=${workspaceId}`);
  return { publicCalls };
}

async function checkPreviewLayout(page, viewport) {
  await page.setViewportSize(viewport);
  const preview = page.getByRole('complementary', { name: 'Vista previa del documento' });
  await expect(preview).toBeVisible();
  await expect(preview.locator('[data-testid="pdf-viewer-ready"]')).toContainText('página 1');
  const layout = await preview.evaluate((panel) => {
    const content = panel.querySelector('[class*="previewContent"]');
    const pdfPreview = panel.querySelector('[class*="pdfPreview"]');
    const pdfDocument = panel.querySelector('[class*="pdfDocument"]');
    const canvas = panel.querySelector('.react-pdf__Page__canvas');
    const scrollNodes = [content, pdfPreview, pdfDocument].filter((element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return ['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 2;
    });
    return {
      panelWidth: panel.getBoundingClientRect().width,
      previewWidth: pdfPreview?.getBoundingClientRect().width ?? 0,
      canvasWidth: canvas?.getBoundingClientRect().width ?? 0,
      scrollNodes: scrollNodes.map((element) => element.className),
      pdfPreviewOverflowY: pdfPreview ? getComputedStyle(pdfPreview).overflowY : '',
      pdfDocumentOverflowY: pdfDocument ? getComputedStyle(pdfDocument).overflowY : '',
    };
  });
  expect(layout.panelWidth).toBeLessThanOrEqual(viewport.width + 1);
  expect(layout.canvasWidth).toBeGreaterThan(100);
  expect(layout.canvasWidth).toBeLessThanOrEqual(layout.previewWidth + 2);
  expect(layout.scrollNodes.length).toBeLessThanOrEqual(1);
  expect(layout.pdfPreviewOverflowY).toBe('visible');
  expect(layout.pdfDocumentOverflowY).toBe('visible');
  return layout;
}

test('Workspace PDF preview renders one page at fit width, navigates, switches documents, and stays responsive @workspace-preview @workspace', async ({ page }) => {
  const state = await mountPreview(page);
  const preview = page.getByRole('complementary', { name: 'Vista previa del documento' });
  const textPdf = page.getByRole('button', { name: 'Vista previa de texto-diez-paginas.pdf' });
  await expect(textPdf).toBeVisible();
  await textPdf.click();
  await expect(preview.locator('[data-testid="pdf-viewer-ready"]')).toContainText('página 1');
  await expect(preview.getByText('Página 1 de 10')).toBeVisible();
  expect(await preview.locator('.react-pdf__Page').count()).toBe(1);

  await preview.getByRole('button', { name: 'Página siguiente' }).click();
  await expect(preview.locator('[data-testid="pdf-viewer-ready"]')).toContainText('página 2');
  await expect(preview.getByText('Página 2 de 10')).toBeVisible();
  for (let pageNumber = 3; pageNumber <= 10; pageNumber += 1) {
    await preview.getByRole('button', { name: 'Página siguiente' }).click();
    await expect(preview.locator('[data-testid="pdf-viewer-ready"]')).toContainText(`página ${pageNumber}`);
  }
  await expect(preview.getByText('Página 10 de 10')).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Página siguiente' })).toBeDisabled();
  await preview.getByRole('button', { name: 'Página anterior' }).click();
  await expect(preview.locator('[data-testid="pdf-viewer-ready"]')).toContainText('página 9');

  await page.getByRole('button', { name: 'Vista previa de documento-escaneado.pdf' }).click();
  await expect(preview.locator('[data-testid="pdf-viewer-ready"]')).toContainText('página 1');
  await expect(preview.getByText('Página 1 de 1')).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Reconocer texto (OCR)' })).toBeVisible();
  await expect(preview.locator('iframe[title^="PDF original:"]')).toHaveCount(0);
  await page.reload();
  await expect(preview.locator('[data-testid="pdf-viewer-ready"]')).toContainText('página 1');
  await expect(preview.getByText('Página 1 de 1')).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Reconocer texto (OCR)' })).toBeVisible();
  const fullViewerLink = preview.getByRole('link', { name: 'Abrir completo' });
  await expect(fullViewerLink).toHaveAttribute('href', new RegExp(`/spaces/${workspaceId}/documents/${documents[1].id}`, 'u'));

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    preview.getByRole('button', { name: 'Descargar' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('documento-escaneado.pdf');

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await checkPreviewLayout(page, viewport);
  }

  expect(state.publicCalls).toEqual([]);
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.fixtureMisses).toEqual([]);
});

'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');
const fs = require('node:fs');
const path = require('node:path');

const scannedPdf = fs.readFileSync(path.resolve(__dirname, '../../server/src/corpus/fixtures/sprint154a1-image-only.pdf'));

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mountWorkspaceOcr(page, role, options = {}) {
  const workspaceId = `workspace-ocr-${role.toLowerCase()}`;
  const documentId = 'synthetic-private-scan';
  const workspace = {
    id: workspaceId,
    name: 'Sala OCR QA',
    code: 'SALA-OCR-QA',
    type: 'SALA',
    role,
  };
  const user = {
    id: 8931,
    nombre: 'Cuenta',
    apellido: 'OCR QA',
    email: 'workspace-ocr@example.invalid',
    activo: true,
    rol: { id: 13, nombre: 'JURISPRUDENCIA', descripcion: null },
  };
  const state = {
    ocr: options.initialOcr ?? 'NEEDS_OCR',
    canRetry: options.canRetry ?? false,
    startCalls: 0,
    metadataReadsAfterStart: 0,
    workspaceListCalls: 0,
    workspaceSearchCalls: 0,
    publicCalls: [],
  };

  await page.addInitScript((storedUser) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-workspace-ocr-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(storedUser));
  }, user);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/public/')) {
      state.publicCalls.push({ method, pathname });
      return json(route, {});
    }
    if (pathname === '/api/auth/me') return json(route, user);
    if (pathname === '/api/workspaces/mine') return json(route, [workspace]);
    if (pathname === `/api/workspaces/${workspaceId}/folders`) return json(route, []);
    if (pathname === `/api/workspaces/${workspaceId}/search/sources`) return json(route, []);
    if (pathname === `/api/workspaces/${workspaceId}/documents/${documentId}/ocr` && method === 'POST') {
      state.startCalls += 1;
      if (role === 'VIEWER') return json(route, { message: 'forbidden' }, 403);
      state.ocr = 'PENDING';
      return json(route, { state: 'PENDING', canRetry: false });
    }
    if (pathname === `/api/workspaces/${workspaceId}/documents/${documentId}`) {
      if (state.startCalls && state.ocr !== 'COMPLETED') {
        state.metadataReadsAfterStart += 1;
        if (state.metadataReadsAfterStart >= 1) state.ocr = 'COMPLETED';
      }
      const completed = state.ocr === 'COMPLETED';
      return json(route, {
        id: documentId,
        title: 'PDF escaneado de prueba',
        status: completed ? 'INDEXED' : state.ocr === 'PENDING' || state.ocr === 'PROCESSING' ? 'OCR_PROCESSING' : state.ocr === 'ERROR' ? 'OCR_FAILED' : 'OCR_REQUIRED',
        file: { filename: 'contrato-escaneado.pdf', mimeType: 'application/pdf', pageCount: 1 },
        extraction: { status: completed ? 'OCR_COMPLETE' : 'OCR_REQUIRED', pageCount: 1 },
        workspaceOcr: {
          state: state.ocr,
          canStart: role !== 'VIEWER' && (state.ocr === 'NEEDS_OCR' || (state.ocr === 'ERROR' && state.canRetry)),
          canRetry: state.canRetry,
        },
        selectedPage: completed
          ? { pageNumber: 1, text: 'Frase OCR QA exclusiva de la Sala', textKind: 'OCR' }
          : undefined,
      });
    }
    if (pathname === `/api/workspaces/${workspaceId}/documents/${documentId}/file`) {
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: scannedPdf });
    }
    if (pathname === `/api/workspaces/${workspaceId}/documents/${documentId}/matches`) {
      const matches = state.ocr === 'COMPLETED'
        ? [{ page: 1, start: 0, end: 8, ordinal: 1, context: 'Frase OCR QA exclusiva de la Sala', contextBefore: '', contextAfter: '', text: 'Frase OCR', kind: 'TERM', pageOccurrenceOrdinal: 1, total: 1 }]
        : [];
      return json(route, { total: matches.length, returned: matches.length, exactTotalKnown: true, truncated: false, matches });
    }
    if (pathname === `/api/workspaces/${workspaceId}/search` && method === 'GET') {
      state.workspaceSearchCalls += 1;
      const q = new URL(request.url()).searchParams.get('q') ?? '';
      const found = state.ocr === 'COMPLETED' && q.toLowerCase().includes('ocr qa');
      return json(route, {
        page: 1,
        pageSize: 20,
        total: found ? 1 : 0,
        totalExact: true,
        hasMore: false,
        results: found ? [{
          id: documentId,
          sourceId: documentId,
          title: 'contrato-escaneado.pdf',
          date: null,
          snippet: 'Frase OCR QA exclusiva de la Sala',
          document: { mimeType: 'application/pdf' },
          metadata: { filename: 'contrato-escaneado.pdf', status: 'INDEXED', folderName: 'Todos los documentos' },
        }] : [],
      });
    }
    if (pathname === `/api/workspaces/${workspaceId}/search/names`) {
      return json(route, { total: 0, totalExact: true, page: 1, pageSize: 20, results: [] });
    }
    if (pathname === `/api/workspaces/${workspaceId}/documents` && method === 'GET') {
      state.workspaceListCalls += 1;
      return json(route, {
        page: 1,
        pageSize: 20,
        total: 1,
        results: [{
          createdAt: '2026-11-03T12:00:00.000Z',
          folder: null,
          document: {
            id: documentId,
            title: 'PDF escaneado de prueba',
            status: state.ocr === 'COMPLETED' ? 'INDEXED' : 'OCR_REQUIRED',
            file: { filename: 'contrato-escaneado.pdf', mimeType: 'application/pdf' },
          },
        }],
      });
    }
    return json(route, {});
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  if (options.fullViewer) {
    await page.goto(`/spaces/${workspaceId}/documents/${documentId}?workspaceId=${workspaceId}&workspaceName=${encodeURIComponent(workspace.name)}`);
    await expect(page.getByRole('heading', { name: 'PDF escaneado de prueba' })).toBeVisible();
  } else {
    await page.goto(`/spaces?workspaceId=${workspaceId}`);
    await page.getByRole('button', { name: 'Vista previa de contrato-escaneado.pdf' }).click();
    await expect(page.locator('[data-testid="pdf-viewer-ready"]')).toContainText('página 1');
  }
  return state;
}

test('dependency Editor starts Workspace OCR from the preview, refreshes state, then finds its private text @workspace-ocr @workspace', async ({ page }) => {
  const state = await mountWorkspaceOcr(page, 'EDITOR');
  await page.getByRole('button', { name: 'Reconocer texto (OCR)' }).click();
  const confirm = page.getByRole('group', { name: 'Confirmar reconocimiento de texto' });
  await expect(confirm).toContainText('El archivo original no será modificado.');
  await confirm.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('button', { name: 'Reconocer texto (OCR)' })).toBeVisible();
  await page.getByRole('button', { name: 'Reconocer texto (OCR)' }).click();
  await page.getByRole('group', { name: 'Confirmar reconocimiento de texto' }).getByRole('button', { name: 'Iniciar OCR' }).click();
  expect(state.startCalls).toBe(1);
  await expect(page.getByRole('status').filter({ hasText: 'OCR pendiente' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Texto reconocido. Ahora podés buscar dentro de este documento.' })).toBeVisible({ timeout: 10_000 });

  await page.getByLabel('Buscar documentos de la dependencia').fill('OCR QA');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vista previa de contrato-escaneado.pdf' })).toBeVisible();
  await expect(page.getByText('Frase OCR QA exclusiva de la Sala')).toBeVisible();
  expect(state.workspaceSearchCalls).toBeGreaterThan(0);
  expect(state.publicCalls).toEqual([]);
  expect(state.startCalls).toBe(1);
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
});

test('dependency Admin can start Workspace OCR from the preview @workspace-ocr @workspace', async ({ page }) => {
  const adminState = await mountWorkspaceOcr(page, 'ADMIN');
  await expect(page.getByRole('button', { name: 'Reconocer texto (OCR)' })).toBeVisible();
  await page.getByRole('button', { name: 'Reconocer texto (OCR)' }).click();
  await page.getByRole('group', { name: 'Confirmar reconocimiento de texto' }).getByRole('button', { name: 'Iniciar OCR' }).click();
  expect(adminState.startCalls).toBe(1);
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
});

test('dependency Viewer sees Workspace OCR status but has no action to start it @workspace-ocr @workspace', async ({ page }) => {
  const viewerState = await mountWorkspaceOcr(page, 'VIEWER');
  await expect(page.getByText('Un editor o administrador de la dependencia puede iniciar el reconocimiento.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Reconocer texto|Iniciar OCR|Reintentar OCR/u })).toHaveCount(0);
  expect(viewerState.startCalls).toBe(0);
  expect(viewerState.publicCalls).toEqual([]);
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
});

test('existing shared PDF exposes OCR from its full viewer to an Editor without starting a job @workspace-ocr @workspace', async ({ page }) => {
  const state = await mountWorkspaceOcr(page, 'EDITOR', { fullViewer: true });
  await expect(page.getByRole('status').filter({ hasText: 'todavía no hay texto para buscar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconocer texto (OCR)' })).toBeVisible();
  expect(state.startCalls).toBe(0);
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
});

test('existing shared PDF exposes OCR from its full viewer to an Admin without starting a job @workspace-ocr @workspace', async ({ page }) => {
  const state = await mountWorkspaceOcr(page, 'ADMIN', { fullViewer: true });
  await expect(page.getByRole('button', { name: 'Reconocer texto (OCR)' })).toBeVisible();
  expect(state.startCalls).toBe(0);
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
});

test('full viewer keeps OCR unavailable to a Viewer @workspace-ocr @workspace', async ({ page }) => {
  const state = await mountWorkspaceOcr(page, 'VIEWER', { fullViewer: true });
  await expect(page.getByText('Un editor o administrador de la dependencia puede iniciar el reconocimiento.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Reconocer texto|Iniciar OCR|Reintentar OCR/u })).toHaveCount(0);
  expect(state.startCalls).toBe(0);
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
});

test('full viewer offers retry only for retryable OCR errors and eligible roles @workspace-ocr @workspace', async ({ page }) => {
  const state = await mountWorkspaceOcr(page, 'EDITOR', { fullViewer: true, initialOcr: 'ERROR', canRetry: true });
  await expect(page.getByRole('button', { name: 'Reintentar OCR' })).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar OCR' }).click();
  const confirm = page.getByRole('group', { name: 'Confirmar reintento de reconocimiento' });
  await expect(confirm).toContainText('PDF original');
  await confirm.getByRole('button', { name: 'Cancelar' }).click();
  expect(state.startCalls).toBe(0);
});

test('full viewer does not offer OCR again after recognition completes @workspace-ocr @workspace', async ({ page }) => {
  await mountWorkspaceOcr(page, 'EDITOR', { fullViewer: true, initialOcr: 'COMPLETED' });
  await expect(page.getByRole('status').filter({ hasText: 'Listo para buscar dentro de este documento' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Reconocer texto|Iniciar OCR|Reintentar OCR/u })).toHaveCount(0);
});

'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');

function installAdminSession(page) {
  const admin = {
    id: 8901,
    nombre: 'Cuenta',
    apellido: 'QA',
    email: 'admin-product-polish@example.invalid',
    activo: true,
    rol: { id: 1, nombre: 'ADMIN' },
  };
  return page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-admin-product-polish-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, admin);
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('dashboard ends a failed load, shows its tracking id, and retries without reload @product-polish @state', async ({ page }) => {
  await installAdminSession(page);
  let summaryRequests = 0;
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return json(route, {
      id: 8901, nombre: 'Cuenta', apellido: 'QA', email: 'admin-product-polish@example.invalid',
      activo: true, rol: { id: 1, nombre: 'ADMIN' },
    });
    if (pathname === '/api/estadisticas/resumen-general') {
      summaryRequests += 1;
      if (summaryRequests === 1) return json(route, { statusCode: 503, message: 'internal server error', requestId: 'qa-track-20261029' }, 503);
      return json(route, { data: { totalSentencias: 1, totalSumarios: 2, totalConPdf: 1, totalPublicadas: 1 } });
    }
    if (pathname === '/api/sentencias') return json(route, { data: [], meta: { page: 1, pageCount: 1, total: 0, pageSize: 4 } });
    if (pathname === '/api/estadisticas/uso/sentencias-mas-vistas') return json(route, { data: [] });
    if (pathname === '/api/estadisticas/calidad-datos') return json(route, { data: { sentenciasSinPdf: 0, sentenciasSinResena: 0, sentenciasSinResumen: 0, sentenciasSinSumarios: 0, sumariosSinTema: 0 } });
    if (pathname === '/api/corpus/documents/admin/summary') return json(route, {
      physicalFiles: 0, documents: 0, pages: 0, linked: 0, unresolved: 0, pendingAssociations: 0,
      classifications: 0, classificationCounts: {}, statusCounts: {}, selected: 0, notSelected: 0,
      digestoDocuments: 0, digestoMemberships: 0, sourceMissing: 0, runs: [],
    });
    return json(route, {});
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('alert').getByText('No se pudo cargar el dashboard')).toBeVisible();
  await expect(page.getByText('Cargando métricas...')).toHaveCount(0);
  await expect(page.getByText('Identificador de seguimiento:')).toContainText('qa-track-20261029');
  await expect(page.getByRole('alert')).not.toContainText('internal server error');
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByText('Sentencias cargadas')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(summaryRequests).toBe(2);
});

test('audit detail failure leaves the list usable and retries only the detail @product-polish @state', async ({ page }) => {
  await installAdminSession(page);
  let listRequests = 0;
  let detailRequests = 0;
  const log = {
    id: 17, usuarioId: 8901, entidad: 'SENTENCIA', entidadId: 23, accion: 'UPDATE',
    descripcion: 'Actualizó metadatos', createdAt: '2026-10-29T12:00:00.000Z',
    usuario: { id: 8901, nombre: 'Cuenta', apellido: 'QA', email: 'admin-product-polish@example.invalid', rol: { nombre: 'ADMIN' } },
    datosAntes: { estado: 'interno' }, datosDespues: { estado: 'publicado' },
  };
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return json(route, {
      id: 8901, nombre: 'Cuenta', apellido: 'QA', email: 'admin-product-polish@example.invalid',
      activo: true, rol: { id: 1, nombre: 'ADMIN' },
    });
    if (pathname === '/api/logs') {
      listRequests += 1;
      return json(route, { data: [log], meta: { page: 1, pageCount: 1, total: 1, pageSize: 20 } });
    }
    if (pathname === '/api/logs/17') {
      detailRequests += 1;
      if (detailRequests === 1) return json(route, { statusCode: 503, message: 'internal server error' }, 503);
      return json(route, { data: log });
    }
    return json(route, {});
  });

  await page.goto('/admin/logs');
  await expect(page.getByText('Actualizó metadatos')).toBeVisible();
  await page.getByRole('button', { name: 'Ver detalle del registro 17' }).click();
  const drawer = page.getByRole('dialog', { name: 'Detalle de auditoría' });
  await expect(drawer.getByRole('alert')).toContainText('No pudimos cargar el detalle');
  await expect(drawer.getByText('Cargando detalle…')).toHaveCount(0);
  await expect(page.getByText('Actualizó metadatos')).toBeVisible();
  expect(listRequests).toBe(1);

  await drawer.getByRole('button', { name: 'Reintentar' }).click();
  await expect(drawer.getByText('Datos anteriores')).toBeVisible();
  await expect(drawer.getByText('Datos posteriores')).toBeVisible();
  expect(listRequests).toBe(1);
  expect(detailRequests).toBe(2);
  await drawer.getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Actualizó metadatos')).toBeVisible();
});

test('editorial review presents evidence in human language and keeps raw keys hidden @product-polish @state', async ({ page }) => {
  await installAdminSession(page);
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return json(route, {
      id: 8901, nombre: 'Cuenta', apellido: 'QA', email: 'admin-product-polish@example.invalid',
      activo: true, rol: { id: 1, nombre: 'ADMIN' },
    });
    if (pathname === '/api/corpus/documents/admin/review') return json(route, {
      total: 1, page: 1, pageSize: 50,
      results: [{
        id: 'doc-polish-qa', title: 'Sentencia de prueba', status: 'INDEXED', caseNumber: '123/2024',
        locations: [],
        associations: [{ id: 'association-qa', targetId: '19624', confidence: 'HIGH_CONFIDENCE', reviewStatus: 'REVIEW_PENDING', evidence: { strategies: ['EXACT_LEGACY_ID_OR_SENTENCE_NUMBER_FILENAME'] } }],
        classifications: [],
      }],
    });
    return json(route, {});
  });

  await page.goto('/revision');
  await expect(page.getByText('Coincidencia alta')).toBeVisible();
  await expect(page.getByText('Pendiente de revisión humana')).toBeVisible();
  await expect(page.getByText('Coinciden el identificador o número de sentencia y el nombre del archivo.')).toBeVisible();
  await expect(page.getByText(/HIGH_CONFIDENCE|EXACT_LEGACY|strategies|\{"strategies"/u)).toHaveCount(0);
  await expect(page.getByText(/Todas requieren revisión humana/u)).toBeVisible();
});

test('workspace preview uses a tablet overlay and a sequential mobile view @product-polish @workspace', async ({ page }) => {
  const reader = {
    id: 8902, nombre: 'Cuenta', apellido: 'Sala QA', email: 'reader-product-polish@example.invalid',
    activo: true, rol: { id: 6, nombre: 'LECTOR' },
  };
  const workspaceId = 'synthetic-product-polish-sala';
  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-workspace-product-polish-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, reader);
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return json(route, reader);
    if (pathname === '/api/workspaces/mine') return json(route, [{
      id: workspaceId, name: 'Sala QA', code: 'SALA-QA', type: 'SALA', role: 'VIEWER',
    }]);
    if (pathname === `/api/workspaces/${workspaceId}/folders` || pathname === `/api/workspaces/${workspaceId}/search/sources`) return json(route, []);
    if (pathname === `/api/workspaces/${workspaceId}/documents/synthetic-document/file`) {
      return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: 'Contenido textual sintético para la vista previa.' });
    }
    if (pathname === `/api/workspaces/${workspaceId}/documents/synthetic-document`) return json(route, {
      id: 'synthetic-document', title: 'Fallo de prueba', status: 'INDEXED',
      file: { filename: 'fallo-qa.txt', mimeType: 'text/plain' },
      extraction: { status: 'COMPLETED', pageCount: 1 },
      selectedPage: { pageNumber: 1, text: 'Contenido textual sintético para la vista previa.', textKind: 'NATIVE' },
    });
    if (pathname.startsWith(`/api/workspaces/${workspaceId}/documents`)) return json(route, {
      page: 1, pageSize: 20, total: 1,
      results: [{ createdAt: '2026-10-29T12:00:00.000Z', folder: null, document: {
        id: 'synthetic-document', title: 'Fallo de prueba', status: 'INDEXED',
        file: { filename: 'fallo-qa.txt', mimeType: 'text/plain' },
      } }],
    });
    return json(route, {});
  });

  const leftPanel = page.getByRole('complementary', { name: 'Carpetas de Sala QA' });
  const results = page.getByRole('main', { name: 'Búsqueda y resultados' });
  const preview = page.getByRole('complementary', { name: 'Vista previa del documento' });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`/spaces?workspaceId=${workspaceId}`);
  await expect(page.getByRole('button', { name: 'Vista previa de fallo-qa.txt' })).toBeVisible();
  const [tabletLeftBounds, tabletResultsBounds] = await Promise.all([leftPanel.boundingBox(), results.boundingBox()]);
  expect(tabletLeftBounds).not.toBeNull();
  expect(tabletResultsBounds).not.toBeNull();
  expect(tabletResultsBounds.x).toBeGreaterThan(tabletLeftBounds.x);
  await page.getByRole('button', { name: 'Vista previa de fallo-qa.txt' }).click();
  await expect(preview.getByText('Contenido textual sintético para la vista previa.')).toBeVisible();
  await expect(leftPanel).toBeVisible();
  await expect(results).toBeVisible();
  const [resultsBounds, previewBounds] = await Promise.all([results.boundingBox(), preview.boundingBox()]);
  expect(resultsBounds).not.toBeNull();
  expect(previewBounds).not.toBeNull();
  expect(await preview.evaluate((element) => getComputedStyle(element).position)).toBe('absolute');
  expect(previewBounds.x + previewBounds.width).toBeGreaterThan(resultsBounds.x + resultsBounds.width / 2);
  expect(previewBounds.width).toBeGreaterThan(160);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/spaces?workspaceId=${workspaceId}`);
  await expect(page.getByRole('button', { name: 'Vista previa de fallo-qa.txt' })).toBeVisible();
  const [mobileLeftBounds, mobileResultsBounds] = await Promise.all([leftPanel.boundingBox(), results.boundingBox()]);
  expect(mobileLeftBounds).not.toBeNull();
  expect(mobileResultsBounds).not.toBeNull();
  expect(Math.abs(mobileLeftBounds.x - mobileResultsBounds.x), 'mobile workspace should stack folders above results').toBeLessThan(2);
  await expect(preview).toBeHidden();
  await page.getByRole('button', { name: 'Vista previa de fallo-qa.txt' }).click();
  await expect(preview.getByText('Contenido textual sintético para la vista previa.')).toBeVisible();
  await expect(leftPanel).toBeHidden();
  await expect(results).toBeHidden();
  await page.getByRole('button', { name: 'Volver a resultados' }).click();
  await expect(preview).toBeHidden();
  await expect(results).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vista previa de fallo-qa.txt' })).toBeVisible();
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.fixtureMisses).toEqual([]);
});

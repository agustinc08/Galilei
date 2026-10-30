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

function makePdfFixture() {
  const stream = 'BT /F1 14 Tf 72 720 Td (Original QA PDF page) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source, 'binary'));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(source, 'binary');
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, '0')} 00000 n \n`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, 'binary');
}

test('dashboard ends a failed load, shows its tracking id, and retries without reload @product-polish @state', async ({ page }) => {
  await installAdminSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
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
      return json(route, { data: { totalSentencias: 24661, totalSumarios: 29340, totalConPdf: 1162, totalPublicadas: 24614 } });
    }
    if (pathname === '/api/sentencias') return json(route, { data: [], meta: { page: 1, pageCount: 1, total: 0, pageSize: 4 } });
    if (pathname === '/api/estadisticas/uso/sentencias-mas-vistas') return json(route, { data: [{
      sentenciaId: 9001, total: 1234,
      sentencia: { id: 9001, caratula: 'Fallos frecuentes QA', sala: 'H', fecha: '2024-06-03T12:00:00.000Z', publicado: true, destacada: false },
    }] });
    if (pathname === '/api/estadisticas/calidad-datos') return json(route, { data: { sentenciasSinPdf: 23499, sentenciasSinResena: 24661, sentenciasSinResumen: 19876, sentenciasSinSumarios: 1518, sumariosSinTema: 52 } });
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
  await expect(page.getByText('Sin estadísticas disponibles')).toHaveCount(0);
  await expect(page.getByText('Identificador de seguimiento:')).toContainText('qa-track-20261029');
  await expect(page.getByRole('alert')).not.toContainText('internal server error');
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByText('Sentencias cargadas')).toBeVisible();
  await expect(page.getByText('24.661', { exact: true }).first()).toBeVisible();
  const qualitySummary = page.locator('[class*="summaryGrid"]').filter({ hasText: 'Fallos sin resumen' });
  await expect(qualitySummary.locator('[class*="summaryItem"]').filter({ hasText: 'Fallos sin resumen' })).toContainText('19.876');
  await expect(qualitySummary.locator('[class*="summaryItem"]').filter({ hasText: 'Fallos sin sumarios' })).toContainText('1.518');
  await expect(page.getByText('1.234 vistas', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const mobileMetrics = await page.locator('[class*="dashboardMetrics"] > div').evaluateAll((items) => items.slice(0, 3).map((item) => {
    const rect = item.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  expect(mobileMetrics[1].x).toBeGreaterThan(mobileMetrics[0].x);
  expect(Math.abs(mobileMetrics[1].y - mobileMetrics[0].y)).toBeLessThan(2);
  expect(mobileMetrics[2].y).toBeGreaterThan(mobileMetrics[0].y);

  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopMetrics = await page.locator('[class*="dashboardMetrics"] > div').evaluateAll((items) => items.map((item) => {
    const rect = item.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  expect(desktopMetrics).toHaveLength(6);
  expect(Math.abs(desktopMetrics[1].y - desktopMetrics[0].y)).toBeLessThan(2);
  expect(Math.abs(desktopMetrics[2].y - desktopMetrics[0].y)).toBeLessThan(2);
  expect(desktopMetrics[3].y).toBeGreaterThan(desktopMetrics[0].y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(summaryRequests).toBe(2);
});

test('workspace activity explains why inherited documents may not appear in the log @product-polish @workspace', async ({ page }) => {
  await installAdminSession(page);
  const workspace = { id: 'workspace-qa', code: 'SALA-QA', name: 'Sala Beta Oficina', type: 'SALA', role: 'ADMIN' };
  const managedWorkspace = { ...workspace, active: true, administrators: [] };
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return json(route, {
      id: 8901, nombre: 'Cuenta', apellido: 'QA', email: 'admin-product-polish@example.invalid',
      activo: true, rol: { id: 1, nombre: 'ADMIN' },
    });
    if (pathname === '/api/workspaces/mine') return json(route, [workspace]);
    if (pathname === '/api/workspaces/admin/list') return json(route, [managedWorkspace]);
    if (/^\/api\/workspaces\/workspace-qa\/(folders|documents|members|activity|sources)$/u.test(pathname)) return json(route, []);
    return json(route, {});
  });

  await page.goto('/spaces/manage?workspaceId=workspace-qa');
  await expect(page.getByRole('heading', { name: 'Actividad del espacio' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Todavía no hay cargas o cambios recientes');
  await expect(page.getByText(/documentos heredados siguen disponibles en sus carpetas/u)).toBeVisible();
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

test('audit filters use day-first dates and send ISO values @product-polish @audit-dates', async ({ page }) => {
  await installAdminSession(page);
  const requests = [];
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return json(route, {
      id: 8901, nombre: 'Cuenta', apellido: 'QA', email: 'admin-product-polish@example.invalid',
      activo: true, rol: { id: 1, nombre: 'ADMIN' },
    });
    if (pathname === '/api/logs') {
      const url = new URL(route.request().url());
      requests.push({ fechaDesde: url.searchParams.get('fechaDesde'), fechaHasta: url.searchParams.get('fechaHasta') });
      return json(route, { data: [], meta: { page: 1, pageCount: 1, total: 0, pageSize: 20 } });
    }
    return json(route, {});
  });

  await page.goto('/admin/logs');
  await expect(page.getByText('Sin registros')).toBeVisible();
  const from = page.getByLabel('Fecha desde (dd/mm/aaaa)');
  const to = page.getByLabel('Fecha hasta (dd/mm/aaaa)');
  await expect(from).toHaveAttribute('placeholder', 'dd/mm/aaaa');
  await from.fill('29022024');
  await to.fill('01032024');
  await expect(from).toHaveValue('29/02/2024');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual({ fechaDesde: '2024-02-29', fechaHasta: '2024-03-01' });

  await from.fill('31022024');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Ingresá fechas válidas en formato dd/mm/aaaa.');
  expect(requests).toHaveLength(2);
});

test('mobile audit keeps filters available without pushing the log list below the first screen @product-polish @audit-mobile', async ({ page }) => {
  await installAdminSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return json(route, {
      id: 8901, nombre: 'Cuenta', apellido: 'QA', email: 'admin-product-polish@example.invalid',
      activo: true, rol: { id: 1, nombre: 'ADMIN' },
    });
    if (pathname === '/api/logs') return json(route, { data: [], meta: { page: 1, pageCount: 1, total: 0, pageSize: 20 } });
    return json(route, {});
  });

  await page.goto('/admin/logs');
  const toggle = page.locator('button[aria-controls="audit-filters"]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Fecha desde (dd/mm/aaaa)')).toBeHidden();
  const emptyState = page.getByText('Sin registros', { exact: true });
  await expect(emptyState).toBeVisible();
  expect((await emptyState.boundingBox())?.y).toBeLessThan(844);

  await toggle.click();
  await expect(page.getByLabel('Fecha desde (dd/mm/aaaa)')).toBeVisible();
  await expect(page.getByLabel('Acción')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

test('audit presents new entity and action names in Spanish and can filter them @product-polish @audit-labels', async ({ page }) => {
  await installAdminSession(page);
  const requests = [];
  const log = {
    id: 29, usuarioId: 8901, entidad: 'WorkspaceDocument', entidadId: 'document-29', accion: 'WORKSPACE_DOCUMENT_UPLOAD',
    descripcion: null, createdAt: '2026-10-29T12:00:00.000Z',
    usuario: { id: 8901, nombre: 'Cuenta', apellido: 'QA', email: 'admin-product-polish@example.invalid', rol: { nombre: 'ADMIN' } },
    datosAntes: null, datosDespues: null,
  };
  const personalLog = { ...log, id: 30, entidadId: 'personal-document-30', accion: 'PERSONAL_UPLOAD', descripcion: 'Documento personal incorporado.' };
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return json(route, {
      id: 8901, nombre: 'Cuenta', apellido: 'QA', email: 'admin-product-polish@example.invalid',
      activo: true, rol: { id: 1, nombre: 'ADMIN' },
    });
    if (pathname === '/api/logs') {
      const url = new URL(route.request().url());
      requests.push({ entidad: url.searchParams.get('entidad'), accion: url.searchParams.get('accion') });
      return json(route, { data: [log, personalLog], meta: { page: 1, pageCount: 1, total: 2, pageSize: 20 } });
    }
    if (pathname === '/api/logs/29') return json(route, { data: log });
    if (pathname === '/api/logs/30') return json(route, { data: personalLog });
    return json(route, {});
  });

  await page.goto('/admin/logs');
  const logRow = page.getByRole('button', { name: 'Ver detalle del registro 29' });
  await expect(logRow.getByText('Documento compartido', { exact: true })).toBeVisible();
  await expect(logRow.getByText('Subir documento al espacio', { exact: true })).toBeVisible();
  await expect(page.getByText('WorkspaceDocument', { exact: true })).toHaveCount(0);
  const personalRow = page.getByRole('button', { name: 'Ver detalle del registro 30' });
  await expect(personalRow.getByText('Documento personal', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ver detalle del registro 29' }).click();
  const drawer = page.getByRole('dialog', { name: 'Detalle de auditoría' });
  await expect(drawer.getByText('Entidad: Documento compartido #document-29')).toBeVisible();
  await expect(drawer.getByText('Acción: Subir documento al espacio')).toBeVisible();
  await drawer.getByRole('button', { name: 'Cerrar' }).click();

  await page.getByLabel('Entidad').selectOption('WorkspaceDocument');
  await page.getByLabel('Acción').selectOption('WORKSPACE_DOCUMENT_UPLOAD');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect.poll(() => requests.at(-1)).toEqual({ entidad: 'WorkspaceDocument', accion: 'WORKSPACE_DOCUMENT_UPLOAD' });
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
        id: 'doc-polish-qa', title: '36508', status: 'INDEXED', caseNumber: '123/2024',
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
  await expect(page.getByText('Destino sugerido · referencia interna del fallo #19624 · expediente 123/2024')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir documento de origen' })).toHaveText('Ver documento de origen');
  await expect(page.getByText('36508', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/HIGH_CONFIDENCE|EXACT_LEGACY|strategies|\{"strategies"/u)).toHaveCount(0);
  await expect(page.getByText(/Todas requieren revisión humana/u)).toBeVisible();
});

test('workspace preview uses a full-width tablet detail view and a sequential mobile view @product-polish @workspace', async ({ page }) => {
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
  await expect(leftPanel).toBeHidden();
  await expect(results).toBeHidden();
  await expect(page.getByRole('button', { name: 'Volver a resultados' })).toBeVisible();
  const previewBounds = await preview.boundingBox();
  expect(previewBounds).not.toBeNull();
  expect(await preview.evaluate((element) => getComputedStyle(element).position)).toBe('relative');
  expect(previewBounds.width).toBeGreaterThan(600);
  await page.getByRole('button', { name: 'Volver a resultados' }).click();
  await expect(results).toBeVisible();
  await expect(preview).toBeHidden();

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

test('OCR queue labels numeric legacy titles and reviewer assignment without opening a job @product-polish @ocr', async ({ page }) => {
  await installAdminSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const methods = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    methods.push({ method: request.method(), pathname });
    if (pathname === '/api/auth/me') return json(route, {
      id: 8901, nombre: 'Cuenta', apellido: 'QA', email: 'admin-product-polish@example.invalid',
      activo: true, rol: { id: 1, nombre: 'ADMIN' },
    });
    if (pathname === '/api/ocr-human-review/runtime/diagnostics') return json(route, {
      process: { pid: 1, nodeVersion: 'v22', executable: 'node', workingDirectory: 'office', environment: 'production' },
      ocr: { enabled: false, available: false, enginePath: null, engineVersion: null, configuredLanguages: [], installedLanguages: [], spanishAvailable: false, tessdataDirectory: null, pathContainsEngineDirectory: false, rendererPath: null, rendererVersion: null, pathContainsRendererDirectory: false, temporaryDirectory: 'temp', timeoutMs: 1000, maximumPages: 3 },
    });
    if (pathname === '/api/ocr-human-review/queue') return json(route, {
      page: 1, pageSize: 25, total: 1, pageCount: 1, counts: { total: 1, unreviewed: 0, mine: 0, ready: 0 },
      results: [{ documentId: 'ocr-doc-25022', title: '25022', court: null, chamber: null, caseNumber: null, fileId: 'file-1', filename: 'scan.pdf', fileSha256: 'abc', pageCount: 7, reviewId: 'review-1', status: 'IN_REVIEW', assignedToId: 8902, hasApprovedVersion: false, approvedPages: 0 }],
    });
    return json(route, {});
  });

  await page.goto('/admin/jurisprudencia/ocr');
  const guide = page.locator('details').filter({ hasText: '¿Cuándo usar OCR?' });
  await expect(guide).toBeVisible();
  await expect.poll(() => guide.evaluate((element) => element.open)).toBe(false);
  const queueHeading = page.getByRole('heading', { name: 'Cola institucional' });
  await expect(queueHeading).toBeVisible();
  expect((await queueHeading.boundingBox())?.y, 'OCR review queue should appear early in the mobile viewport').toBeLessThan(650);
  await guide.locator('summary').click();
  await expect.poll(() => guide.evaluate((element) => element.open)).toBe(true);
  await expect(guide.getByText('El archivo original no se reemplaza.')).toBeVisible();
  await expect(page.getByText('Documento sin carátula · referencia #25022')).toBeVisible();
  await expect(page.getByText('Metadatos de carátula incompletos')).toBeVisible();
  await expect(page.getByText('En revisión · tomado por otro revisor')).toBeVisible();
  await expect(page.getByText('0 sin revisar · 0 listos para aprobar')).toBeVisible();
  expect(methods.some(({ method, pathname }) => method !== 'GET' && pathname.includes('/ocr-human-review/'))).toBe(false);
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.fixtureMisses).toEqual([]);
});

test('institutional PDF picker is localized and selecting a file does not upload it @product-polish @ingestion', async ({ page }) => {
  await installAdminSession(page);
  let uploadRequests = 0;
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return json(route, {
      id: 8901, nombre: 'Cuenta', apellido: 'QA', email: 'admin-product-polish@example.invalid',
      activo: true, rol: { id: 1, nombre: 'ADMIN' },
    });
    if (pathname === '/api/corpus/institutional-ingestions/upload') {
      uploadRequests += 1;
      return json(route, { statusCode: 500 }, 500);
    }
    if (pathname === '/api/corpus/institutional-ingestions') return json(route, {
      data: [], meta: { total: 0, page: 1, pageSize: 25, pageCount: 1, counters: { pending: 0, ocrRequired: 0, duplicates: 0, reviewRequired: 0, completed: 0 } },
    });
    return json(route, {});
  });

  await page.goto('/jurisprudencia/ingreso');
  await expect(page.getByText('Ningún archivo seleccionado')).toBeVisible();
  const input = page.locator('#institutional-pdf');
  await input.setInputFiles({ name: 'fallo-qa.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nQA') });
  await expect(page.locator('label[for="institutional-pdf"] [aria-live="polite"]')).toHaveText('fallo-qa.pdf');
  await expect(page.getByText('Seleccionar archivo PDF', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('No file chosen');
  await expect(page.getByRole('button', { name: 'Recibir PDF' })).toBeEnabled();
  expect(uploadRequests).toBe(0);
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.fixtureMisses).toEqual([]);
});

test('workspace shows OCR-required originals in the native PDF viewer @product-polish @workspace @ocr', async ({ page }) => {
  const reader = {
    id: 8903, nombre: 'Cuenta', apellido: 'Sala QA', email: 'ocr-reader-product-polish@example.invalid',
    activo: true, rol: { id: 6, nombre: 'LECTOR' },
  };
  const workspaceId = 'synthetic-ocr-pdf-sala';
  const documentId = 'synthetic-ocr-pdf-document';
  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-ocr-workspace-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, reader);
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return json(route, reader);
    if (pathname === '/api/workspaces/mine') return json(route, [{
      id: workspaceId, name: 'Sala OCR QA', code: 'SALA-OCR-QA', type: 'SALA', role: 'VIEWER',
    }]);
    if (pathname === `/api/workspaces/${workspaceId}/folders` || pathname === `/api/workspaces/${workspaceId}/search/sources`) return json(route, []);
    if (pathname === `/api/workspaces/${workspaceId}/documents/${documentId}/file`) {
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: makePdfFixture() });
    }
    if (pathname === `/api/workspaces/${workspaceId}/documents/${documentId}`) return json(route, {
      id: documentId, title: 'Sentencia escaneada', status: 'OCR_REQUIRED',
      file: { filename: 'sentencia-sin-texto.pdf', mimeType: 'application/pdf', pageCount: 1 },
      extraction: { status: 'REVIEW_REQUIRED', pageCount: 1 },
      selectedPage: { pageNumber: 1, text: '', textKind: null },
    });
    if (pathname.startsWith(`/api/workspaces/${workspaceId}/documents`)) return json(route, {
      page: 1, pageSize: 20, total: 1,
      results: [{ createdAt: '2026-10-29T12:00:00.000Z', folder: null, document: {
        id: documentId, title: 'Sentencia escaneada', status: 'OCR_REQUIRED',
        file: { filename: 'sentencia-sin-texto.pdf', mimeType: 'application/pdf', pageCount: 1 },
      } }],
    });
    return json(route, {});
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/spaces?workspaceId=${workspaceId}`);
  await page.getByRole('button', { name: 'Vista previa de sentencia-sin-texto.pdf' }).click();
  const preview = page.getByRole('complementary', { name: 'Vista previa del documento' });
  const nativePdf = preview.getByTitle('PDF original: sentencia-sin-texto.pdf');
  await expect(nativePdf).toBeVisible();
  expect(await nativePdf.evaluate((frame) => frame.getBoundingClientRect().height)).toBeGreaterThan(300);
  await expect(preview.getByText('PDF original · navegación del visor')).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Página siguiente' })).toBeHidden();
  await expect(preview.locator('canvas')).toHaveCount(0);
  await expect(preview.getByText('Todavía no se puede buscar dentro de este PDF porque requiere reconocimiento de texto (OCR). El original sigue disponible para leerlo.')).toBeVisible();
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.fixtureMisses).toEqual([]);
});

test('workspace search explains OCR coverage and distinguishes body, filename, and metadata matches @product-polish @workspace @search', async ({ page }) => {
  const reader = {
    id: 8904, nombre: 'Cuenta', apellido: 'Workspace QA', email: 'search-workspace-product-polish@example.invalid',
    activo: true, rol: { id: 6, nombre: 'LECTOR' },
  };
  const workspaceId = 'synthetic-search-coverage-sala';
  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-search-coverage-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, reader);
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const requestUrl = new URL(route.request().url());
    if (pathname === '/api/auth/me') return json(route, reader);
    if (pathname === '/api/workspaces/mine') return json(route, [{
      id: workspaceId, name: 'Sala QA', code: 'SALA-QA', type: 'SALA', role: 'VIEWER',
    }]);
    if (pathname === `/api/workspaces/${workspaceId}/folders` || pathname === `/api/workspaces/${workspaceId}/search/sources`) return json(route, []);
    if (pathname === `/api/workspaces/${workspaceId}/search`) {
      const q = requestUrl.searchParams.get('q');
      const results = q === 'civil'
        ? [
            {
              id: 'CORPUS:DOCUMENT:native', sourceId: 'native-pdf', title: 'fallo-nativo.pdf',
              snippet: '... responsabilidad civil por daño moral ...', document: { mimeType: 'application/pdf' },
              metadata: { filename: 'fallo-nativo.pdf', pageNumber: 2, matchSource: 'PDF_TEXT', status: 'INDEXED', folderName: 'Todos los documentos' },
            },
            {
              id: 'CORPUS:DOCUMENT:ocr', sourceId: 'approved-ocr-pdf', title: 'fallo-ocr-revisado.pdf',
              snippet: '... daños y perjuicios de naturaleza civil ...', document: { mimeType: 'application/pdf' },
              metadata: { filename: 'fallo-ocr-revisado.pdf', pageNumber: 5, matchSource: 'OCR_APPROVED', status: 'INDEXED', folderName: 'Todos los documentos' },
            },
          ]
        : [];
      return json(route, {
        total: results.length, totalExact: true, hasMore: false, page: 1, pageSize: 20, results,
        documentCoverage: { textAvailableDocuments: 17, ocrRequiredDocuments: 3, otherUnavailableDocuments: 2 },
      });
    }
    if (pathname === `/api/workspaces/${workspaceId}/search/names`) {
      const q = requestUrl.searchParams.get('q');
      if (q === 'filename-match') return json(route, {
        total: 1, totalExact: true, page: 1, pageSize: 20,
        results: [{ documentId: 'filename-hit', title: 'Fallo de ejemplo', filename: 'filename-match.pdf', mimeType: 'application/pdf', status: 'INDEXED', uploadedAt: '2026-10-29T12:00:00.000Z', folder: null, matchedIn: ['FILENAME'] }],
      });
      if (q === 'metadata-match') return json(route, {
        total: 1, totalExact: true, page: 1, pageSize: 20,
        results: [{ documentId: 'metadata-hit', title: 'metadata-match', filename: 'fallo-por-expediente.pdf', mimeType: 'application/pdf', status: 'INDEXED', uploadedAt: '2026-10-29T12:00:00.000Z', folder: null, matchedIn: ['TITLE'] }],
      });
      return json(route, { total: 0, totalExact: true, page: 1, pageSize: 20, results: [] });
    }
    return json(route, {});
  });

  const coverage = page.getByRole('region', { name: 'Disponibilidad de texto en el espacio' });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/spaces?workspaceId=${workspaceId}&q=sinresultado`);
    await expect(page.getByRole('heading', { name: 'Sin coincidencias en el texto disponible' })).toBeVisible();
    await expect(page.getByText('3 PDF todavía requieren OCR.')).toBeVisible();
    await expect(page.getByText('Ese contenido no participa en esta búsqueda; los originales siguen disponibles para abrirlos.')).toBeVisible();
    await expect(coverage).toContainText('17');
    await expect(coverage).toContainText('3');
    await expect(coverage).toContainText('El texto indexado puede ser nativo o provenir de OCR aprobado.');
    await expect(page.getByRole('main', { name: 'Búsqueda y resultados' })).not.toContainText('0 coincidencias por contenido');
    expect(await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth), `workspace search should not overflow at ${viewport.width}px`).toBe(true);
  }

  await page.goto(`/spaces?workspaceId=${workspaceId}&q=civil`);
  const nativeResult = page.getByRole('listitem').filter({ hasText: 'fallo-nativo.pdf' });
  const approvedResult = page.getByRole('listitem').filter({ hasText: 'fallo-ocr-revisado.pdf' });
  await expect(nativeResult).toContainText('Texto nativo · pág. 2');
  await expect(approvedResult).toContainText('OCR aprobado · pág. 5');
  await expect(nativeResult).toContainText('responsabilidad civil por daño moral');
  await expect(approvedResult).toContainText('daños y perjuicios de naturaleza civil');

  await page.goto(`/spaces?workspaceId=${workspaceId}&q=filename-match`);
  await expect(page.getByRole('listitem').filter({ hasText: 'filename-match.pdf' })).toContainText('Nombre de archivo');
  await page.goto(`/spaces?workspaceId=${workspaceId}&q=metadata-match`);
  await expect(page.getByRole('listitem').filter({ hasText: 'fallo-por-expediente.pdf' })).toContainText('Metadatos');
  expect(page.__uxQaDiagnostics.pageErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.networkErrors).toEqual([]);
  expect(page.__uxQaDiagnostics.fixtureMisses).toEqual([]);
});

test('mobile navigation moves focus into the drawer and restores it after Escape @product-polish @sidebar', async ({ page }) => {
  await installAdminSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return json(route, {
      id: 8901, nombre: 'Cuenta', apellido: 'QA', email: 'admin-product-polish@example.invalid',
      activo: true, rol: { id: 1, nombre: 'ADMIN' },
    });
    return json(route, { data: [], meta: { page: 1, pageCount: 1, total: 0, pageSize: 25 } });
  });

  await page.goto('/consulta');
  const trigger = page.locator('button[aria-controls="galilei-primary-navigation"]');
  await expect(trigger.locator('svg[class*="menuIcon"]')).toHaveAttribute('aria-hidden', 'true');
  await trigger.click();
  const primaryNavigation = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(primaryNavigation.locator('svg')).toHaveCount(4);
  await expect(primaryNavigation.getByRole('link', { name: 'Jurisprudencia' })).toBeVisible();
  await expect(primaryNavigation.getByRole('link').first()).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
  await expect(page.locator('aside').first()).toHaveCSS('visibility', 'hidden');
});

test('search dates display dd/mm/yyyy and submit ISO query values @product-polish @dates', async ({ page }) => {
  await installAdminSession(page);
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return json(route, {
      id: 8901, nombre: 'Cuenta', apellido: 'QA', email: 'admin-product-polish@example.invalid',
      activo: true, rol: { id: 1, nombre: 'ADMIN' },
    });
    return json(route, { data: [], meta: { page: 1, pageCount: 1, total: 0, pageSize: 25 } });
  });

  await page.goto('/consulta');
  await expect(page.getByText('No encontramos fallos con estos criterios.')).toBeVisible();
  const from = page.getByLabel('Fecha desde (dd/mm/aaaa)');
  const to = page.getByLabel('Fecha hasta (dd/mm/aaaa)');
  await expect(from).toHaveAttribute('placeholder', 'dd/mm/aaaa');
  await expect(to).toHaveAttribute('placeholder', 'dd/mm/aaaa');
  await from.fill('29022024');
  await to.fill('01032024');
  await expect(from).toHaveValue('29/02/2024');
  await expect(to).toHaveValue('01/03/2024');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page).toHaveURL(/fechaDesde=2024-02-29/u);
  await expect(page).toHaveURL(/fechaHasta=2024-03-01/u);

  await from.fill('31022024');
  await expect(from).toHaveValue('31/02/2024');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Ingresá fechas válidas en formato dd/mm/aaaa.');
  await expect(page).toHaveURL(/fechaDesde=2024-02-29/u);
});

test('mobile search keeps the query first and folds optional filters and management actions @product-polish @mobile-search', async ({ page }) => {
  await installAdminSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return json(route, {
      id: 8901, nombre: 'Cuenta', apellido: 'QA', email: 'admin-product-polish@example.invalid',
      activo: true, rol: { id: 1, nombre: 'ADMIN' },
    });
    return json(route, { data: [], meta: { page: 1, pageCount: 1, total: 0, pageSize: 25 } });
  });

  await page.route('**/api/public/busqueda**', async (route) => {
    if (new URL(route.request().url()).pathname !== '/api/public/busqueda') return route.fallback();
    return json(route, {
      data: [{
        id: 9001, sentenciaId: 9001, slugPublico: 'responsabilidad-civil-qa',
        numeroSentencia: '12/2024', fecha: '2024-06-03T12:00:00.000Z', sala: 'C',
        tipoFallo: 'Sentencia', expediente: 'CIV 10/2024', caratula: 'Caso de prueba: responsabilidad civil',
        tema: 'Responsabilidad civil', textoSumario: 'Daño y responsabilidad civil en un caso de prueba.',
        highlights: [], tienePdf: false, score: 1, matchInfo: {}, matchedFields: ['textoSumario'],
      }],
      meta: { page: 1, pageCount: 1, total: 1, pageSize: 25, facets: { salas: [], years: [] } },
    });
  });

  await page.goto('/consulta?q=responsabilidad%20civil');
  await expect(page.getByLabel('Buscar jurisprudencia')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buscar', exact: true })).toBeVisible();
  const pageTitle = page.getByRole('heading', { name: 'Jurisprudencia', exact: true });
  await expect(pageTitle).toBeVisible();
  const titleHeight = await pageTitle.evaluate((element) => element.getBoundingClientRect().height);
  expect(titleHeight, 'mobile Search heading should not break within the word').toBeLessThan(35);
  await expect(page.getByLabel('Tema')).toBeHidden();
  await expect(page.getByLabel('Fecha desde (dd/mm/aaaa)')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Consejos de búsqueda' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Guardar búsqueda' })).toHaveCount(0);
  const resultTitle = page.getByRole('heading', { name: 'Caso de prueba: responsabilidad civil' });
  await expect(resultTitle).toBeVisible();
  const resultTop = await resultTitle.evaluate((element) => element.getBoundingClientRect().top);
  expect(resultTop, 'first Search result should appear earlier in the mobile viewport').toBeLessThan(640);
  await expect(page.getByRole('button', { name: 'Copiar enlace de búsqueda' })).toBeHidden();

  const filtersToggle = page.locator('button[aria-controls="public-search-filters"]');
  await expect(filtersToggle).toHaveAttribute('aria-expanded', 'false');
  await filtersToggle.click();
  await expect(filtersToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Tema')).toBeVisible();
  await expect(page.getByLabel('Fecha desde (dd/mm/aaaa)')).toBeVisible();

  const management = page.locator('details').filter({ has: page.getByText('Acciones de gestión') });
  await expect(management).toBeVisible();
  await expect(management.getByRole('link')).toHaveCount(0);
  await management.locator('summary').click();
  await expect(management.getByRole('link')).toHaveCount(3);
  const moreActions = page.locator('details[class*="mobileSearchActions"]');
  await expect(moreActions).toBeVisible();
  await expect(moreActions.getByRole('button')).toHaveCount(0);
  await moreActions.locator('summary').click();
  await expect(moreActions.getByRole('button')).toHaveCount(4);
  await expect(moreActions.getByRole('button', { name: 'Copiar enlace' })).toBeVisible();

  await filtersToggle.click();
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByLabel('Tema')).toBeHidden();
  const tabletResultTop = await resultTitle.evaluate((element) => element.getBoundingClientRect().top);
  expect(tabletResultTop, 'first Search result should remain early in the tablet viewport').toBeLessThan(800);
  expect(await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByLabel('Tema')).toBeHidden();
  const desktopResultTop = await resultTitle.evaluate((element) => element.getBoundingClientRect().top);
  expect(desktopResultTop, 'first Search result should be visible sooner on desktop').toBeLessThan(800);
  await filtersToggle.click();
  await expect(filtersToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Tema')).toBeVisible();

  await page.goto('/consulta?q=responsabilidad%20civil&fechaDesde=2024-02-01');
  await expect(page.getByLabel('Fecha desde (dd/mm/aaaa)')).toBeVisible();
  await expect(page.getByLabel('Fecha desde (dd/mm/aaaa)')).toHaveValue('01/02/2024');
});

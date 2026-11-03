'use strict';

const { expect } = require('@playwright/test');
const { test } = require('../ux-qa/fixtures-playwright.cjs');

const QA_USER = {
  id: 8920,
  nombre: 'Cuenta',
  apellido: 'QA Personal',
  email: 'personal-preview-qa@example.invalid',
  activo: true,
  rol: { id: 1, nombre: 'ADMIN' },
};

function makePdf(pages) {
  const fontId = 3 + pages.length * 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  ];
  for (const [index, text] of pages.entries()) {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    const stream = `BT /F1 18 Tf 72 700 Td (${text.replace(/[\\()]/gu, '\\$&')}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n%Synthetic personal PDF preview fixture\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

async function mountPersonalPdf(page, pages) {
  const pdf = makePdf(pages);
  const fileResponses = [];
  await page.addInitScript((user) => {
    localStorage.setItem('jurisprudencia_token', 'synthetic-personal-preview-token');
    localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
  }, QA_USER);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: QA_USER }));
  await page.route('**/api/workspaces/mine', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/personal/folders**', (route) => route.fulfill({ json: [] }));
  await page.route(/\/api\/personal\/documents\?(?:.*)$/u, (route) => route.fulfill({ json: [{
    documentId: 'synthetic-personal-pdf-1',
    createdAt: '2026-11-03T12:00:00.000Z',
    folder: null,
    document: {
      title: 'PDF personal sintético',
      status: 'INDEXED',
      file: { filename: 'PDF personal sintético.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length },
      extraction: { status: 'TEXT_EXTRACTED', pageCount: pages.length },
    },
  }] }));
  await page.route('**/api/personal/documents/synthetic-personal-pdf-1/file', async (route) => {
    fileResponses.push({ status: 200, contentType: 'application/pdf' });
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: pdf });
  });
  await page.route('**/api/personal/documents/synthetic-personal-pdf-1/structure', (route) => route.fulfill({
    json: { data: { status: 'NO_STRUCTURE', sections: [] } },
  }));
  return fileResponses;
}

test('la vista previa personal renderiza páginas, permite cerrar y volver a abrir @personal-preview', async ({ page }) => {
  const fileResponses = await mountPersonalPdf(page, ['PERSONAL QA PAGE ONE', 'PERSONAL QA PAGE TWO']);
  await page.goto('/personal');
  await expect(page.getByRole('heading', { name: 'Mis documentos', exact: true })).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'PDF personal sintético.pdf' });
  await row.getByRole('button', { name: 'Vista previa' }).click();
  await expect(page.getByText('Página 1 de 2')).toBeVisible();
  await expect(page.getByTestId('pdf-viewer-ready')).toBeVisible();
  let canvas = page.locator('[data-testid="personal-pdf-preview"] canvas');
  await expect(canvas).toBeVisible();
  let dimensions = await canvas.boundingBox();
  expect(dimensions?.width).toBeGreaterThan(100);
  expect(dimensions?.height).toBeGreaterThan(100);
  await expect.poll(async () => await canvas.evaluate((element) => element.toDataURL().length)).toBeGreaterThan(100);

  await page.getByRole('button', { name: 'Página siguiente' }).click();
  await expect(page.getByText('Página 2 de 2')).toBeVisible();
  await expect(page.getByTestId('pdf-viewer-ready')).toContainText('página 2');
  await page.getByRole('button', { name: 'Página anterior' }).click();
  await expect(page.getByText('Página 1 de 2')).toBeVisible();

  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.getByText('La vista previa se abrirá acá.')).toBeVisible();
  await row.getByRole('button', { name: 'Vista previa' }).click();
  await expect(page.getByText('Página 1 de 2')).toBeVisible();
  await expect(page.getByTestId('pdf-viewer-ready')).toBeVisible();
  expect(fileResponses).toHaveLength(2);
  expect(fileResponses.every((response) => response.status === 200 && response.contentType === 'application/pdf')).toBe(true);

  await page.reload();
  const refreshedRow = page.getByRole('listitem').filter({ hasText: 'PDF personal sintético.pdf' });
  await refreshedRow.getByRole('button', { name: 'Vista previa' }).click();
  await expect(page.getByText('Página 1 de 2')).toBeVisible();
  await expect(page.getByTestId('pdf-viewer-ready')).toBeVisible();
  expect(fileResponses).toHaveLength(3);
  const diagnostics = page.__uxQaDiagnostics;
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.networkErrors).toEqual([]);
  expect(diagnostics.fixtureMisses).toEqual([]);
});

test('la vista previa de una sola página muestra el PDF dentro del panel @personal-preview', async ({ page }) => {
  await mountPersonalPdf(page, ['PERSONAL QA ONE-PAGE PDF']);
  await page.goto('/personal');
  const row = page.getByRole('listitem').filter({ hasText: 'PDF personal sintético.pdf' });
  await row.getByRole('button', { name: 'Vista previa' }).click();
  await expect(page.getByText('Página 1 de 1')).toBeVisible();
  await expect(page.getByTestId('pdf-viewer-ready')).toBeVisible();
  const canvas = page.locator('[data-testid="personal-pdf-preview"] canvas');
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  expect(bounds?.width).toBeGreaterThan(100);
  expect(bounds?.height).toBeGreaterThan(100);
});

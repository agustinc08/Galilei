import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const credentials = JSON.parse(readFileSync(resolve(process.cwd(), '../_recovery-work/sprint10/acceptance/credentials.json'), 'utf8')) as {
  accounts: Record<string, { email: string; password: string }>;
};
const apiBase = 'http://127.0.0.1:4001/api';
const artifactRoot = resolve(process.cwd(), '../_recovery-work/jurisprudencia-j901');
const marker = `J9VALIDACIONUNICA${Date.now()}`;

function makePdf(text: string) {
  const escaped = text.replace(/\\/gu, '\\\\').replace(/\(/gu, '\\(').replace(/\)/gu, '\\)');
  const stream = `BT /F1 11 Tf 48 760 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n%J9 synthetic fixture\n';
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

async function signIn(page: import('@playwright/test').Page, account: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(account.email);
  await page.getByLabel('Contraseña').fill(account.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15_000 });
}

test('J9.0.1 operator valid PDF lifecycle is visible to readers then archived', async ({ page, request }) => {
  test.setTimeout(300_000);
  mkdirSync(artifactRoot, { recursive: true });
  const expediente = `CIV-${marker}/2026`;
  const numeroSentencia = `J9-${marker}/2026`;
  const pdf = makePdf(`${expediente} Camara Nacional de Apelaciones en lo Civil Sala H Responsabilidad civil y dano moral ${marker}. Demandante de prueba Demandado de prueba.`);
  const pdfSha256 = createHash('sha256').update(pdf).digest('hex');
  let sentenceId: number | null = null;
  let publicSlug = '';
  const evidence: Record<string, unknown> = { marker, pdfSha256, pdfBytes: pdf.length, statuses: {} };

  await signIn(page, credentials.accounts.operator);
  await page
    .getByRole('navigation', { name: 'Secciones principales' })
    .getByRole('link', { name: /Jurisprudencia/u })
    .click();
  await page.getByRole('button', { name: '+ Nuevo fallo' }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'fallo-j901-sintetico.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByRole('button', { name: 'Subir PDF y continuar' }).click();
  await expect(page.getByRole('button', { name: 'Completar datos del fallo' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Completar datos del fallo' }).click();
  await expect(page.getByRole('heading', { name: /Fallo|Sentencia #/u })).toBeVisible();
  sentenceId = Number(new URL(page.url()).pathname.split('/').filter(Boolean).at(-1));
  await page.screenshot({ path: resolve(artifactRoot, 'operator-new-valid-upload.png'), fullPage: true });

  await page.getByLabel('Nº de sentencia').fill(numeroSentencia);
  await page.getByLabel('Tipo de fallo').fill('Sentencia civil');
  await page.getByLabel('Sala').fill('Sala H');
  await page.getByLabel('Fecha').fill('2026-10-14');
  await page.getByLabel('Expediente').fill(expediente);
  await page.getByLabel('Tribunal de origen').fill('Cámara Nacional de Apelaciones en lo Civil');
  await page.getByLabel('Carátula').fill(`Demandante de prueba c/ Demandado de prueba s/ danos ${marker}`);
  await page.getByLabel('Actor').fill('Demandante de prueba');
  await page.getByLabel('Demandado').fill('Demandado de prueba');
  await page.getByLabel('Objeto').fill(`Responsabilidad civil y dano moral ${marker}`);
  await page.getByLabel('Magistrados').fill('Magistrada de prueba');
  const metadataSave = page.waitForResponse((response) =>
    response.url().includes(`/api/sentencias/${sentenceId}`) && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  expect((await metadataSave).status()).toBe(200);
  await page.reload();
  await expect(page.getByLabel('Carátula')).toHaveValue(new RegExp(marker));
  await page.screenshot({ path: resolve(artifactRoot, 'operator-draft.png'), fullPage: true });

  await page.goto(`/sentencias?activo=true&expediente=${encodeURIComponent(expediente)}`);
  await expect(page.getByRole('heading', { name: new RegExp(marker) })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'Editar fallo', exact: true }).first().click();
  await expect(page.getByLabel('Carátula')).toHaveValue(new RegExp(marker));

  const draftSearch = await request.get(`${apiBase}/public/busqueda?q=${marker}`);
  expect((await draftSearch.json()).meta.total).toBe(0);
  const draftDirect = await request.get(`${apiBase}/public/sentencias/${sentenceId}`);
  expect(draftDirect.status()).toBe(404);
  const readerLogin = await request.post(`${apiBase}/auth/login`, { data: credentials.accounts.reader });
  expect(readerLogin.ok()).toBeTruthy();
  const readerToken = (await readerLogin.json()).accessToken as string;
  const readerDirect = await request.get(`${apiBase}/sentencias/${sentenceId}/completa`, { headers: { Authorization: `Bearer ${readerToken}` } });
  expect(readerDirect.status()).toBe(403);
  evidence.statuses = { upload: 'PASS', metadata: 'PASS', draftSearchVisible: 0, draftDirect: draftDirect.status() };

  await expect(page.getByLabel('Carátula')).toHaveValue(new RegExp(marker));
  await expect(page.getByLabel('Expediente')).toHaveValue(expediente);
  await page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Publicar fallo' }).click();
  await expect(page.getByText('Sentencia publicada.')).toBeVisible();
  await page.screenshot({ path: resolve(artifactRoot, 'operator-published.png'), fullPage: true });

  let publishedBody: { meta: { total: number }; data: Array<{ esFalloCorpus: boolean; extractoFallo: string | null; slugPublico: string }> };
  await expect.poll(async () => {
    const publishedSearch = await request.get(`${apiBase}/public/busqueda?q=${marker}`);
    publishedBody = await publishedSearch.json();
    return publishedBody.meta.total;
  }, { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] }).toBe(1);
  expect(publishedBody!.data[0].esFalloCorpus).toBe(true);
  expect(publishedBody!.data[0].extractoFallo).toContain(marker);
  publicSlug = publishedBody!.data[0].slugPublico;
  evidence.statuses = { ...(evidence.statuses as object), publish: 'PASS', search: 'PASS', publicSlug };

  await page.evaluate(() => localStorage.clear());
  await signIn(page, credentials.accounts.reader);
  await page.goto(`/consulta?q=${marker}`);
  await expect(page.getByText('1 resultado', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Extracto del fallo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: resolve(artifactRoot, 'reader-published-result.png'), fullPage: true });
  const viewerStartedAt = Date.now();
  await page.goto(`/consulta/sentencia/${publicSlug}/documento`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  evidence.viewerFirstDisplayMs = Date.now() - viewerStartedAt;
  await page.screenshot({ path: resolve(artifactRoot, 'viewer-valid-upload.png'), fullPage: true });
  const pdfResponse = await request.get(`${apiBase}/public/sentencias/${publicSlug}/pdf`);
  expect(pdfResponse.status()).toBe(200);
  expect((await pdfResponse.body()).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  evidence.statuses = { ...(evidence.statuses as object), reader: 'PASS', detail: 'PASS', viewer: 'PASS', download: 'PASS' };

  await page.evaluate(() => localStorage.clear());
  await signIn(page, credentials.accounts.operator);
  await page.goto(`/sentencias?publicado=true&activo=true&expediente=${encodeURIComponent(expediente)}`);
  await expect(page.getByRole('heading', { name: new RegExp(marker) })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'Editar fallo', exact: true }).first().click();
  await page.waitForURL(new RegExp(`/sentencias/${sentenceId}$`, 'u'));
  await page.getByLabel('Objeto').fill(`Objeto editado ${marker}`);
  const editSave = page.waitForResponse((response) =>
    response.url().includes(`/api/sentencias/${sentenceId}`) && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  expect((await editSave).status()).toBe(200);
  const editedQuery = `Objeto editado ${marker}`;
  await expect.poll(async () => {
    const edited = await request.get(`${apiBase}/public/busqueda`, { params: { q: editedQuery } });
    const body = await edited.json() as { data: Array<{ expediente: string }> };
    return body.data.some((row) => row.expediente === expediente);
  }, { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] }).toBe(true);
  await page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Archivar' }).click();
  await expect(page.getByText('Fallo archivado.')).toBeVisible();
  await expect.poll(async () => {
    const afterArchive = await request.get(`${apiBase}/public/busqueda`, { params: { q: marker } });
    const body = await afterArchive.json() as { meta: { total: number } };
    return body.meta.total;
  }, { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] }).toBe(0);
  evidence.statuses = { ...(evidence.statuses as object), edit: 'PASS', archive: 'PASS', afterArchive: 0 };
  evidence.sentenceId = sentenceId;
  evidence.publicSlug = publicSlug;
  writeFileSync(resolve(artifactRoot, 'valid-upload-e2e.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  await page.goto('/sentencias/nueva');
  await page.locator('input[type="file"]').setInputFiles({ name: 'fallo-j901-sintetico-duplicado.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByRole('button', { name: 'Subir PDF y continuar' }).click();
  await expect(page.getByText('Este archivo ya fue incorporado. Revisa el fallo existente antes de volver a cargarlo.')).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: resolve(artifactRoot, 'duplicate-e2e.png'), fullPage: true });
});

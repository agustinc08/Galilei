import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const credentials = JSON.parse(readFileSync(resolve(process.cwd(), '../../_recovery-work/sprint10/acceptance/credentials.json'), 'utf8')) as {
  accounts: Record<string, { email: string; password: string }>;
};
const apiBase = 'http://localhost:4001/api';

async function signIn(page: import('@playwright/test').Page, account: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(account.email);
  await page.getByLabel('Contraseña').fill(account.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
}

test('J9 lector entra a Jurisprudencia, filtra sin controles de operador y mantiene la consulta', async ({ page, request }) => {
  await signIn(page, credentials.accounts.reader);
  const navigation = page.getByRole('navigation', { name: 'Secciones principales' });
  await expect(navigation.getByRole('link', { name: /Jurisprudencia/u })).toBeVisible();
  await navigation.getByRole('link', { name: /Jurisprudencia/u }).click();
  await expect(page).toHaveURL(/\/consulta$/u);
  await expect(page.getByRole('heading', { name: 'Jurisprudencia', exact: true })).toBeVisible();
  await expect(page.getByLabel('TemaTodos los temas')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Sala' })).toBeVisible();
  await expect(page.getByLabel('Fecha desde')).toBeVisible();
  await expect(page.getByLabel('Fecha hasta')).toBeVisible();
  await expect(page.getByLabel('Tipo de fallo')).toBeVisible();
  await expect(page.getByLabel('Expediente')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Nuevo fallo' })).toHaveCount(0);
  await expect(page.getByText('Últimos fallos publicados')).toBeVisible();
  await expect(page.getByText('6.014 resultados', { exact: true })).toBeVisible();
  await expect(page.getByText('Fallo civil').first()).toBeVisible();

  const first = await request.get(`${apiBase}/public/busqueda?page=1&pageSize=300`);
  const firstPage = await first.json();
  expect(firstPage.meta.total).toBeGreaterThan(100);
  expect(firstPage.meta.pageSize).toBe(100);
  expect(firstPage.data).toHaveLength(100);
  const second = await (await request.get(`${apiBase}/public/busqueda?page=2&pageSize=300`)).json();
  expect(second.meta.page).toBe(2);
  expect(second.data).toHaveLength(100);
  const last = await (await request.get(`${apiBase}/public/busqueda?page=${firstPage.meta.pageCount}&pageSize=300`)).json();
  expect(last.meta.page).toBe(firstPage.meta.pageCount);
  expect(last.data.length).toBeGreaterThan(0);
  const ids = [...firstPage.data, ...second.data, ...last.data].map((item: { sentenciaId: number }) => item.sentenciaId);
  expect(new Set(ids).size).toBe(ids.length);
  const salaWithResults = firstPage.data.find((item: { sala?: string | null }) => item.sala)?.sala;
  expect(salaWithResults).toBeTruthy();

  for (const params of [
    'expediente=CIV%20072119%2F2022',
    'caratula=AIZAMA',
    `sala=${encodeURIComponent(salaWithResults)}`,
    'tipoFallo=JURISPRUDENCIA',
    'fechaDesde=2026-10-08&fechaHasta=2026-10-08',
  ]) {
    const filtered = await (await request.get(`${apiBase}/public/busqueda?${params}&pageSize=5`)).json();
    expect(filtered.meta.total, params).toBeGreaterThan(0);
  }

  const screenshotRoot = resolve(process.cwd(), '../../_recovery-work/jurisprudencia-j901');
  mkdirSync(screenshotRoot, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: resolve(screenshotRoot, 'jurisprudence-search-real-data.png'), fullPage: true });
  await page.screenshot({ path: resolve(screenshotRoot, 'reader-result.png'), fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: resolve(process.cwd(), '../../_recovery-work/jurisprudencia-j9/reader-search-1920.png'), fullPage: true });

  await page.getByRole('button', { name: 'Más filtros' }).click();
  await expect(page.getByLabel('N° sumario')).toBeVisible();
  await page.getByLabel('Expediente').fill('EXP-J9-SINTETICO');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page).toHaveURL(/expediente=EXP-J9-SINTETICO/u);
  await expect(page.getByText('No encontramos fallos con estos criterios.')).toBeVisible();

  const login = await request.post(`${apiBase}/auth/login`, { data: credentials.accounts.reader });
  expect(login.ok()).toBeTruthy();
  const token = (await login.json()).accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  for (const [method, route] of [
    ['POST', '/sentencias'], ['PATCH', '/sentencias/1'], ['PATCH', '/sentencias/1/publicar'],
    ['PATCH', '/sentencias/1/archivar'], ['DELETE', '/sentencias/1'], ['POST', '/archivos/upload/jurisprudencia'],
  ] as const) {
    const response = await request.fetch(`${apiBase}${route}`, { method, headers });
    expect(response.status(), `${method} ${route}`).toBe(403);
  }
});

test('J9 operator can reach PDF-first intake and invalid file is rejected', async ({ page }) => {
  await signIn(page, credentials.accounts.operator);
  await page.getByRole('navigation', { name: 'Secciones principales' })
    .getByRole('link', { name: /Jurisprudencia/u }).click();
  await expect(page.getByRole('button', { name: '+ Nuevo fallo' })).toBeVisible();
  await expect(page.getByText('Buscando fallos…')).toHaveCount(0, { timeout: 30_000 });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({
    path: resolve(process.cwd(), '../../_recovery-work/integration-int1/screenshots/operator-jurisprudencia.png'),
    fullPage: false,
  });
  await page.getByRole('button', { name: '+ Nuevo fallo' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo fallo' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: 'not-a-pdf.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await page.getByRole('button', { name: 'Subir PDF y continuar' }).click();
  await expect(page.getByText('No pudimos procesar este archivo. Comprueba que sea un PDF válido y vuelve a intentarlo.')).toBeVisible();
});

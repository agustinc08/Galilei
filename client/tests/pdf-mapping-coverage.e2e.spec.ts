import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const recoveryRoot = resolve(process.cwd(), '../_recovery-work/sprint1533');
const credentialsPath = resolve(process.cwd(), '../_recovery-work/sprint10/acceptance/credentials.json');
const sourceSamplePath = resolve(recoveryRoot, 'raw-sample-input.json');
const mappingReportPath = resolve(recoveryRoot, 'real-mapping-results.json');
const recoveryEvidenceAvailable = [credentialsPath, sourceSamplePath, mappingReportPath].every(existsSync);
const credentials = (existsSync(credentialsPath)
  ? JSON.parse(readFileSync(credentialsPath, 'utf8'))
  : { accounts: {} }) as {
  accounts: Record<string, { email: string; password: string }>;
};
const sourceSample = (existsSync(sourceSamplePath)
  ? JSON.parse(readFileSync(sourceSamplePath, 'utf8'))
  : { documents: [] }) as {
  documents: Array<{ documentId: string; pages: Array<{ pageNumber: number; text: string }> }>;
};
const mappingReport = (existsSync(mappingReportPath)
  ? JSON.parse(readFileSync(mappingReportPath, 'utf8'))
  : { results: [] }) as {
  results: Array<{
    documentId: string;
    page: number;
    start: number;
    end: number;
    queryType: string;
    status: string;
    priorStatus: string;
    matchSha256: string;
  }>;
};
const apiBase = 'http://127.0.0.1:4001/api';

type ApiMatch = {
  page: number;
  start: number;
  end: number;
  text: string;
  ordinal: number;
  pageOccurrenceOrdinal: number;
};

function normalized(value: string) {
  return value.toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/n\u0303/gu, '\uE000')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\uE000/gu, 'ñ')
    .normalize('NFC')
    .replace(/\s+/gu, ' ');
}

function nonWhitespace(value: string) {
  return normalized(value).replace(/\s/gu, '');
}

function sourcePage(documentId: string, pageNumber: number) {
  return sourceSample.documents.find((item) => item.documentId === documentId)
    ?.pages.find((page) => page.pageNumber === pageNumber)?.text;
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.accounts.reader.email);
  await page.getByLabel('Contraseña').fill(credentials.accounts.reader.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/busqueda-avanzada$/);
}

async function authorizedMatches(request: APIRequestContext, documentId: string, query: string, headers: Record<string, string>) {
  const response = await request.get(`${apiBase}/corpus/documents/${documentId}/matches`, {
    headers,
    params: { q: query },
  });
  if (!response.ok()) return [] as ApiMatch[];
  const body = await response.json() as { matches?: ApiMatch[] };
  return body.matches ?? [];
}

async function activeMarkMatches(page: Page, expected: string) {
  const mark = page.locator('.bjc-pdf-match-current');
  await expect.poll(async () => (await mark.count()) > 0, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => nonWhitespace((await mark.allTextContents()).join('')), {
    timeout: 30_000,
    message: 'the active PDF text mark should contain the expected match after rendering settles',
  }).toBe(nonWhitespace(expected));
  await expect(mark.first()).toHaveCSS('background-color', 'rgb(251, 146, 60)');
}

async function pickRecoveredTermCases(request: APIRequestContext, headers: Record<string, string>, limit: number) {
  const candidates = mappingReport.results.filter((row) =>
    row.queryType === 'TERM' && row.priorStatus === 'UNMAPPABLE' &&
    ['NORMALIZED_EXACT', 'SEGMENTED_EXACT'].includes(row.status),
  );
  const viable: Array<{ row: typeof candidates[number]; text: string; apiMatch: ApiMatch }> = [];
  const usedDocuments = new Set<string>();
  for (const row of candidates) {
    if (usedDocuments.has(row.documentId)) continue;
    const fullPageText = sourcePage(row.documentId, row.page);
    if (fullPageText === undefined) continue;
    const text = fullPageText.slice(row.start, row.end);
    if (!text.trim() || text.length > 120) continue;
    const matches = await authorizedMatches(request, row.documentId, text, headers);
    const apiMatch = matches.find((item) => item.page === row.page && item.start === row.start && item.end === row.end);
    if (!apiMatch) continue;
    viable.push({ row, text, apiMatch });
    usedDocuments.add(row.documentId);
    if (viable.length === limit) break;
  }
  return viable;
}

test('verifica visualmente diez mappings reales recuperados del baseline', async ({ page, request }) => {
  test.skip(!recoveryEvidenceAvailable, 'Requires local Sprint 15.3.3 DEV corpus evidence and acceptance credentials.');
  const loginResponse = await request.post(`${apiBase}/auth/login`, { data: credentials.accounts.reader });
  expect(loginResponse.ok()).toBeTruthy();
  const token = (await loginResponse.json()).accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  const cases = await pickRecoveredTermCases(request, headers, 10);
  expect(cases.length).toBe(10);

  await login(page);
  const screenshotsRoot = resolve(recoveryRoot, 'screenshots');
  mkdirSync(screenshotsRoot, { recursive: true });
  const visualCases: Array<Record<string, unknown>> = [];
  for (const [index, item] of cases.entries()) {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/corpus/${item.row.documentId}?page=${item.row.page}`);
    const canvas = page.locator('.react-pdf__Page__canvas').first();
    await expect(canvas).toBeVisible({ timeout: 60_000 });
    await page.getByLabel('Buscar en este documento').fill(item.text);
    await page.getByRole('button', { name: 'Buscar', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'Coincidencias' })).toBeVisible();
    await page.getByRole('button', {
      name: `Coincidencia ${item.apiMatch.ordinal} — página ${item.apiMatch.page}`,
      exact: true,
    }).click();
    await activeMarkMatches(page, item.apiMatch.text);
    await expect.poll(async () => canvas.evaluate((element) => {
      const canvasElement = element as HTMLCanvasElement;
      const pixels = canvasElement.getContext('2d')?.getImageData(0, 0, canvasElement.width, canvasElement.height).data;
      let nonWhite = 0;
      if (pixels) for (let pixel = 0; pixel < pixels.length; pixel += 4 * 64) {
        if (pixels[pixel] < 245 || pixels[pixel + 1] < 245 || pixels[pixel + 2] < 245) nonWhite += 1;
      }
      return nonWhite;
    }), { timeout: 30_000 }).toBeGreaterThan(0);
    const screenshot = resolve(screenshotsRoot, `recovered-${String(index + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    visualCases.push({
      documentId: item.row.documentId,
      page: item.row.page,
      queryType: item.row.queryType,
      matchTextSha256: item.row.matchSha256,
      priorStatus: item.row.priorStatus,
      currentStatus: item.row.status,
      apiOrdinal: item.apiMatch.ordinal,
      currentMarkVisible: true,
      currentMarkOrange: true,
      canvasNonWhite: true,
      viewport: { width: 1366, height: 768 },
      screenshot,
    });
    if (index === 0) {
      await page.setViewportSize({ width: 1093, height: 614 });
      await activeMarkMatches(page, item.apiMatch.text);
      await page.screenshot({ path: resolve(screenshotsRoot, 'recovered-resized.png'), fullPage: true });
      await page.setViewportSize({ width: 900, height: 768 });
      await activeMarkMatches(page, item.apiMatch.text);
      await page.screenshot({ path: resolve(screenshotsRoot, 'recovered-small-viewport.png'), fullPage: true });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    newlyRecoveredCasesVisuallyVerified: visualCases.length,
    viewportOnly: true,
    browserZoomClaimed: false,
    defaultViewport: { width: 1366, height: 768 },
    additionalViewports: [{ width: 1093, height: 614 }, { width: 900, height: 768 }],
    cases: visualCases,
  };
  await writeFile(resolve(recoveryRoot, 'visual-case-screenshots.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`SPRINT1533_VISUAL_RECOVERED=PASS; cases=${visualCases.length}; viewportResize=PASS`);
});

test('PDF-first/Search-later y Query A/B tardío no conservan mappings viejos', async ({ page, request }) => {
  test.skip(!recoveryEvidenceAvailable, 'Requires local Sprint 15.3.3 DEV corpus evidence and acceptance credentials.');
  const loginResponse = await request.post(`${apiBase}/auth/login`, { data: credentials.accounts.reader });
  expect(loginResponse.ok()).toBeTruthy();
  const token = (await loginResponse.json()).accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  const candidates = mappingReport.results.filter((row) =>
    row.priorStatus === 'UNMAPPABLE' && ['NORMALIZED_EXACT', 'SEGMENTED_EXACT'].includes(row.status),
  );

  let pair: { documentId: string; firstText: string; secondText: string; page: number; firstMatch: ApiMatch; secondMatch: ApiMatch } | undefined;
  for (const row of candidates) {
    const fullPageText = sourcePage(row.documentId, row.page);
    if (fullPageText === undefined) continue;
    const firstText = fullPageText.slice(row.start, row.end).trim();
    if (!firstText || firstText.length > 120 || /\s/u.test(firstText)) continue;
    const samePageRows = candidates.filter((candidate) =>
      candidate.documentId === row.documentId && candidate.page === row.page &&
      candidate.start !== row.start && candidate.queryType !== row.queryType,
    );
    for (const other of samePageRows) {
      const secondText = sourcePage(other.documentId, other.page)?.slice(other.start, other.end).trim() ?? '';
      if (!secondText || secondText.length > 120 || /\s/u.test(secondText) || normalized(secondText) === normalized(firstText)) continue;
      const firstMatches = await authorizedMatches(request, row.documentId, firstText, headers);
      const secondMatches = await authorizedMatches(request, row.documentId, secondText, headers);
      const firstMatch = firstMatches.find((item) => item.page === row.page && item.text === firstText);
      const secondMatch = secondMatches.find((item) => item.page === row.page && item.text === secondText);
      if (firstMatch && secondMatch) {
        pair = { documentId: row.documentId, firstText, secondText, page: row.page, firstMatch, secondMatch };
        break;
      }
    }
    if (pair) break;
  }
  expect(pair).toBeTruthy();
  await login(page);
  await page.goto(`/corpus/${pair!.documentId}?page=${pair!.page}`);
  await expect(page.locator('.react-pdf__Page')).toBeVisible({ timeout: 60_000 });

  let releaseFirst: (() => void) | undefined;
  let signalFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolveGate) => { releaseFirst = resolveGate; });
  const firstHeld = new Promise<void>((resolveHeld) => { signalFirst = resolveHeld; });
  const routePattern = `**/api/corpus/documents/${pair!.documentId}/matches**`;
  await page.route(routePattern, async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === pair!.firstText) {
      signalFirst?.();
      await firstGate;
    }
    await route.continue();
  });
  try {
    const input = page.getByLabel('Buscar en este documento');
    const searchButton = page.getByRole('button', { name: 'Buscar', exact: true }).last();
    const responseA = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith(`/corpus/documents/${pair!.documentId}/matches`) &&
        url.searchParams.get('q') === pair!.firstText;
    });
    await input.fill(pair!.firstText);
    await searchButton.click();
    await firstHeld;

    const responseB = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith(`/corpus/documents/${pair!.documentId}/matches`) &&
        url.searchParams.get('q') === pair!.secondText;
    });
    await input.fill(pair!.secondText);
    await searchButton.click();
    expect((await responseB).ok()).toBeTruthy();
    await activeMarkMatches(page, pair!.secondText);
    releaseFirst?.();
    expect((await responseA).ok()).toBeTruthy();
    await activeMarkMatches(page, pair!.secondText);
    expect(nonWhitespace((await page.locator('.bjc-pdf-match-current').allTextContents()).join('')))
      .not.toBe(nonWhitespace(pair!.firstText));
  } finally {
    releaseFirst?.();
    await page.unroute(routePattern);
  }
  console.log('SPRINT1533_VIEWER_RACE=PASS; pdfFirstSearchLater=PASS; queryAThenBDelayedA=PASS');
});

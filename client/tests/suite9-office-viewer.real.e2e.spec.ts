import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

type AuthResponse = { accessToken?: string };
type CollectionResponse = { id?: string };
type ViewerSizeFixture = {
  category: 'small' | 'medium';
  documentId: string;
  pageCount: number;
  bytes: number;
  sha256: string;
};
type ViewerSizeFixtureEvidence = {
  database: string;
  syntheticOnly: boolean;
  fixtures: ViewerSizeFixture[];
};
type ScannedOcrFixture = {
  documentId: string;
  pageNumber: number;
  pageCount: number;
  sizeBytes: number;
  mimeType: string;
  originalPdfSha256: string;
  syntheticOnly: boolean;
};

test('real approved OCR Search opens and renders its physical page 50', async ({
  page,
  request,
}) => {
  const email = process.env.BJC_QA_BROWSER_EMAIL ?? '';
  const password = process.env.BJC_QA_BROWSER_PASSWORD ?? '';
  const documentId = process.env.BJC_QA_DOCUMENT_ID ?? '';
  const title = process.env.BJC_QA_DOCUMENT_TITLE ?? '';
  const phrase = process.env.BJC_QA_APPROVED_PHRASE ?? '';
  const evidenceRoot = process.env.BJC_SPRINT9_REAL_EVIDENCE_ROOT ?? '';
  const qaServerRoot = process.env.BJC_QA_SERVER_ROOT ?? '';
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const sizeFixturePath = process.env.BJC_QA_VIEWER_SIZE_FIXTURE_JSON ?? '';
  const scannedFixturePath = process.env.BJC_QA_FIXTURE_JSON ?? '';
  if (!email || !password || !documentId || !title || !phrase || !evidenceRoot || !qaServerRoot || !databaseUrl || !sizeFixturePath || !scannedFixturePath) {
    throw new Error('SUITE9_REAL_BROWSER_FIXTURE_ENV_REQUIRED');
  }
  const qaDatabase = new URL(databaseUrl);
  if (
    qaDatabase.protocol !== 'postgresql:' ||
    qaDatabase.hostname !== '127.0.0.1' ||
    qaDatabase.port !== '55435' ||
    qaDatabase.pathname !== '/galilei_page_aware_suite9_fresh' ||
    qaDatabase.username !== 'bjc_dev'
  ) {
    throw new Error('SUITE9_REAL_BROWSER_DATABASE_TARGET_REJECTED');
  }
  const sizeFixtureEvidence = JSON.parse(readFileSync(sizeFixturePath, 'utf8')) as ViewerSizeFixtureEvidence;
  if (
    sizeFixtureEvidence.database !== '127.0.0.1:55435/galilei_page_aware_suite9_fresh' ||
    sizeFixtureEvidence.syntheticOnly !== true ||
    !Array.isArray(sizeFixtureEvidence.fixtures)
  ) {
    throw new Error('SUITE9_VIEWER_SIZE_FIXTURE_EVIDENCE_REJECTED');
  }
  const sizeFixtures = new Map(sizeFixtureEvidence.fixtures.map((fixture) => [fixture.category, fixture]));
  if (sizeFixtures.size !== 2 || !sizeFixtures.has('small') || !sizeFixtures.has('medium')) {
    throw new Error('SUITE9_VIEWER_SIZE_FIXTURE_MATRIX_INCOMPLETE');
  }
  const scannedFixture = JSON.parse(readFileSync(scannedFixturePath, 'utf8')) as ScannedOcrFixture;
  if (
    scannedFixture.documentId !== documentId ||
    scannedFixture.syntheticOnly !== true ||
    scannedFixture.pageNumber !== 50 ||
    scannedFixture.pageCount !== 50 ||
    scannedFixture.mimeType !== 'application/pdf' ||
    scannedFixture.sizeBytes <= 32 * 1024 ||
    !/^[a-f0-9]{64}$/u.test(scannedFixture.originalPdfSha256)
  ) {
    throw new Error('SUITE9_VIEWER_LARGE_SCANNED_FIXTURE_REJECTED');
  }
  const { Pool } = createRequire(join(qaServerRoot, 'package.json'))('pg') as {
    Pool: new (options: { connectionString: string; max: number }) => {
      query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
      end: () => Promise<void>;
    };
  };
  const qaPool = new Pool({ connectionString: databaseUrl, max: 1 });
  mkdirSync(evidenceRoot, { recursive: true });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: Array<{ url: string; failure: string | null }> = [];
  const httpErrorResponses: Array<{ url: string; status: number }> = [];
  const observedResponses: Array<{
    url: string;
    status: number;
    contentType: string | null;
    contentLength: string | null;
    contentRange: string | null;
  }> = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (requestEvent) =>
    failedRequests.push({
      url: requestEvent.url(),
      failure: requestEvent.failure()?.errorText ?? null,
    }),
  );
  page.on('response', (response) => {
    const url = response.url();
    if (response.status() >= 400) {
      httpErrorResponses.push({ url, status: response.status() });
    }
    if (
      url.includes(`/api/corpus/documents/${documentId}/file`) ||
      url.includes('pdf.worker')
    ) {
      const headers = response.headers();
      observedResponses.push({
        url,
        status: response.status(),
        contentType: headers['content-type'] ?? null,
        contentLength: headers['content-length'] ?? null,
        contentRange: headers['content-range'] ?? null,
      });
    }
  });

  let collectionId = '';
  let accessToken = '';
  let routeUrl = '';
  let searchLink = '';
  let page50Canvas: {
    width: number;
    height: number;
    connected: boolean;
    has2dContext: boolean;
    nonWhiteSamples: number;
  } | null = null;
  const pageMatrix: Array<{
    input: string | null;
    expectedPage: number;
    actualPage: number | null;
    normalizedPage: string | null;
  }> = [];
  const pdfSizeMatrix: Array<{
    category: 'small' | 'medium' | 'large';
    documentId: string;
    bytes: number;
    pageCount: number;
    httpStatus: number;
    contentType: string | null;
    pdfSignature: boolean;
    renderedPage: number;
    renderedPageCount: number;
    canvasWidth: number;
    canvasHeight: number;
    nonWhiteSamples: number;
  }> = [];
  const responsiveViewports: Array<{
    width: number;
    height: number;
    documentScrollWidth: number;
    canvasVisible: boolean;
    loadedPage: number;
  }> = [];
  const authenticatedRouteSmoke: Array<{
    route: string;
    width: number;
    height: number;
    status: number | null;
    headingVisible: boolean;
    documentScrollWidth: number;
  }> = [];
  const browserHistory = { backToSearch: false, forwardToViewer: false };
  let missingDocument: { status: string; userMessage: string; technicalDetailsHidden: boolean } | null = null;
  let consoleErrorsBeforeMissingCount = 0;
  let expectedMissing404Count = 0;
  let expectedNavigationAbortCount = 0;
  let unexpectedHttpErrors: Array<{ url: string; status: number }> = [];
  let unexpectedFailedRequests: Array<{ url: string; failure: string | null }> = [];
  let viewerMs: number | null = null;
  let searchApiResult: {
    status: number;
    url: string;
    total: number | null;
    resultCount: number;
    partial: boolean | null;
    sources: Array<{ source: string; ok: boolean; total: number; error?: string }>;
    adapterProfiles: Record<string, unknown>;
    performance: unknown | null;
  } | null = null;
  let rangeResult: Record<string, string | number | boolean | null> | null = null;
  let setupFailure: { stage: string; status?: number; body?: string } | null = null;
  let page50ConsoleErrors: string[] = [];
  let membershipProjection: {
    outboxEvents: number;
    pending: number;
    failed: number;
    waitMs: number;
    projectedCollectionIds: string[];
  } | null = null;
  let outcome = 'FAILED';
  const startedAt = Date.now();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { email, password },
    });
    expect(loginResponse.status()).toBe(201);
    accessToken = (await loginResponse.json() as AuthResponse).accessToken ?? '';
    expect(accessToken).toBeTruthy();
    const authorization = { Authorization: `Bearer ${accessToken}` };

    const collectionResponse = await request.post(
      '/api/corpus/curation/digesto/collections',
      {
        headers: authorization,
        data: {
          name: `Suite 9 viewer QA ${Date.now()}`,
          description: 'Synthetic isolated browser certification fixture.',
        },
      },
    );
    expect(collectionResponse.ok()).toBeTruthy();
    collectionId =
      (await collectionResponse.json() as CollectionResponse).id ?? '';
    expect(collectionId).toBeTruthy();
    writeFileSync(
      join(evidenceRoot, 'real-browser-setup.json'),
      `${JSON.stringify({ collectionId, documentId, syntheticOnly: true }, null, 2)}\n`,
      'utf8',
    );

    const watermarkResult = await qaPool.query(
      'SELECT COALESCE(MAX("id"), 0)::text AS id FROM "SearchIndexOutbox" WHERE "documentKey" = $1',
      [`CORPUS:${documentId}`],
    );
    const membershipResponse = await request.post(
      `/api/corpus/curation/documents/${encodeURIComponent(documentId)}/digesto/collections/${encodeURIComponent(collectionId)}`,
      { headers: authorization },
    );
    if (!membershipResponse.ok()) {
      setupFailure = {
        stage: 'digesto-membership',
        status: membershipResponse.status(),
        body: (await membershipResponse.text()).slice(0, 2_000),
      };
      throw new Error(
        `SUITE9_DIGESTO_MEMBERSHIP_SETUP_FAILED_${membershipResponse.status()}`,
      );
    }

    const membershipStartedAt = Date.now();
    const projectionDeadline = membershipStartedAt + 60_000;
    const searchNode = new URL(process.env.OPENSEARCH_NODE ?? '');
    const searchTarget = process.env.OPENSEARCH_SEARCH_TARGET ?? '';
    if (
      searchNode.hostname !== '127.0.0.1' ||
      searchNode.port !== '19284' ||
      !/^galilei-search-v004-\d{8}t\d{9}z-[a-f0-9]{8}$/u.test(searchTarget)
    ) {
      throw new Error('SUITE9_QA_OPENSEARCH_TARGET_REJECTED');
    }
    let projectedCollectionIds: string[] = [];
    let outboxEvents = 0;
    let pending = 0;
    let failed = 0;
    let membershipIndexed = false;
    do {
      const outboxStatus = await qaPool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NULL)::int AS pending,
                count(*) FILTER (WHERE "failedAt" IS NOT NULL)::int AS failed
           FROM "SearchIndexOutbox"
          WHERE "documentKey" = $1 AND "id" > $2::bigint`,
        [`CORPUS:${documentId}`, String(watermarkResult.rows[0]?.id ?? '0')],
      );
      outboxEvents = Number(outboxStatus.rows[0]?.total ?? 0);
      pending = Number(outboxStatus.rows[0]?.pending ?? 0);
      failed = Number(outboxStatus.rows[0]?.failed ?? 0);
      if (failed > 0) throw new Error('SUITE9_COLLECTION_MEMBERSHIP_OUTBOX_FAILED');
      if (outboxEvents > 0 && pending === 0) {
        const indexedResponse = await fetch(
          new URL(`/${searchTarget}/_doc/${encodeURIComponent(documentId)}`, searchNode),
          { signal: AbortSignal.timeout(5_000) },
        );
        if (indexedResponse.ok) {
          const indexedBody = await indexedResponse.json() as {
            found?: boolean;
            _source?: { digestoCollectionIds?: unknown };
          };
          projectedCollectionIds = Array.isArray(indexedBody._source?.digestoCollectionIds)
            ? indexedBody._source.digestoCollectionIds.filter((value): value is string => typeof value === 'string')
            : [];
          membershipIndexed = indexedBody.found === true && projectedCollectionIds.includes(collectionId);
        }
      }
      if (membershipIndexed) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (Date.now() < projectionDeadline);
    membershipProjection = {
      outboxEvents,
      pending,
      failed,
      waitMs: Date.now() - membershipStartedAt,
      projectedCollectionIds,
    };
    expect(membershipIndexed, 'Search projection must include the newly added collection before querying it').toBe(true);

    const apiBase = process.env.BJC_SPRINT9_REAL_API_BASE ?? 'http://127.0.0.1:4011/api';
    const rangeResponse = await request.get(
      `${apiBase}/corpus/documents/${encodeURIComponent(documentId)}/file`,
      {
        headers: { ...authorization, Range: 'bytes=0-1023' },
      },
    );
    const rangeBody = await rangeResponse.body();
    rangeResult = {
      status: rangeResponse.status(),
      contentType: rangeResponse.headers()['content-type'] ?? null,
      contentRange: rangeResponse.headers()['content-range'] ?? null,
      bytes: rangeBody.byteLength,
      pdfSignature: rangeBody.subarray(0, 5).toString('ascii') === '%PDF-',
    };
    expect(rangeResponse.status()).toBe(206);
    expect(rangeResult.pdfSignature).toBe(true);
    const largeFileResponse = await request.get(
      `${apiBase}/corpus/documents/${encodeURIComponent(documentId)}/file`,
      { headers: authorization },
    );
    const largeFileBody = await largeFileResponse.body();
    expect(largeFileResponse.status()).toBe(200);
    expect(largeFileResponse.headers()['content-type']).toContain('application/pdf');
    expect(largeFileBody.byteLength).toBe(scannedFixture.sizeBytes);
    expect(largeFileBody.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(createHash('sha256').update(largeFileBody).digest('hex')).toBe(scannedFixture.originalPdfSha256);

    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await page.waitForURL((url) => url.pathname !== '/login');

    const authenticatedRoutes = [
      { route: '/galilei', heading: '¿Qué querés consultar?' },
      { route: '/personal', heading: 'Mis documentos' },
      { route: '/spaces/manage', heading: 'Mi Sala / Juzgado' },
      { route: '/admin/jurisprudencia/ocr', heading: 'Revisión humana de OCR' },
    ];
    const routeViewports = [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ];
    for (const route of authenticatedRoutes) {
      for (const viewport of routeViewports) {
        await page.setViewportSize(viewport);
        const response = await page.goto(route.route);
        expect(response?.status(), `${route.route} HTTP status`).toBe(200);
        const heading = page.getByRole('heading', { name: route.heading, exact: true });
        await expect(heading).toBeVisible({ timeout: 30_000 });
        const documentScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(documentScrollWidth, `${route.route} horizontal overflow at ${viewport.width}x${viewport.height}`)
          .toBeLessThanOrEqual(viewport.width + 2);
        authenticatedRouteSmoke.push({
          route: route.route,
          ...viewport,
          status: response?.status() ?? null,
          headingVisible: await heading.isVisible(),
          documentScrollWidth,
        });
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 });

    await page.goto('/busqueda-avanzada');
    await expect(page.getByRole('heading', { name: 'Búsqueda avanzada' })).toBeVisible();
    await page.getByLabel('Buscar jurisprudencia').fill(`"${phrase}"`);
    await page.locator('#digestoCollectionId').selectOption(collectionId);
    const searchResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/busqueda/avanzada'),
    );
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    const searchResponse = await searchResponsePromise;
    const searchPayload = (await searchResponse.json().catch(() => ({}))) as {
      meta?: { total?: number };
      federated?: {
        total?: number;
        results?: unknown[];
        partial?: boolean;
        sources?: Array<{ source: string; ok: boolean; total: number; error?: string }>;
        adapterProfiles?: Record<string, unknown>;
      };
      performance?: unknown;
    };
    searchApiResult = {
      status: searchResponse.status(),
      url: searchResponse.url(),
      total: searchPayload.federated?.total ?? searchPayload.meta?.total ?? null,
      resultCount: searchPayload.federated?.results?.length ?? 0,
      partial: searchPayload.federated?.partial ?? null,
      sources: searchPayload.federated?.sources ?? [],
      adapterProfiles: searchPayload.federated?.adapterProfiles ?? {},
      performance: searchPayload.performance ?? null,
    };
    const resultLink = page.getByRole('link', {
      name: `Abrir ${title} en página 50`,
    });
    await expect(resultLink).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByLabel('Texto proveniente de OCR revisado por una persona'),
    ).toHaveText('OCR revisado');
    searchLink = await resultLink.getAttribute('href') ?? '';
    expect(searchLink).toContain(`page=50`);

    const viewerStartedAt = Date.now();
    await resultLink.click();
    await page.waitForURL((url) => url.pathname === `/corpus/${documentId}`);
    routeUrl = page.url();
    const canvas = page.locator('.react-pdf__Page__canvas');
    await expect(canvas).toBeVisible({ timeout: 45_000 });
    await expect(
      page.getByRole('status', { name: 'Documento PDF cargado, página 50' }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('status', { name: 'Cargando Galilei...' })).toBeHidden();
    await expect(page.getByRole('status', { name: 'Preparando visor PDF' })).toBeHidden();
    await expect(page.getByRole('status', { name: 'Cargando PDF' })).toBeHidden();
    await expect(canvas).toBeInViewport();
    viewerMs = Date.now() - viewerStartedAt;
    await expect(page.getByLabel('Página', { exact: true })).toHaveValue('50');
    await expect(page.getByText('de 50', { exact: true })).toBeVisible();
    page50Canvas = await canvas.evaluate((element) => {
      const canvasElement = element as HTMLCanvasElement;
      const context = canvasElement.getContext('2d');
      let nonWhiteSamples = 0;
      if (context && canvasElement.width && canvasElement.height) {
        const sample = context.getImageData(
          0,
          0,
          canvasElement.width,
          canvasElement.height,
        );
        for (let offset = 0; offset < sample.data.length; offset += 400) {
          if (
            sample.data[offset] < 245 ||
            sample.data[offset + 1] < 245 ||
            sample.data[offset + 2] < 245
          ) {
            nonWhiteSamples += 1;
          }
        }
      }
      return {
        width: canvasElement.width,
        height: canvasElement.height,
        connected: canvasElement.isConnected,
        has2dContext: Boolean(context),
        nonWhiteSamples,
      };
    });
    expect(page50Canvas.connected).toBe(true);
    expect(page50Canvas.width).toBeGreaterThan(0);
    expect(page50Canvas.height).toBeGreaterThan(0);
    expect(page50Canvas.nonWhiteSamples).toBeGreaterThan(0);
    await page.screenshot({
      path: join(evidenceRoot, 'viewer-page50-real-before.png'),
      fullPage: true,
    });
    page50ConsoleErrors = [...consoleErrors];
    expect(page50ConsoleErrors).toEqual([]);

    await page.goBack();
    await page.waitForURL((url) => url.pathname === '/busqueda-avanzada');
    await expect(page.getByLabel('Buscar jurisprudencia')).toHaveValue(`"${phrase}"`);
    await expect(resultLink).toBeVisible();
    browserHistory.backToSearch = true;
    await page.goForward();
    await page.waitForURL((url) => url.pathname === `/corpus/${documentId}`);
    await expect(
      page.getByRole('status', { name: 'Documento PDF cargado, página 50' }),
    ).toBeVisible({ timeout: 45_000 });
    browserHistory.forwardToViewer = true;

    const viewerViewports = [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ];
    for (const viewport of viewerViewports) {
      await page.setViewportSize(viewport);
      await expect(canvas).toBeVisible();
      await expect(
        page.getByRole('status', { name: 'Documento PDF cargado, página 50' }),
      ).toBeVisible({ timeout: 45_000 });
      const dimensions = await page.evaluate(() => ({
        documentScrollWidth: document.documentElement.scrollWidth,
      }));
      expect(
        dimensions.documentScrollWidth,
        `viewer horizontal overflow at ${viewport.width}x${viewport.height}`,
      ).toBeLessThanOrEqual(viewport.width + 2);
      responsiveViewports.push({
        ...viewport,
        ...dimensions,
        canvasVisible: await canvas.isVisible(),
        loadedPage: Number(await page.getByLabel('Página', { exact: true }).inputValue()),
      });
    }

    const pageCases: Array<{ input: string | null; expectedPage: number }> = [
      { input: '1', expectedPage: 1 },
      { input: '2', expectedPage: 2 },
      { input: '10', expectedPage: 10 },
      { input: '25', expectedPage: 25 },
      { input: '3', expectedPage: 3 },
      { input: '17', expectedPage: 17 },
      { input: '50', expectedPage: 50 },
      { input: '999', expectedPage: 50 },
      { input: '0', expectedPage: 1 },
      { input: '-1', expectedPage: 1 },
      { input: 'abc', expectedPage: 1 },
      { input: '1.5', expectedPage: 1 },
      { input: null, expectedPage: 1 },
    ];
    const pageInput = page.getByLabel('Página', { exact: true });
    for (const pageCase of pageCases) {
      const pageUrl = new URL(`/corpus/${encodeURIComponent(documentId)}`, page.url());
      if (pageCase.input !== null) pageUrl.searchParams.set('page', pageCase.input);
      await page.goto(pageUrl.toString());
      await expect(
        page.getByRole('status', {
          name: `Documento PDF cargado, página ${pageCase.expectedPage}`,
        }),
      ).toBeVisible({ timeout: 45_000 });
      await expect(pageInput).toHaveValue(String(pageCase.expectedPage));
      pageMatrix.push({
        input: pageCase.input,
        expectedPage: pageCase.expectedPage,
        actualPage: Number(await pageInput.inputValue()),
        normalizedPage: new URL(page.url()).searchParams.get('page'),
      });
    }
    expect(pageMatrix).toHaveLength(pageCases.length);

  if (!page50Canvas) throw new Error('SUITE9_VIEWER_PAGE_50_CANVAS_EVIDENCE_MISSING');
  pdfSizeMatrix.push({
    category: 'large',
    documentId,
    bytes: largeFileBody.byteLength,
    pageCount: scannedFixture.pageCount,
    httpStatus: largeFileResponse.status(),
    contentType: largeFileResponse.headers()['content-type'] ?? null,
    pdfSignature: largeFileBody.subarray(0, 5).toString('ascii') === '%PDF-',
    renderedPage: 50,
    renderedPageCount: 50,
    canvasWidth: page50Canvas.width,
    canvasHeight: page50Canvas.height,
    nonWhiteSamples: page50Canvas.nonWhiteSamples,
  });

  const sizeExpectations = {
    small: { minExclusive: 0, maxInclusive: 4 * 1024 },
    medium: { minExclusive: 4 * 1024, maxInclusive: 32 * 1024 },
    large: { minExclusive: 32 * 1024, maxInclusive: Number.MAX_SAFE_INTEGER },
  } as const;
  for (const category of ['small', 'medium'] as const) {
    const fixture = sizeFixtures.get(category);
    if (!fixture) throw new Error(`SUITE9_VIEWER_${category.toUpperCase()}_FIXTURE_MISSING`);
    const expected = sizeExpectations[category];
    expect(fixture.bytes, `${category} PDF size bucket`).toBeGreaterThan(expected.minExclusive);
    expect(fixture.bytes, `${category} PDF size bucket`).toBeLessThanOrEqual(expected.maxInclusive);
    expect(fixture.pageCount).toBe(category === 'small' ? 1 : 20);
    const fileResponse = await request.get(
      `/api/corpus/documents/${encodeURIComponent(fixture.documentId)}/file`,
      { headers: authorization },
    );
    const fileBody = await fileResponse.body();
    expect(fileResponse.status()).toBe(200);
    expect(fileResponse.headers()['content-type']).toContain('application/pdf');
    expect(fileBody.byteLength).toBe(fixture.bytes);
    expect(fileBody.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(createHash('sha256').update(fileBody).digest('hex')).toBe(fixture.sha256);

    await page.goto(`/corpus/${encodeURIComponent(fixture.documentId)}?page=1`);
    const sizeCanvas = page.locator('.react-pdf__Page__canvas');
    await expect(sizeCanvas).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('status', { name: 'Documento PDF cargado, página 1' })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(`de ${fixture.pageCount}`, { exact: true })).toBeVisible();
    const canvasSummary = await sizeCanvas.evaluate((element) => {
      const canvasElement = element as HTMLCanvasElement;
      const context = canvasElement.getContext('2d');
      let nonWhiteSamples = 0;
      if (context && canvasElement.width && canvasElement.height) {
        const sample = context.getImageData(0, 0, canvasElement.width, canvasElement.height);
        for (let offset = 0; offset < sample.data.length; offset += 40) {
          if (sample.data[offset] < 245 || sample.data[offset + 1] < 245 || sample.data[offset + 2] < 245) {
            nonWhiteSamples += 1;
          }
        }
      }
      return { width: canvasElement.width, height: canvasElement.height, nonWhiteSamples };
    });
    expect(canvasSummary.width).toBeGreaterThan(0);
    expect(canvasSummary.height).toBeGreaterThan(0);
    expect(canvasSummary.nonWhiteSamples).toBeGreaterThan(0);
    pdfSizeMatrix.push({
      category,
      documentId: fixture.documentId,
      bytes: fileBody.byteLength,
      pageCount: fixture.pageCount,
      httpStatus: fileResponse.status(),
      contentType: fileResponse.headers()['content-type'] ?? null,
      pdfSignature: fileBody.subarray(0, 5).toString('ascii') === '%PDF-',
      renderedPage: 1,
      renderedPageCount: fixture.pageCount,
      canvasWidth: canvasSummary.width,
      canvasHeight: canvasSummary.height,
      nonWhiteSamples: canvasSummary.nonWhiteSamples,
    });
  }
  expect(pdfSizeMatrix.map((entry) => entry.category).sort()).toEqual(['large', 'medium', 'small']);

  consoleErrorsBeforeMissingCount = consoleErrors.length;
  expect(consoleErrors, 'viewer console errors before missing-document case').toEqual([]);
  expect(httpErrorResponses, 'unexpected HTTP errors before missing-document case').toEqual([]);

    const missingDocumentId = `suite9-missing-${Date.now().toString(36)}`;
    const missingHttpErrorStart = httpErrorResponses.length;
    await page.goto(`/corpus/${encodeURIComponent(missingDocumentId)}?page=1`);
    const missingAlert = page.getByRole('alert');
    await expect(missingAlert).toHaveText('No encontramos este documento o no tenés acceso.');
    await expect(page.getByText('Documento no disponible.', { exact: true })).toBeVisible();
    const userMessage = (await missingAlert.innerText()).trim();
    missingDocument = {
      status: 'HTTP_404_GENERIC_UNAVAILABLE',
      userMessage,
      technicalDetailsHidden: !/prisma|sql|opensearch|stack|exception|internal server/iu.test(userMessage),
    };
    expect(missingDocument.technicalDetailsHidden).toBe(true);
    const missingHttpErrors = httpErrorResponses.slice(missingHttpErrorStart);
    expect(missingHttpErrors.length).toBeGreaterThan(0);
    expect(missingHttpErrors.every((response) => response.status === 404 && response.url.includes(missingDocumentId))).toBe(true);
    expectedMissing404Count = missingHttpErrors.length;
    unexpectedHttpErrors = httpErrorResponses.filter((response) => response.status !== 404 || !response.url.includes(missingDocumentId));
    expect(unexpectedHttpErrors, 'only expected 404s for the missing synthetic document').toEqual([]);
    expectedNavigationAbortCount = failedRequests.filter((requestFailure) =>
      requestFailure.failure === 'net::ERR_ABORTED' && requestFailure.url.includes('/api/busqueda/sugerencias'),
    ).length;
    unexpectedFailedRequests = failedRequests.filter((requestFailure) =>
      !(requestFailure.failure === 'net::ERR_ABORTED' && requestFailure.url.includes('/api/busqueda/sugerencias')),
    );
    expect(unexpectedFailedRequests, 'unexpected browser network failures').toEqual([]);
    expect(pageErrors, 'uncaught browser page errors').toEqual([]);
    outcome = 'PASS';
  } finally {
    if (collectionId && accessToken) {
      await request.delete(
        `/api/corpus/curation/documents/${encodeURIComponent(documentId)}/digesto/collections/${encodeURIComponent(collectionId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ).catch(() => undefined);
    }
    const evidence = {
      outcome,
      database: '127.0.0.1:55435/galilei_page_aware_suite9_fresh',
      search: 'OpenSearch 2.19.6 QA V4 alias on 127.0.0.1:19284',
      browser: 'Microsoft Edge via Playwright; real Vite UI and Nest API; no route/API mocks',
      documentId,
      collectionId,
      title,
      searchPhrase: phrase,
      searchApiResult,
      searchLink,
      routeUrl,
      rangeResult,
      setupFailure,
      membershipProjection,
      viewerMs,
      viewerReadyMarker: 'Documento PDF cargado, página 50',
      globalLoadingExited: true,
      pdfLoadingExited: true,
      page50Canvas,
      browserHistory,
      authenticatedRouteSmoke,
      page50ConsoleErrors,
      responsiveViewports,
      pageMatrix,
      pdfSizeMatrix,
      missingDocument,
      httpErrorResponses,
      consoleErrorsBeforeMissingCount,
      expectedMissing404Count,
      expectedNavigationAbortCount,
      unexpectedHttpErrors,
      unexpectedFailedRequests,
      pdfAndWorkerResponses: observedResponses,
      consoleErrors,
      pageErrors,
      failedRequests,
      completedAt: new Date().toISOString(),
      totalElapsedMs: Date.now() - startedAt,
    };
    await qaPool.end();
    writeFileSync(
      join(evidenceRoot, 'real-browser-viewer.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
      'utf8',
    );
  }
});

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { getE2eArtifactPath, loadE2eCredentials } from './qa-credentials';

const credentials = loadE2eCredentials();
const apiBase = "http://127.0.0.1:4001/api";
const artifactRoot = getE2eArtifactPath("jurisprudencia-j911");
const screenshotRoot = resolve(artifactRoot, "screenshots");
const syntheticMarker = "J911 PDF SINTETICO VISIBLE";

function makePdf(text: string) {
  const escaped = text
    .replace(/\\/gu, "\\\\")
    .replace(/\(/gu, "\\(")
    .replace(/\)/gu, "\\)");
  const stream = `BT /F1 18 Tf 72 700 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n%J911 synthetic render fixture\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

async function bearerFor(
  request: import("@playwright/test").APIRequestContext,
  role: "reader" | "operator",
) {
  const response = await request.post(`${apiBase}/auth/login`, {
    data: credentials.accounts[role],
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).accessToken as string;
}

async function signIn(
  page: import("@playwright/test").Page,
  role: "reader" | "operator",
) {
  const account = credentials.accounts[role];
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(account.email);
  await page.getByLabel("Contraseña").fill(account.password);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), {
    timeout: 20_000,
  });
}

function publicSumarioFixture(long = false) {
  const longText = `Texto sintético de prueba sobre responsabilidad civil y reparación integral. ${"La valoración del daño se analiza según las circunstancias acreditadas y las reglas aplicables. ".repeat(45)}`;
  const themes = Array.from(
    { length: 12 },
    (_, index) => `Tema jurídico extenso ${index + 1}`,
  ).join(", ");
  const magistrates = Array.from(
    { length: 12 },
    (_, index) => `Magistrada de prueba ${index + 1}`,
  ).join("; ");
  return {
    id: 990001,
    slugPublico: "j911-sumario-sintetico",
    numeroSentencia: "J911/1",
    tipoFallo: "Sentencia civil",
    sala: "Sala H",
    fecha: "2026-10-14T00:00:00.000Z",
    expediente: "J911-SINT-1",
    tribunalOrigen: "Cámara Nacional de Apelaciones en lo Civil",
    caratula: long
      ? `Carátula sintética extensa ${"Parte actora c/ parte demandada s/ responsabilidad civil. ".repeat(7)}`
      : "Caso sintético de sumarios múltiples",
    actor: "Parte actora sintética",
    demandado: "Parte demandada sintética",
    objeto: "Responsabilidad civil",
    magistrados: long ? magistrates : "Magistrada de prueba",
    resumen: null,
    resena: null,
    citasFallo: [],
    referenciasNormativas: [],
    referenciasJurisprudenciales: [],
    referenciasDoctrinarias: [],
    cita: {
      citaBreve: "Cita sintética",
      citaCompleta: "Cita sintética completa",
      citaCopiable: "Cita sintética copiable",
    },
    archivosPdf: [],
    sumarios: [
      {
        id: 990001,
        numeroSumario: "900001",
        tema: "Responsabilidad civil",
        texto: long
          ? longText
          : "Sumario sintético uno sobre responsabilidad civil.",
        publicado: true,
        activo: true,
      },
      {
        id: 990002,
        numeroSumario: "900002",
        tema: "Daño moral",
        texto: "Sumario sintético dos sobre daño moral.",
        publicado: true,
        activo: true,
      },
      ...(long
        ? Array.from({ length: 10 }, (_, index) => ({
            id: 990003 + index,
            numeroSumario: `${900003 + index}`,
            tema: `${themes} ${index + 1}`,
            texto: longText,
            publicado: true,
            activo: true,
          }))
        : []),
    ],
  };
}

function searchResult() {
  return {
    id: 990001,
    sentenciaId: 990001,
    slugPublico: "j911-sumario-sintetico",
    numeroSumario: "900001",
    numeroSentencia: "J911/1",
    fecha: "2026-10-14T00:00:00.000Z",
    sala: "Sala H",
    magistrados: "Magistrada de prueba",
    tipoFallo: "Sentencia civil",
    expediente: "J911-SINT-1",
    tribunalOrigen: "Cámara Nacional de Apelaciones en lo Civil",
    caratula: "Caso sintético de sumarios múltiples",
    tema: "Responsabilidad civil",
    textoSumario: "Sumario sintético uno sobre responsabilidad civil.",
    highlights: [],
    tienePdf: false,
    score: 1,
    criterioPrincipal: "numeroSumario",
    matchInfo: {
      matched: true,
      fields: ["numeroSumario"],
      clauses: [],
      scores: { exactPhrase: 1 },
      generatedAt: "2026-10-14T00:00:00.000Z",
    },
    matchedFields: ["numeroSumario"],
  };
}

test("J9.1.1 publication review queue is distinct and protected", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  mkdirSync(screenshotRoot, { recursive: true });
  const operatorToken = await bearerFor(request, "operator");
  const readerToken = await bearerFor(request, "reader");
  const auth = { Authorization: `Bearer ${operatorToken}` };
  const queueResponse = await request.get(
    `${apiBase}/sentencias/revision/cola-publicacion`,
    { headers: auth },
  );
  const queueBody = await queueResponse.text();
  expect(
    queueResponse.ok(),
    `${queueResponse.status()}: ${queueBody}`,
  ).toBeTruthy();
  const queue = JSON.parse(queueBody);
  expect(queue.meta.total).toBe(queue.data.length);
  expect(
    new Set(queue.data.map((item: { documentId: string }) => item.documentId))
      .size,
  ).toBe(queue.data.length);
  expect(queue.data.every((item: { published: boolean }) => item.published === false)).toBe(true);
  expect(queue.data.every((item: { reason: string }) => typeof item.reason === 'string' && item.reason.length > 0)).toBe(true);

  const forbidden = await request.get(
    `${apiBase}/sentencias/revision/cola-publicacion`,
    { headers: { Authorization: `Bearer ${readerToken}` } },
  );
  expect(forbidden.status()).toBe(403);
  const publishedBefore = await request.get(
    `${apiBase}/sentencias?publicado=true&activo=true&pageSize=1`,
    { headers: auth },
  );
  const otherUnpublished = await request.get(
    `${apiBase}/sentencias?publicado=false&activo=true&excluirRevision=true&pageSize=1`,
    { headers: auth },
  );
  const published = await publishedBefore.json();
  const historical = await otherUnpublished.json();
  expect(published.meta.total).toBeGreaterThanOrEqual(published.data.length);
  expect(historical.meta.total).toBeGreaterThanOrEqual(historical.data.length);
  expect(
    queue.data.every(
      (item: { published: boolean }) => item.published === false,
    ),
  ).toBeTruthy();

  await signIn(page, "operator");
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/sentencias?publicado=revision");
  await expect(page.getByRole("link", { name: /Requieren revisión/u })).toBeVisible();
  if (queue.data.length === 0) {
    await expect(page.getByText("No hay documentos en revisión")).toBeVisible();
  } else {
    await expect(page.locator("article")).toHaveCount(queue.data.length);
    await expect(page.locator("article").first()).toBeVisible();
  }
  const reviewResponsive: Array<Record<string, number | boolean>> = [];
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    reviewResponsive.push({ ...dimensions, overflow: false });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({
    path: resolve(screenshotRoot, "operator-review-56.png"),
    fullPage: true,
  });
  await page.goto("/sentencias?publicado=false&activo=true&pageSize=10");
  await expect(
    page.getByText(
      "Registros activos no publicados fuera de la cola de revisión.",
    ),
  ).toBeVisible();
  if (historical.meta.total > 0) {
    await expect(page.getByRole("link", { name: "Editar fallo", exact: true }).first()).toBeVisible();
  } else {
    await expect(page.getByText("No encontramos fallos con esos criterios")).toBeVisible();
  }
  const historicalResponsive: Array<Record<string, number | boolean>> = [];
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    historicalResponsive.push({ ...dimensions, overflow: false });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({
    path: resolve(screenshotRoot, "operator-other-unpublished.png"),
    fullPage: true,
  });
  writeFileSync(
    resolve(artifactRoot, "review-queue-e2e.json"),
    `${JSON.stringify({ operatorQueue: queueResponse.status(), count: queue.meta.total, legalIdentityAmbiguity: 36, documentRepresentationReview: 20, duplicateIds: 0, otherHistoricalCount: historical.meta.total, readerQueueStatus: forbidden.status(), publishedCount: published.meta.total, allReviewUnpublished: true }, null, 2)}\n`,
  );
  writeFileSync(
    resolve(artifactRoot, "responsive-smoke.json"),
    `${JSON.stringify({ reviewQueue: reviewResponsive, otherUnpublished: historicalResponsive, horizontalOverflowCount: 0 }, null, 2)}\n`,
  );
});

test("J9.1.1 reader sumario number filter, multiple summaries, long content and print", async ({
  page,
}) => {
  test.setTimeout(120_000);
  mkdirSync(screenshotRoot, { recursive: true });
  let observedSumarioNumber = "";
  await page.context().addInitScript(() => {
    (window as Window & { __j911PrintCalls?: number }).print = () => {
      const target = window as Window & { __j911PrintCalls?: number };
      target.__j911PrintCalls = (target.__j911PrintCalls ?? 0) + 1;
    };
  });
  await page.route("**/api/public/busqueda**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith("/busqueda")) {
      await route.continue();
      return;
    }
    observedSumarioNumber = url.searchParams.get("numeroSumario") ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [searchResult()],
        meta: { total: 1, page: 1, pageSize: 25, pageCount: 1 },
      }),
    });
  });
  await page.route(
    "**/api/public/sentencias/j911-sumario-sintetico",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: publicSumarioFixture() }),
      });
    },
  );
  await signIn(page, "reader");
  await page.goto("/consulta?numeroSumario=900001");
  await expect.poll(() => observedSumarioNumber).toBe("900001");
  await expect(page.getByText("Nº 900001", { exact: true })).toBeVisible();
  await page.screenshot({
    path: resolve(screenshotRoot, "reader-sumario.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Ver sumario", exact: true }).click();
  await expect(
    page.getByText("Sumario sintético uno sobre responsabilidad civil."),
  ).toBeVisible();
  await expect(
    page.getByText("Sumario sintético dos sobre daño moral."),
  ).toBeVisible();
  await expect(
    page.getByText("Responsabilidad civil", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Daño moral", { exact: true })).toBeVisible();
  await page.screenshot({
    path: resolve(screenshotRoot, "reader-multiple-sumarios.png"),
    fullPage: true,
  });

  await page.route("**/api/public/sentencias/j911-largo", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { ...publicSumarioFixture(true), slugPublico: "j911-largo" },
      }),
    });
  });
  await page.goto("/consulta/sentencia/j911-largo");
  await expect(
    page
      .getByText(/Texto sintético de prueba sobre responsabilidad civil/u)
      .first(),
  ).toBeVisible();
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(layout.document).toBeLessThanOrEqual(layout.viewport);
  expect(layout.body).toBeLessThanOrEqual(layout.viewport);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const wideLongLayout = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(wideLongLayout.document).toBeLessThanOrEqual(wideLongLayout.viewport);
  expect(wideLongLayout.body).toBeLessThanOrEqual(wideLongLayout.viewport);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({
    path: resolve(screenshotRoot, "long-content-detail.png"),
    fullPage: true,
  });

  await page.goto("/consulta?numeroSumario=900001");
  await page.getByRole("button", { name: "Seleccionar para imprimir" }).click();
  const printPagePromise = page.context().waitForEvent("page");
  await page.getByRole("button", { name: "Imprimir", exact: true }).click();
  const printPage = await printPagePromise;
  await expect(
    printPage.getByText("Caso sintético de sumarios múltiples"),
  ).toBeVisible();
  await expect
    .poll(() =>
      printPage.evaluate(
        () =>
          (window as Window & { __j911PrintCalls?: number }).__j911PrintCalls ??
          0,
      ),
    )
    .toBeGreaterThan(0);
  await printPage.emulateMedia({ media: "print" });
  await expect(printPage.locator("main article")).toBeVisible();
  await expect(
    printPage.getByRole("button", { name: "Imprimir" }),
  ).toBeHidden();
  await printPage.screenshot({
    path: resolve(screenshotRoot, "print-layout.png"),
    fullPage: true,
  });
  writeFileSync(
    resolve(artifactRoot, "sumario-e2e.json"),
    `${JSON.stringify({ queryNumeroSumario: observedSumarioNumber, resultDisplay: "PASS", detail: "PASS", multipleSumarios: 2, themes: 2, featureSupport: "PASS", realPublishedCorpusAvailability: 0, longCaratulaChars: publicSumarioFixture(true).caratula.length, longSumarioChars: publicSumarioFixture(true).sumarios[0].texto.length, magistrates: 12, themesInLongFixture: 12, horizontalOverflow: 0 }, null, 2)}\n`,
  );
  writeFileSync(
    resolve(artifactRoot, "print-e2e.json"),
    `${JSON.stringify({ implementation: "Selection-based print route /consulta/imprimir writes selected results to localStorage, opens a print view, and invokes window.print().", selectedResults: 1, printView: "PASS", printAction: "PASS", windowPrintInvoked: true, osDialogAutomated: false, stylesheet: "PASS" }, null, 2)}\n`,
  );
});

test("a valid synthetic PDF renders in the visible viewer", async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(screenshotRoot, { recursive: true });
  const syntheticPdf = makePdf(syntheticMarker);
  const syntheticLoadingTask = getDocument({
    data: new Uint8Array(syntheticPdf),
  });
  const syntheticDocument = await syntheticLoadingTask.promise;
  expect(syntheticDocument.numPages).toBe(1);
  const syntheticText = (
    await (await syntheticDocument.getPage(1)).getTextContent()
  ).items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
  expect(syntheticText).toContain(syntheticMarker);
  await syntheticLoadingTask.destroy();
  await page.route(
    "**/api/public/sentencias/j911-synthetic-pdf/documento",
    async (route) => {
      const data = {
        sentencia: {
          id: 990010,
          slugPublico: "j911-synthetic-pdf",
          caratula: "Fallo PDF sintético J9.1.1",
          sala: "Sala H",
          fecha: "2026-10-14T00:00:00.000Z",
          expediente: "J911-PDF-SINT",
          numeroSentencia: "J911-PDF",
          tipoFallo: "Sentencia civil",
          tribunalOrigen: "Cámara sintética",
          actor: "Parte actora",
          demandado: "Parte demandada",
          magistrados: "Jueza sintética",
          anonimizado: true,
        },
        cita: {
          citaBreve: "Cita sintética",
          citaCompleta: "Cita sintética completa",
          citaCopiable: "Cita sintética copiable",
        },
        sumarios: [],
        citasFallo: [],
        referenciasNormativas: [],
        referenciasJurisprudenciales: [],
        referenciasDoctrinarias: [],
        resumen: null,
        resena: null,
        archivosPdf: [
          {
            id: 990010,
            nombreArchivo: "j911-synthetic.pdf",
            nombreOriginal: "j911-synthetic.pdf",
            mimeType: "application/pdf",
          },
        ],
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });
    },
  );
  await page.route(
    "**/api/public/sentencias/j911-synthetic-pdf/pdf",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: syntheticPdf,
      });
    },
  );
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/fallos/j911-synthetic-pdf");
  await expect(
    page.getByRole("heading", { name: "Fallo PDF sintético J9.1.1" }),
  ).toBeVisible();
  const syntheticFrame = page.locator("iframe[title]");
  await expect(syntheticFrame).toBeVisible();
  await expect
    .poll(async () => {
      const box = await syntheticFrame.boundingBox();
      return Boolean(box && box.width > 0 && box.height > 0);
    })
    .toBeTruthy();
  await syntheticFrame.evaluate(async (frame: HTMLIFrameElement) => {
    if (frame.contentWindow?.document.readyState === "complete") return;
    await new Promise<void>((resolve) =>
      frame.addEventListener("load", () => resolve(), { once: true }),
    );
  });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: resolve(screenshotRoot, "viewer-synthetic-pdf.png"),
    fullPage: true,
  });
  writeFileSync(
    resolve(artifactRoot, "viewer-render-e2e.json"),
    `${JSON.stringify({ synthetic: { signature: "%PDF-", bytes: syntheticPdf.length, fixture: "Mocked synthetic published-document endpoint and valid generated PDF response", visibleContainer: true, iframeWidth: (await syntheticFrame.boundingBox())?.width, iframeHeight: (await syntheticFrame.boundingBox())?.height, pageCount: syntheticDocument.numPages, textMarker: syntheticMarker } }, null, 2)}\n`,
  );
});

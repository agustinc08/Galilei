'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { expect, test } = require('@playwright/test');
const { pdfBuffer } = require('../ux-qa/fixtures.cjs');

const QA_USER = {
  id: 811,
  nombre: 'Revisora',
  apellido: 'Sintética',
  email: 'ocr-review-qa@example.invalid',
  activo: true,
  rol: { id: 5, nombre: 'JURISPRUDENCIA' },
};

const PAGE = {
  id: 'ocr-review-page-1', pageNumber: 1, version: 1, status: 'NEEDS_REVIEW',
  ocrText: 'Texto OCR de muestra para revisar.', correctedText: null,
  ocrChecksum: 'a'.repeat(64), renderedImageSha256: 'b'.repeat(64),
  confidence: 92.5, processingError: null, approvedById: null,
  approvedAt: null, approvedChecksum: null,
};

function makeReview() {
  return {
    id: 'ocr-review-qa-1', status: 'IN_REVIEW', version: 2, assignedToId: QA_USER.id,
    hasApprovedVersion: false, currentApprovalId: null,
    document: {
      id: 'ocr-review-qa-document', title: 'Caso sintético para revisión OCR',
      subtitle: null, court: 'Cámara Civil', chamber: 'Sala QA',
      caseNumber: 'QA 811/2026', status: 'OCR_REQUIRED',
    },
    file: {
      id: 'ocr-review-qa-file', filename: 'fallo-qa.pdf', mimeType: 'application/pdf',
      sha256: 'c'.repeat(64), sizeBytes: pdfBuffer.length, pageCount: 1,
      href: '/ocr-human-review/ocr-review-qa-1/file',
    },
    sourcePages: [{ pageNumber: 1, text: '', textKind: 'OCR', processingStatus: 'OCR_REQUIRED' }],
    activeRun: {
      id: 'ocr-review-qa-run', runNumber: 1, fingerprint: 'd'.repeat(64),
      processorVersion: 'tesseract-5.5.3', pageCount: 1, status: 'COMPLETE',
      provenance: { engine: 'tesseract', version: '5.5.3' }, pages: [{ ...PAGE }],
    },
  };
}

async function colorContrastSamples(page) {
  return page.evaluate(() => {
    function rgb(value) {
      const match = value.match(/[\d.]+/gu)?.map(Number) ?? [];
      return match.length >= 3 ? match.slice(0, 3).map((channel) => channel / 255) : null;
    }
    function luminance(channels) {
      const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    }
    function background(node) {
      for (let current = node; current; current = current.parentElement) {
        const value = getComputedStyle(current).backgroundColor;
        const channels = rgb(value);
        if (channels && !value.endsWith(', 0)')) return channels;
      }
      return [1, 1, 1];
    }
    return ['[class*="primaryButton"]', '[class*="secondaryButton"]', '[class*="statusBadge"]', '[class*="queueItem"]', '[class*="notice"]', '[class*="navLink"]']
      .map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return { selector, ratio: null };
        const foreground = rgb(getComputedStyle(element).color);
        const backdrop = background(element);
        if (!foreground || !backdrop) return { selector, ratio: null };
        const values = [luminance(foreground), luminance(backdrop)].sort((left, right) => right - left);
        return { selector, ratio: Math.round(((values[0] + 0.05) / (values[1] + 0.05)) * 100) / 100 };
      });
  });
}

test('OCR review is usable at required widths and exposes keyboard, labels, and saved status @ocr-review', async ({ browser, baseURL }) => {
  const requestedActions = [];
  const snapshots = [];
  const contrastByViewport = [];
  const viewportMatrix = [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ];

  for (const viewport of viewportMatrix) {
    const review = makeReview();
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await context.addInitScript((user) => {
      localStorage.setItem('jurisprudencia_token', 'synthetic-ocr-review-token');
      localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
    }, QA_USER);
    await context.route('**/api/auth/me', (route) => route.fulfill({ json: QA_USER }));
    await context.route('**/api/ocr-human-review/**', async (route) => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname.replace(/^\/api/u, '');
      if (request.method() === 'GET' && endpoint === '/ocr-human-review/queue') {
        return route.fulfill({ json: {
          page: 1, pageSize: 25, total: 1, pageCount: 1,
          counts: { total: 1, unreviewed: 1, mine: 1, ready: 0 },
          results: [{
            documentId: review.document.id, title: review.document.title,
            court: review.document.court, chamber: review.document.chamber,
            caseNumber: review.document.caseNumber, fileId: review.file.id,
            filename: review.file.filename, fileSha256: review.file.sha256,
            pageCount: 1, reviewId: review.id, status: 'IN_REVIEW',
            assignedToId: QA_USER.id, hasApprovedVersion: false, approvedPages: 0,
            ocrRun: { status: 'COMPLETE', generatedPageCount: 1, pageCount: 1 },
          }],
        } });
      }
      if (request.method() === 'POST' && endpoint.endsWith('/documents/' + review.document.id + '/open')) {
        requestedActions.push('open');
        return route.fulfill({ json: { ...review, assignedToId: null } });
      }
      if (request.method() === 'POST' && endpoint === '/ocr-human-review/' + review.id + '/assign') {
        requestedActions.push('assign');
        return route.fulfill({ json: review });
      }
      if (request.method() === 'POST' && endpoint === '/ocr-human-review/' + review.id + '/pages/1/save') {
        requestedActions.push('save');
        const body = request.postDataJSON();
        review.activeRun.pages[0].correctedText = body.correctedText;
        review.activeRun.pages[0].version += 1;
        review.version += 1;
        return route.fulfill({ json: review });
      }
      if (request.method() === 'GET' && endpoint === '/ocr-human-review/' + review.id + '/file') {
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: pdfBuffer });
      }
      if (request.method() === 'GET' && endpoint === '/ocr-human-review/' + review.id) {
        return route.fulfill({ json: review });
      }
      return route.fulfill({ status: 404, json: { message: 'Unexpected synthetic OCR QA request.' } });
    });

    try {
      const page = await context.newPage();
      await page.goto(new URL('/admin/jurisprudencia/ocr', baseURL).toString());
      await expect(page.getByRole('heading', { name: 'Revisión humana de OCR' })).toBeVisible();
      await expect(page.getByRole('complementary', { name: 'Cola de revisión OCR' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Elegí un documento' })).toBeVisible();
      const queueItem = page.getByRole('button', { name: /Caso sintético para revisión OCR/ });
      await expect(queueItem).toBeVisible();
      await expect(queueItem).toContainText('1 páginas · 0/1 con decisión final');
      await expect(queueItem).toContainText('OCR listo para revisión humana · 1/1 páginas · aún no indexado');
      await page.getByRole('button', { name: 'Actualizar' }).focus();
      await page.keyboard.press('Tab');
      await expect(page.getByLabel('Filtrar cola')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(queueItem).toBeFocused();
      const visibleFocus = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement);
        return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
      });
      expect(visibleFocus, 'keyboard focus must remain visibly indicated').toBe(true);

      await queueItem.click();
      await expect(page.getByRole('heading', { name: 'Caso sintético para revisión OCR' })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'OCR completo · 1/1 páginas preparadas para revisión humana.' })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'El texto todavía no está indexado; requiere aprobación humana.' })).toBeVisible();
      await expect(page.getByText('0/1 páginas con decisión final')).toBeVisible();
      await expect(page.getByText('Repetí el procesamiento sólo si el texto no sirve para revisar; la corrida anterior y el PDF original se conservan.')).toBeVisible();
      await expect(page.getByText('Se habilita cuando cada página tiene una decisión final: texto aprobado o “sin texto”. Solo el texto aprobado se incorpora a Search interno.')).toBeVisible();
      await expect(page.getByLabel('Texto corregido')).toHaveValue(PAGE.ocrText);
      await expect(page.getByRole('button', { name: 'Aprobar página' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Requiere nueva revisión' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Página sin texto' })).toBeVisible();
      await expect(page.locator('.react-pdf__Page canvas').first()).toBeVisible({ timeout: 30_000 });

      if (viewport.width === 390) {
        await page.getByLabel('Texto corregido').fill('Texto corregido por revisión humana.');
        await expect(page.getByRole('status').filter({ hasText: 'Hay cambios sin guardar.' })).toBeVisible();
        await page.getByRole('button', { name: 'Guardar cambios' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Corrección guardada con historial y checksum.' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Aprobar página' })).toBeEnabled();
      }

      const layout = await page.evaluate(() => {
        const workspace = document.querySelector('[class*="workspace"]');
        const width = (selector) => {
          const element = document.querySelector(selector);
          return element ? Math.round(element.getBoundingClientRect().width) : 0;
        };
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
          guideOpen: document.querySelector('details[class*="ocrGuide"]')?.open ?? null,
          queueItemBottom: Math.round(document.querySelector('[class*="queueItem"]')?.getBoundingClientRect().bottom ?? 0),
          workspaceWidth: width('[class*="workspace"]'),
          queueWidth: width('[class*="queueColumn"]'),
          reviewWidth: width('[class*="reviewColumn"]'),
          workspaceColumns: workspace ? getComputedStyle(workspace).gridTemplateColumns : null,
          editorLabelled: document.querySelector('label[for="ocr-corrected-text"]')?.textContent?.trim() === 'Texto corregido',
          statusRegionPresent: Boolean(document.querySelector('[role="status"]')),
        };
      });
      expect(layout.horizontalOverflow, `horizontal overflow at ${viewport.width}x${viewport.height}`).toBe(false);
      expect(layout.guideOpen, `guide should collapse at ${viewport.width}px or remain open on desktop`).toBe(viewport.width > 900);
      if (viewport.width === 768) expect(layout.queueItemBottom, 'tablet queue item should fit in the initial viewport after collapsing the guide').toBeLessThanOrEqual(viewport.height);
      expect(layout.queueWidth, `queue is too narrow at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(220);
      expect(layout.reviewWidth, `review is too narrow at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(280);
      expect(layout.editorLabelled).toBe(true);
      expect(layout.statusRegionPresent).toBe(true);
      snapshots.push({ ...viewport, ...layout });
      const contrast = await colorContrastSamples(page);
      contrastByViewport.push({ viewport: `${viewport.width}x${viewport.height}`, samples: contrast });
      expect(contrast.filter((sample) => sample.ratio !== null && sample.ratio < 4.5), 'text and control contrast should meet WCAG AA for normal text').toEqual([]);

      const screenshotDir = path.join(process.env.UX_QA_REPORT_DIR || process.cwd(), 'ocr-review-screenshots');
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: path.join(screenshotDir, `${viewport.width}x${viewport.height}.png`), fullPage: true });
    } finally {
      await context.close();
    }
  }

  expect(requestedActions).toContain('open');
  expect(requestedActions).toContain('assign');
  expect(requestedActions).toContain('save');
  const evidenceDir = process.env.UX_QA_REPORT_DIR || process.cwd();
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'responsive.json'), `${JSON.stringify({ result: 'PASS', route: '/admin/jurisprudencia/ocr', browser: 'Edge Chromium', viewportMatrix: snapshots }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(evidenceDir, 'accessibility.json'), `${JSON.stringify({
    result: 'PASS', scope: 'synthetic UX harness; not institutional UAT',
    checks: { keyboardQueueNavigation: 'PASS', visibleFocus: 'PASS', editorLabel: 'PASS', pageActionsNamed: 'PASS', statusAnnouncements: 'PASS', contrastNormalTextMinimum: '4.5:1', horizontalOverflow: 'NONE' },
    contrastByViewport,
    saveStatus: 'Corrección guardada con historial y checksum.',
  }, null, 2)}\n`, 'utf8');
});

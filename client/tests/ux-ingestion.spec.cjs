'use strict';

const { expect, test } = require('@playwright/test');

const QA_USER = {
  id: 812,
  nombre: 'Operadora',
  apellido: 'Sintética',
  email: 'ingreso-qa@example.invalid',
  activo: true,
  rol: { id: 1, nombre: 'JURISPRUDENCIA' },
};

test('ingreso mantiene métricas legibles en desktop, tablet y móvil @ingreso', async ({ browser, baseURL }, testInfo) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await context.addInitScript((user) => {
      localStorage.setItem('jurisprudencia_token', 'synthetic-ingestion-qa-token');
      localStorage.setItem('jurisprudencia_user', JSON.stringify(user));
    }, QA_USER);
    await context.route('**/api/auth/me', (route) => route.fulfill({ json: QA_USER }));
    await context.route('**/api/corpus/institutional-ingestions**', (route) => route.fulfill({
      json: {
        data: [],
        meta: {
          total: 0, page: 1, pageSize: 25, pageCount: 0,
          counters: { pending: 0, ocrRequired: 0, duplicates: 0, reviewRequired: 0, completed: 0 },
        },
      },
    }));

    try {
      const page = await context.newPage();
      await page.goto(new URL('/jurisprudencia/ingreso', baseURL).toString());
      await expect(page.getByRole('heading', { name: 'Ingreso de jurisprudencia' })).toBeVisible();
      const receiveButton = page.getByRole('button', { name: 'Recibir PDF' });
      await expect(receiveButton).toBeDisabled();
      await expect(page.locator('#institutional-pdf-submit-help')).toHaveText('Seleccioná un PDF para habilitar la recepción.');
      await expect(receiveButton).toHaveAttribute('aria-describedby', 'institutional-pdf-submit-help');
      const layout = await page.evaluate(() => {
        const columns = document.querySelector('[class*="columns"]');
        const left = document.querySelector('[class*="leftColumn"]');
        const metrics = document.querySelector('[class*="metrics"]');
        const cards = Array.from(metrics?.children ?? []);
        return {
          viewportWidth: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          leftColumnWidth: Math.round(left?.getBoundingClientRect().width ?? 0),
          metricColumns: metrics ? getComputedStyle(metrics).gridTemplateColumns.split(' ').length : 0,
          metricCardWidths: cards.map((card) => Math.round(card.getBoundingClientRect().width)),
          pageColumnCount: columns ? getComputedStyle(columns).gridTemplateColumns.split(' ').length : 0,
          pageColumns: columns ? getComputedStyle(columns).gridTemplateColumns : null,
        };
      });
      expect(layout.documentWidth, `horizontal overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(viewport.width);
      expect(layout.metricCardWidths).toHaveLength(5);
      if (viewport.width === 1440) {
        expect(layout.leftColumnWidth).toBeGreaterThanOrEqual(520);
        expect(layout.metricColumns).toBe(3);
        expect(layout.pageColumnCount).toBe(2);
        expect(Math.min(...layout.metricCardWidths)).toBeGreaterThanOrEqual(150);
      }
      if (viewport.width === 1024 || viewport.width === 768) {
        expect(layout.metricColumns).toBe(2);
        expect(layout.pageColumnCount).toBe(1);
      }
      if (viewport.width === 390) {
        await page.locator('#institutional-pdf').setInputFiles({
          name: 'ingreso-sintetico.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\n% fixture sintético para QA\n'),
        });
        await expect(receiveButton).toBeEnabled();
        await expect(page.locator('#institutional-pdf-submit-help')).toHaveCount(0);
      }
      await page.screenshot({
        path: testInfo.outputPath(`ingreso-${viewport.width}x${viewport.height}.png`),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  }
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { getE2eArtifactPath } from './qa-credentials';

test('J9.0.1 public jurisprudence search fits mobile, tablet and desktop widths', async ({ page }) => {
  const artifactRoot = getE2eArtifactPath('jurisprudencia-j901-responsive');
  mkdirSync(artifactRoot, { recursive: true });
  await page.goto('/consulta?sala=H');
  await expect(page.getByRole('heading', { name: 'Jurisprudencia', exact: true })).toBeVisible();
  await expect(page.getByText(/\d+ resultados/u).first()).toBeVisible({ timeout: 30_000 });
  const viewports = [
    { width: 375, height: 812, name: 'mobile' },
    { width: 768, height: 1024, name: 'tablet' },
    { width: 1366, height: 768, name: 'desktop' },
  ];
  const measurements = [];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const measurement = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(measurement.documentWidth, viewport.name).toBeLessThanOrEqual(viewport.width);
    measurements.push({ ...viewport, ...measurement, horizontalOverflow: false });
    await page.screenshot({ path: resolve(artifactRoot, `responsive-${viewport.name}.png`), fullPage: true });
  }
  writeFileSync(resolve(artifactRoot, 'responsive-smoke.json'), `${JSON.stringify({ action:'SPRINT_J9_0_1_RESPONSIVE_SMOKE', route:'/consulta?sala=H', results:measurements, pass:true }, null, 2)}\n`, 'utf8');
});

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { screenshotDir } = require('./paths.cjs');

function viewportName(viewport) {
  return `${viewport.width}x${viewport.height}`;
}

async function collectLayout(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const internalScrollContainers = Array.from(document.querySelectorAll('*'))
      .filter((element) => {
        if (element === root || element === body) return false;
        const style = getComputedStyle(element);
        const scrollable = /(auto|scroll)/u.test(`${style.overflowY} ${style.overflowX}`);
        if (!scrollable || element.scrollHeight <= element.clientHeight + 2) return false;
        const classes = typeof element.className === 'string' ? element.className : '';
        const intentional = /sidePanel|viewerFrameWrap|scrollArea|resultsScroll/u.test(classes)
          || element.hasAttribute('data-ux-qa-allow-scroll');
        return !intentional;
      })
      .slice(0, 20)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === 'string' ? element.className : '',
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));

    return {
      viewport: { width: innerWidth, height: innerHeight },
      horizontalOverflow: {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        difference: root.scrollWidth - root.clientWidth,
        tolerancePx: 2,
        passes: root.scrollWidth <= root.clientWidth + 2,
      },
      bodyScroll: {
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
        documentClientHeight: root.clientHeight,
        documentScrollHeight: root.scrollHeight,
        pageHasVerticalScroll: root.scrollHeight > root.clientHeight + 2,
        unexpectedInternalScrollContainers: internalScrollContainers,
      },
      landmarks: {
        main: document.querySelectorAll('main').length,
        nav: document.querySelectorAll('nav').length,
        dialogs: document.querySelectorAll('[role="dialog"],dialog').length,
        ariaCurrentPage: document.querySelectorAll('[aria-current="page"]').length,
      },
      nextDevToolbarPresent: Boolean(document.querySelector('nextjs-portal')),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  });
}

async function captureScenario(page, testInfo, scenario) {
  const viewport = testInfo.project.use.viewport || page.viewportSize();
  const filename = `${scenario.id}__${viewportName(viewport)}.png`;
  fs.mkdirSync(screenshotDir, { recursive: true });
  const fullPath = path.join(screenshotDir, filename);
  await page.evaluate(() => {
    if (document.getElementById('ux-qa-hide-nextjs-portal')) return;
    const style = document.createElement('style');
    style.id = 'ux-qa-hide-nextjs-portal';
    style.textContent = 'nextjs-portal { display: none !important; }';
    document.head.appendChild(style);
  });
  await page.screenshot({ path: fullPath, animations: 'disabled' });

  const diagnostics = page.__uxQaDiagnostics || { console: [], pageErrors: [], networkErrors: [], fixtureMisses: [] };
  const layout = await collectLayout(page);
  const record = {
    scenarioId: scenario.id,
    title: scenario.title || scenario.id,
    route: scenario.route || new URL(page.url()).pathname,
    viewport,
    status: scenario.status || 'PASS',
    horizontalOverflow: layout.horizontalOverflow,
    bodyScroll: layout.bodyScroll,
    consoleErrors: diagnostics.console.filter((item) => item.type === 'error' && item.classification === 'APPLICATION_ERROR'),
    reactWarnings: diagnostics.console.filter((item) => item.classification === 'REACT_WARNING'),
    consoleWarnings: diagnostics.console.filter((item) => item.type === 'warning'),
    pageErrors: diagnostics.pageErrors.slice(),
    networkErrors: diagnostics.networkErrors.slice(),
    fixtureMisses: diagnostics.fixtureMisses.slice(),
    landmarks: layout.landmarks,
    nextDevToolbarPresent: layout.nextDevToolbarPresent,
    reducedMotion: layout.reducedMotion,
    screenshotPath: path.relative(require('./paths.cjs').runDir, fullPath).replace(/\\/gu, '/'),
    durationMs: scenario.durationMs ?? null,
    pdfRenderStatus: scenario.pdfRenderStatus || null,
    notes: [
      ...(scenario.notes || []),
      ...(layout.nextDevToolbarPresent ? ['The Next.js development portal was hidden in the product screenshot.'] : []),
    ],
  };
  testInfo.annotations.push({ type: 'ux-qa-scenario', description: JSON.stringify(record) });
  return record;
}

async function exerciseDialog(page, trigger, dialogName, onOpen) {
  await trigger.focus();
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: dialogName });
  await dialog.waitFor({ state: 'visible' });
  const ariaModal = await dialog.getAttribute('aria-modal');
  const focusEnters = await dialog.evaluate((element) => element.contains(document.activeElement));
  if (onOpen) await onOpen(dialog);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  const focusReturns = await trigger.evaluate((element) => document.activeElement === element);
  return { exists: true, role: 'dialog', ariaModal, focusEnters, escapeCloses: true, focusReturns };
}

async function accessibleButtonNames(page) {
  return page.locator('button').evaluateAll((buttons) => buttons
    .filter((button) => !(button.getAttribute('aria-label') || button.textContent || '').trim())
    .map((button) => ({ className: button.className, outerHTML: button.outerHTML.slice(0, 180) })));
}

module.exports = { captureScenario, collectLayout, exerciseDialog, accessibleButtonNames, viewportName };

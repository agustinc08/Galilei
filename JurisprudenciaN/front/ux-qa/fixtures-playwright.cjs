'use strict';

const { test: base } = require('@playwright/test');
const { fixtureForRequest } = require('./fixtures.cjs');
const { classifyConsoleMessage, classifyRequestFailure, isExpectedNetworkStatus } = require('./classifiers.cjs');

const test = base.extend({
  page: async ({ page }, use) => {
    const diagnostics = { console: [], pageErrors: [], networkErrors: [], fixtureMisses: [] };
    page.__uxQaDiagnostics = diagnostics;
    page.on('console', (message) => {
      const text = message.text();
      diagnostics.console.push({ type: message.type(), text, classification: classifyConsoleMessage(message.type(), text) });
    });
    page.on('pageerror', (error) => diagnostics.pageErrors.push({ text: error.message }));
    page.on('response', (response) => {
      if (response.status() >= 400 && !isExpectedNetworkStatus(response.url(), response.status())) {
        diagnostics.networkErrors.push({ kind: 'http', url: response.url(), status: response.status() });
      }
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText || 'request failed';
      const classification = classifyRequestFailure(request.url(), failure);
      if (classification !== 'EXPECTED_BLOB_ABORT' && classification !== 'NAVIGATION_ABORT') {
        diagnostics.networkErrors.push({ kind: 'request', url: request.url(), error: failure, classification });
      }
    });
    await page.route('**/api/**', async (route) => {
      const fixture = fixtureForRequest(route.request());
      if (fixture.fallback) diagnostics.fixtureMisses.push({ method: route.request().method(), url: route.request().url() });
      await route.fulfill({
        status: fixture.status,
        contentType: fixture.contentType,
        body: fixture.body,
      });
    });
    await use(page);
  },
});

module.exports = { test };

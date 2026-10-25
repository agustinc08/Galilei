'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { expect, test } = require('@playwright/test');
const { authScenarios, authenticatedRoutes } = require('../ux-qa/route-registry.cjs');

function assertProductCoverage(coverageFiles) {
  expect(coverageFiles.length).toBeGreaterThan(0);
  for (const file of coverageFiles) {
    const sourcePath = path.resolve(__dirname, '..', file);
    expect(fs.existsSync(sourcePath), `missing executable E2E coverage: ${file}`).toBe(true);
    expect(fs.statSync(sourcePath).size, `empty E2E coverage: ${file}`).toBeGreaterThan(0);
  }
}

test.describe('authenticated scenarios @auth', () => {
  for (const scenario of authScenarios) {
    test(`${scenario.id} is covered by isolated product E2E @auth`, async () => {
      expect(scenario.status).toBe('COVERED_BY_PRODUCT_E2E');
      expect(scenario.credentials).toBe('ISOLATED_QA');
      assertProductCoverage(scenario.coverageFiles);
    });
  }

  for (const route of authenticatedRoutes) {
    test(`${route.id} ${route.route} has executable product E2E coverage @auth`, async () => {
      expect(route.status).toBe('COVERED_BY_PRODUCT_E2E');
      assertProductCoverage(route.coverageFiles);
    });
  }
});

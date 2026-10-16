'use strict';

const { test } = require('../ux-qa/fixtures-playwright.cjs');
const { authScenarios, futureRoutes } = require('../ux-qa/route-registry.cjs');

test.describe('future authenticated scenarios @auth @future', () => {
  for (const scenario of authScenarios) {
    test(`${scenario.id} is defined and deferred @auth`, async () => {
      test.skip(true, `DEFERRED_AUTH: ${scenario.id} awaits the reconciled authenticated routes and approved local auth fixture.`);
    });
  }

  for (const route of futureRoutes) {
    test(`${route.id} ${route.route} DEFERRED_ROUTE_NOT_PRESENT @auth`, async () => {
      test.skip(true, `DEFERRED_ROUTE_NOT_PRESENT: ${route.route} is not available in the current UX branch.`);
    });
  }
});

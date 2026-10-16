'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const viewports = require('./viewports.cjs');
const { publicRoutes, futureRoutes, authScenarios } = require('./route-registry.cjs');
const { classifyConsoleMessage, classifyRequestFailure } = require('./classifiers.cjs');
const { fixtureForRequest, pdfBuffer } = require('./fixtures.cjs');

test('the responsive matrix contains the nine requested unique viewports', () => {
  assert.deepEqual(viewports.map(({ width, height }) => `${width}x${height}`), [
    '1366x768', '1440x900', '1536x864', '1600x900', '1920x1080', '1920x1200', '2560x1440', '390x844', '430x932',
  ]);
});

test('current public and future routes have explicit availability', () => {
  assert.deepEqual(publicRoutes.map((route) => route.route), ['/', '/login', '/consulta', '/fallos/ux-qa-001']);
  assert.ok(futureRoutes.every((route) => route.expectedAvailability === 'DEFERRED_UNTIL_RECONCILE'));
  assert.deepEqual(authScenarios.map((scenario) => scenario.id), [
    'ONE_DEPENDENCY', 'MULTI_DEPENDENCY', 'PERSONAL_OWNER', 'SHARED_MEMBER',
    'SHARED_NON_MEMBER', 'RESTRICTED_ALLOWED', 'RESTRICTED_DENIED', 'ADMIN_OPERATOR',
  ]);
});

test('console and network classifiers separate React warnings, Next tooling, and expected blob aborts', () => {
  assert.equal(classifyConsoleMessage('warning', 'Warning: React state update'), 'REACT_WARNING');
  assert.equal(classifyConsoleMessage('error', 'Next.js Dev Tools portal'), 'NEXT_DEV_TOOLING');
  assert.equal(classifyRequestFailure('blob:http://local/doc', 'net::ERR_ABORTED'), 'EXPECTED_BLOB_ABORT');
  assert.equal(classifyRequestFailure('https://api.invalid/search', 'net::ERR_CONNECTION_REFUSED'), 'NETWORK_FAILURE');
});

test('synthetic PDF and paginated search fixtures are deterministic', () => {
  assert.equal(pdfBuffer.subarray(0, 8).toString('ascii'), '%PDF-1.4');
  const request = (page) => ({ url: () => `http://local/api/public/busqueda?page=${page}`, method: () => 'GET' });
  const first = fixtureForRequest(request(1));
  const second = fixtureForRequest(request(2));
  assert.equal(first.status, 200);
  assert.equal(JSON.parse(first.body).meta.pageCount, 2);
  assert.notEqual(JSON.parse(first.body).data[0].id, JSON.parse(second.body).data[0].id);
});

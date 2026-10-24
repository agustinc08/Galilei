import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePreprodBuildEnvironment } from './preprod-build-env.mjs';

const valid = {
  BJC_PREPROD_API_ORIGIN: 'https://api-preprod.example.invalid',
  VITE_API_URL: 'https://api-preprod.example.invalid/api',
};

test('accepts a public HTTPS origin and the exact /api base', () => {
  assert.deepEqual(validatePreprodBuildEnvironment(valid), {
    apiOrigin: 'https://api-preprod.example.invalid',
    apiPath: '/api',
  });
});

test('rejects HTTP, malformed, credential-bearing, path, query, and fragment origins', () => {
  for (const BJC_PREPROD_API_ORIGIN of [
    'http://api-preprod.example.invalid',
    'https://user:pass@api-preprod.example.invalid',
    'https://api-preprod.example.invalid/path',
    'https://api-preprod.example.invalid?x=1',
    'https://api-preprod.example.invalid#fragment',
    'https://[::1',
  ]) {
    assert.throws(
      () => validatePreprodBuildEnvironment({ ...valid, BJC_PREPROD_API_ORIGIN }),
      /PREPROD_API_URL_INVALID|PREPROD_FRONTEND_API_MUST_MATCH_APPROVED_HTTPS_ORIGIN/,
    );
  }
});

test('rejects localhost, IPv4 loopback, IPv6 loopback, and mapped loopback', () => {
  for (const host of [
    'localhost',
    'api.localhost',
    '127.0.0.1',
    '127.42.0.9',
    '[::1]',
    '[::ffff:7f00:1]',
  ]) {
    const BJC_PREPROD_API_ORIGIN = `https://${host}`;
    assert.throws(
      () => validatePreprodBuildEnvironment({
        BJC_PREPROD_API_ORIGIN,
        VITE_API_URL: `${BJC_PREPROD_API_ORIGIN}/api`,
      }),
      /PREPROD_FRONTEND_API_MUST_MATCH_APPROVED_HTTPS_ORIGIN/,
    );
  }
});

test('requires the browser API base to match the approved origin and /api path', () => {
  for (const VITE_API_URL of [
    'https://other.example.invalid/api',
    'https://api-preprod.example.invalid/v2/api',
    'https://user:pass@api-preprod.example.invalid/api',
    'https://api-preprod.example.invalid/api?debug=true',
    'https://api-preprod.example.invalid/api#fragment',
    'http://api-preprod.example.invalid/api',
  ]) {
    assert.throws(
      () => validatePreprodBuildEnvironment({ ...valid, VITE_API_URL }),
      /PREPROD_FRONTEND_API_MUST_MATCH_APPROVED_HTTPS_ORIGIN/,
    );
  }
});

test('normalizes hostname case and rejects incomplete config', () => {
  assert.equal(validatePreprodBuildEnvironment({
    BJC_PREPROD_API_ORIGIN: 'https://API-PREPROD.example.invalid',
    VITE_API_URL: 'https://api-preprod.example.invalid/api',
  }).apiOrigin, 'https://api-preprod.example.invalid');
  assert.throws(() => validatePreprodBuildEnvironment({}), /BJC_PREPROD_API_ORIGIN_REQUIRED/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPdfPage, parsePdfPageParam } from '../src/lib/pdf-page.ts';

test('accepts valid first and last page parameters', () => {
  assert.equal(parsePdfPageParam('1'), 1);
  assert.equal(parsePdfPageParam('3'), 3);
  assert.equal(clampPdfPage(1, 3), 1);
  assert.equal(clampPdfPage(3, 3), 3);
});

test('clamps an out-of-range page only after a page count is known', () => {
  assert.equal(parsePdfPageParam('999'), 999);
  assert.equal(clampPdfPage(999, 3), 3);
  assert.equal(clampPdfPage(999, 0), 999);
});

test('invalid, non-positive, fractional, missing and unsafe page parameters fall back to page one', () => {
  for (const value of ['0', '-1', 'abc', '', '1.5', ' 2', '+2', '9007199254740992']) {
    assert.equal(parsePdfPageParam(value), 1, `page=${value}`);
  }
  assert.equal(parsePdfPageParam(null), 1);
  assert.equal(parsePdfPageParam(undefined), 1);
  assert.equal(clampPdfPage(-10, 3), 1);
  assert.equal(clampPdfPage(1.5, 3), 1);
});

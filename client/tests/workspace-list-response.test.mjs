import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWorkspaceListResponse } from '../src/lib/workspace-list-response.ts';

test('normalizes legacy arrays as a single bounded page', () => {
  const rows = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(normalizeWorkspaceListResponse(rows, 20), {
    page: 1,
    pageSize: 2,
    total: 2,
    results: rows,
  });
});

test('keeps paginated workspace responses unchanged', () => {
  const page = { page: 2, pageSize: 20, total: 25, results: [{ id: 'b' }] };
  assert.equal(normalizeWorkspaceListResponse(page, 20), page);
});

test('uses the requested page size for an empty legacy array', () => {
  assert.deepEqual(normalizeWorkspaceListResponse([], 20), {
    page: 1,
    pageSize: 20,
    total: 0,
    results: [],
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { evolutionYear, parseEvolutionSlugs, publicEvolutionHref, sortEvolutionEvents } from '../src/lib/evolution-utils.ts';

test('accepts only 2–50 unique stable public slugs', () => {
  assert.deepEqual(parseEvolutionSlugs('a,b'), ['a', 'b']);
  assert.equal(parseEvolutionSlugs(null)?.length, 0);
  assert.equal(parseEvolutionSlugs('a'), null);
  assert.equal(parseEvolutionSlugs('a,a'), null);
  assert.equal(parseEvolutionSlugs('bad%20slug,other'), null);
  assert.equal(parseEvolutionSlugs(Array.from({ length: 51 }, (_, i) => `s${i}`).join(',')), null);
});

test('public evolution links stay below the reusable URL limit', () => {
  assert.equal(publicEvolutionHref(['a', 'b']), '/evolucion?ids=a,b');
  const longSlugs = Array.from({ length: 50 }, (_, index) => `${index}${'x'.repeat(159)}`);
  assert.equal(publicEvolutionHref(longSlugs), '/evolucion');
});

test('sorts by authoritative decision date and keeps missing or invalid dates in an undated group', () => {
  const events = [
    { slug: 'missing', decisionDate: null },
    { slug: 'late', decisionDate: '2022-03-01T00:00:00.000Z' },
    { slug: 'invalid', decisionDate: 'not-a-date' },
    { slug: 'early', decisionDate: '2019-06-01T00:00:00.000Z' },
  ];
  assert.deepEqual(sortEvolutionEvents(events).map((event) => event.slug), ['early', 'late', 'invalid', 'missing']);
  assert.equal(evolutionYear('2019-06-01T00:00:00.000Z'), 2019);
  assert.equal(evolutionYear('not-a-date'), null);
});

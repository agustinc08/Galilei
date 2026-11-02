import assert from 'node:assert/strict';
import test from 'node:test';
import { documentReviewStatusLabel } from '../src/lib/review-presentation.ts';

test('document processing states use human-readable labels', () => {
  assert.equal(
    documentReviewStatusLabel('OCR_REQUIRED'),
    'Requiere reconocimiento de texto',
  );
  assert.equal(documentReviewStatusLabel('INDEXED'), 'Listo para buscar');
});

test('unknown backend states are never exposed verbatim', () => {
  assert.equal(
    documentReviewStatusLabel('NEW_BACKEND_ENUM'),
    'Pendiente de revisión',
  );
});

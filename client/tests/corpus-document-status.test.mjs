import test from 'node:test';
import assert from 'node:assert/strict';
import { corpusDocumentStatusLabel } from '../src/lib/corpus-document-status.ts';

test('workspace document states distinguish OCR required from processing and searchable', () => {
  assert.equal(
    corpusDocumentStatusLabel('OCR_REQUIRED'),
    'Requiere reconocimiento de texto',
  );
  assert.equal(corpusDocumentStatusLabel('OCR_PROCESSING'), 'Procesando OCR…');
  assert.equal(corpusDocumentStatusLabel('INDEXED'), 'Listo para buscar');
  assert.equal(corpusDocumentStatusLabel('TEXT_EXTRACTED'), 'Texto disponible');
  assert.equal(
    corpusDocumentStatusLabel('EXTRACTED_TRUNCATED'),
    'Texto parcial disponible',
  );
});

test('pending, failed, and unknown extraction states do not claim a document is searchable', () => {
  assert.equal(
    corpusDocumentStatusLabel('INDEX_PENDING'),
    'Indexación pendiente',
  );
  assert.equal(
    corpusDocumentStatusLabel('OCR_FAILED'),
    'No se pudo extraer el texto',
  );
  assert.equal(corpusDocumentStatusLabel('UNRECOGNIZED'), 'Estado no disponible');
  assert.equal(corpusDocumentStatusLabel(null), 'Documento disponible');
});
